import { Injectable, NotFoundException } from '@nestjs/common';
import type { Weekday } from '@roviq/common-types';
import { i18nDisplay } from '@roviq/database';
import PDFDocument from 'pdfkit';
import { TimetableRepository } from './repositories/timetable.repository';
import type { TimetableEntryRecord, TimetableLabelMaps } from './repositories/types';
import { type TimetableGrid, TimetableViewService } from './timetable-view.service';

/** English short day labels — the PDF is a single-language export document. */
const WEEKDAY_SHORT: Record<Weekday, string> = {
  MONDAY: 'Mon',
  TUESDAY: 'Tue',
  WEDNESDAY: 'Wed',
  THURSDAY: 'Thu',
  FRIDAY: 'Fri',
  SATURDAY: 'Sat',
  SUNDAY: 'Sun',
};

// A4 landscape geometry (points).
const PAGE = { width: 842, height: 595, margin: 36 } as const;
const PERIOD_COL_WIDTH = 96;
const HEADER_ROW_HEIGHT = 22;
const MIN_CELL_HEIGHT = 30;
const LINE_HEIGHT = 10;
const CELL_PADDING = 4;
const FONT = { header: 9, cell: 8, title: 16, subtitle: 9 } as const;

interface RenderOptions {
  title: string;
  subtitle: string;
  grid: TimetableGrid;
  labels: TimetableLabelMaps;
  /** Staff view shows the section per cell; section view shows the teacher. */
  showSection: boolean;
}

@Injectable()
export class TimetablePdfService {
  constructor(
    private readonly view: TimetableViewService,
    private readonly repo: TimetableRepository,
  ) {}

  /** Section weekly timetable as a downloadable PDF (Buffer). */
  async sectionTimetablePdf(sectionId: string, timetableId?: string): Promise<Buffer> {
    const grid = await this.view.sectionTimetable(sectionId, timetableId);
    if (!grid) throw new NotFoundException('No timetable found for this section');
    const timetable = await this.repo.findTimetableById(grid.timetableId);
    const labels = await this.collectLabels(grid.entries, [sectionId]);
    return this.render({
      title: i18nDisplay(timetable?.name ?? {}) || 'Timetable',
      subtitle: this.effectiveSubtitle(labels.sections[sectionId] ?? 'Section', timetable),
      grid,
      labels,
      showSection: false,
    });
  }

  /** Staff weekly timetable as a downloadable PDF (Buffer). */
  async staffTimetablePdf(teacherId: string, timetableId?: string): Promise<Buffer> {
    const grid = await this.view.staffTimetable(teacherId, timetableId);
    if (!grid) throw new NotFoundException('No active timetable found');
    const timetable = await this.repo.findTimetableById(grid.timetableId);
    const sectionIds = grid.entries.map((e) => e.sectionId);
    const labels = await this.collectLabels(grid.entries, sectionIds);
    return this.render({
      title: i18nDisplay(timetable?.name ?? {}) || 'Timetable',
      subtitle: this.effectiveSubtitle(labels.teachers[teacherId] ?? 'Staff', timetable),
      grid,
      labels,
      showSection: true,
    });
  }

  private effectiveSubtitle(
    who: string,
    timetable: { effectiveFrom: string; effectiveTo: string } | null,
  ): string {
    if (!timetable) return who;
    return `${who}  •  ${timetable.effectiveFrom} to ${timetable.effectiveTo}`;
  }

  private collectLabels(
    entries: TimetableEntryRecord[],
    sectionIds: string[],
  ): Promise<TimetableLabelMaps> {
    return this.repo.resolveLabels({
      subjectIds: entries.flatMap((e) => (e.subjectId ? [e.subjectId] : [])),
      sectionIds: [...sectionIds, ...entries.map((e) => e.sectionId)],
      teacherIds: entries.flatMap((e) => (e.teacherId ? [e.teacherId] : [])),
    });
  }

  /** Multi-line text for one assignment cell (subject + teacher/section + room). */
  private cellText(entries: TimetableEntryRecord[], opts: RenderOptions): string {
    if (entries.length === 0) return 'Free';
    return entries
      .map((entry) => {
        const lines: string[] = [];
        const prefix = entry.splitLabel ? `${entry.splitLabel}: ` : '';
        lines.push(`${prefix}${opts.labels.subjects[entry.subjectId ?? ''] ?? 'Unassigned'}`);
        if (opts.showSection) lines.push(opts.labels.sections[entry.sectionId] ?? '');
        else if (entry.teacherId) lines.push(opts.labels.teachers[entry.teacherId] ?? '');
        if (entry.room) lines.push(entry.room);
        return lines.filter(Boolean).join('\n');
      })
      .join('\n— — —\n');
  }

  private render(opts: RenderOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: PAGE.margin });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const days = opts.grid.workingDays;
      const dayWidth = (PAGE.width - 2 * PAGE.margin - PERIOD_COL_WIDTH) / Math.max(1, days.length);
      const periods = [...opts.grid.periods].sort((a, b) => a.sequence - b.sequence);

      // Title block
      doc.font('Helvetica-Bold').fontSize(FONT.title).text(opts.title, PAGE.margin, PAGE.margin);
      doc.font('Helvetica').fontSize(FONT.subtitle).fillColor('#444').text(opts.subtitle);
      doc.fillColor('#000');

      let y = doc.y + 8;
      y = this.drawHeaderRow(doc, days, dayWidth, y);

      for (const period of periods) {
        const isBreak = period.kind === 'BREAK';
        const timeLabel = `${period.startTime.slice(0, 5)}–${period.endTime.slice(0, 5)}`;

        const cellTexts = isBreak
          ? []
          : days.map((day) =>
              this.cellText(
                opts.grid.entries.filter((e) => e.periodId === period.id && e.dayOfWeek === day),
                opts,
              ),
            );

        const rowHeight = isBreak ? MIN_CELL_HEIGHT - 6 : this.measureRow(doc, cellTexts, dayWidth);

        // Page break: redraw the header on the new page.
        if (y + rowHeight > PAGE.height - PAGE.margin) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: PAGE.margin });
          y = this.drawHeaderRow(doc, days, dayWidth, PAGE.margin);
        }

        this.drawPeriodCell(doc, period.label, timeLabel, y, rowHeight);

        if (isBreak) {
          doc
            .rect(PAGE.margin + PERIOD_COL_WIDTH, y, dayWidth * days.length, rowHeight)
            .fillAndStroke('#f2f2f2', '#cccccc');
          doc
            .fillColor('#666')
            .font('Helvetica-Oblique')
            .fontSize(FONT.cell)
            .text(period.label, PAGE.margin + PERIOD_COL_WIDTH, y + CELL_PADDING, {
              width: dayWidth * days.length,
              align: 'center',
            });
          doc.fillColor('#000');
        } else {
          days.forEach((_day, i) => {
            const x = PAGE.margin + PERIOD_COL_WIDTH + i * dayWidth;
            doc.rect(x, y, dayWidth, rowHeight).stroke('#cccccc');
            doc
              .font('Helvetica')
              .fontSize(FONT.cell)
              .fillColor(cellTexts[i] === 'Free' ? '#999' : '#000')
              .text(cellTexts[i], x + CELL_PADDING, y + CELL_PADDING, {
                width: dayWidth - 2 * CELL_PADDING,
                height: rowHeight - 2 * CELL_PADDING,
                ellipsis: true,
              });
            doc.fillColor('#000');
          });
        }

        y += rowHeight;
      }

      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#888')
        .text(
          `Generated by Roviq • ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
          PAGE.margin,
          PAGE.height - PAGE.margin + 4,
          { width: PAGE.width - 2 * PAGE.margin, align: 'right' },
        );

      doc.end();
    });
  }

  private drawHeaderRow(
    doc: PDFKit.PDFDocument,
    days: Weekday[],
    dayWidth: number,
    y: number,
  ): number {
    doc
      .rect(PAGE.margin, y, PERIOD_COL_WIDTH, HEADER_ROW_HEIGHT)
      .fillAndStroke('#1f2937', '#1f2937');
    doc
      .fillColor('#fff')
      .font('Helvetica-Bold')
      .fontSize(FONT.header)
      .text('Period', PAGE.margin + CELL_PADDING, y + 6, {
        width: PERIOD_COL_WIDTH - 2 * CELL_PADDING,
      });
    days.forEach((day, i) => {
      const x = PAGE.margin + PERIOD_COL_WIDTH + i * dayWidth;
      doc.rect(x, y, dayWidth, HEADER_ROW_HEIGHT).fillAndStroke('#1f2937', '#1f2937');
      doc
        .fillColor('#fff')
        .text(WEEKDAY_SHORT[day], x + CELL_PADDING, y + 6, { width: dayWidth - 2 * CELL_PADDING });
    });
    doc.fillColor('#000');
    return y + HEADER_ROW_HEIGHT;
  }

  private drawPeriodCell(
    doc: PDFKit.PDFDocument,
    label: string,
    timeLabel: string,
    y: number,
    rowHeight: number,
  ): void {
    doc.rect(PAGE.margin, y, PERIOD_COL_WIDTH, rowHeight).fillAndStroke('#f9fafb', '#cccccc');
    doc
      .fillColor('#000')
      .font('Helvetica-Bold')
      .fontSize(FONT.cell)
      .text(label, PAGE.margin + CELL_PADDING, y + CELL_PADDING, {
        width: PERIOD_COL_WIDTH - 2 * CELL_PADDING,
      });
    doc
      .font('Helvetica')
      .fillColor('#666')
      .fontSize(7)
      .text(timeLabel, PAGE.margin + CELL_PADDING, y + CELL_PADDING + LINE_HEIGHT, {
        width: PERIOD_COL_WIDTH - 2 * CELL_PADDING,
      });
    doc.fillColor('#000');
  }

  /** Row height = tallest cell content, clamped to a sensible minimum. */
  private measureRow(doc: PDFKit.PDFDocument, cellTexts: string[], dayWidth: number): number {
    doc.font('Helvetica').fontSize(FONT.cell);
    const tallest = cellTexts.reduce((max, text) => {
      const h = doc.heightOfString(text, { width: dayWidth - 2 * CELL_PADDING });
      return Math.max(max, h);
    }, 0);
    return Math.max(MIN_CELL_HEIGHT, tallest + 2 * CELL_PADDING);
  }
}
