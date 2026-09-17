import { Injectable, NotFoundException } from '@nestjs/common';
import { i18nDisplay } from '@roviq/database';
import PDFDocument from 'pdfkit';
import { ExaminationRepository } from './repositories/examination.repository';
import type { ExamRecord, ExamScheduleRecord } from './repositories/types';

const PAGE = { width: 595, height: 842, margin: 40 } as const; // A4 portrait
// Column widths sum to the printable area (595 − 2×40 = 515).
const COL = {
  date: 62,
  day: 45,
  subject: 110,
  time: 72,
  duration: 36,
  marks: 36,
  room: 64,
  invigilator: 90,
} as const;
const COLS = [
  'date',
  'day',
  'subject',
  'time',
  'duration',
  'marks',
  'room',
  'invigilator',
] as const;
const HEADERS: Record<(typeof COLS)[number], string> = {
  date: 'Date',
  day: 'Day',
  subject: 'Subject',
  time: 'Time',
  duration: 'Dur (min)',
  marks: 'Max',
  room: 'Room',
  invigilator: 'Invigilator',
};

/** Renders an exam's datesheet (printable schedule) to a downloadable PDF (on-demand). */
@Injectable()
export class ExaminationDatesheetPdfService {
  constructor(private readonly repo: ExaminationRepository) {}

  async render(examId: string, sectionId?: string, staffId?: string): Promise<Buffer> {
    const exam = await this.repo.findExamById(examId);
    if (!exam) throw new NotFoundException(`Exam ${examId} not found`);

    let schedules = await this.repo.findSchedulesByExam(examId);
    if (sectionId) schedules = schedules.filter((s) => s.sectionId === sectionId);
    // Single invigilator's duty roster: only papers they invigilate.
    if (staffId) schedules = schedules.filter((s) => s.invigilatorId === staffId);

    const subjectIds = [...new Set(schedules.map((s) => s.subjectId))];
    const sectionIds = [...new Set(schedules.map((s) => s.sectionId))];
    const staffMembershipIds = [
      ...new Set(schedules.map((s) => s.invigilatorId).filter((id): id is string => id !== null)),
    ];
    const labels = await this.repo.resolveLabels({
      subjectIds,
      sectionIds,
      studentMembershipIds: [],
      staffMembershipIds,
    });

    // Sort by examDate then startTime; null dates/times sink to the bottom.
    const sorted = [...schedules].sort((a, b) => {
      const d = (a.examDate ?? '9999-12-31').localeCompare(b.examDate ?? '9999-12-31');
      if (d !== 0) return d;
      return (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99');
    });

    return this.draw(exam, sorted, labels.subjects, labels.sections, labels.staff, {
      sectionId,
      staffId,
    });
  }

  private draw(
    exam: ExamRecord,
    schedules: ExamScheduleRecord[],
    subjectNames: Record<string, string>,
    sectionNames: Record<string, string>,
    staffNames: Record<string, string>,
    scope: { sectionId?: string; staffId?: string },
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.drawHeader(doc, exam, {
        sectionName: scope.sectionId ? sectionNames[scope.sectionId] : undefined,
        staffName: scope.staffId ? staffNames[scope.staffId] : undefined,
      });
      this.drawTable(doc, schedules, subjectNames, staffNames);
      this.drawFooter(doc);

      doc.end();
    });
  }

  private drawHeader(
    doc: PDFKit.PDFDocument,
    exam: ExamRecord,
    scope: { sectionName?: string; staffName?: string },
  ): void {
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(i18nDisplay(exam.name) || 'Examination', { align: 'center' });
    const subtitle = scope.staffName
      ? `Invigilation Duty — ${scope.staffName}`
      : scope.sectionName
        ? `Datesheet — ${scope.sectionName}`
        : 'Datesheet';
    doc.font('Helvetica').fontSize(11).fillColor('#444').text(subtitle, { align: 'center' });
    doc.fillColor('#000').moveDown(0.8);
  }

  private drawTable(
    doc: PDFKit.PDFDocument,
    schedules: ExamScheduleRecord[],
    subjectNames: Record<string, string>,
    staffNames: Record<string, string>,
  ): void {
    const left = PAGE.margin;
    if (schedules.length === 0) {
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#777')
        .text('No papers scheduled.', left, doc.y);
      doc.fillColor('#000');
      return;
    }

    let y = this.tableHeader(doc, doc.y, left);
    for (const s of schedules) {
      const subject = subjectNames[s.subjectId] ?? s.subjectId;
      const invigilator = s.invigilatorId ? (staffNames[s.invigilatorId] ?? '—') : '—';
      const rowH = Math.max(
        18,
        doc
          .font('Helvetica')
          .fontSize(9)
          .heightOfString(subject, { width: COL.subject - 6 }) + 8,
        doc
          .font('Helvetica')
          .fontSize(9)
          .heightOfString(invigilator, {
            width: COL.invigilator - 6,
          }) + 8,
      );
      if (y + rowH > PAGE.height - PAGE.margin - 30) {
        doc.addPage();
        y = this.tableHeader(doc, PAGE.margin, left);
      }
      const cells: Record<(typeof COLS)[number], string> = {
        date: fmtDate(s.examDate),
        day: weekday(s.examDate),
        subject,
        time: fmtTime(s.startTime, s.endTime),
        duration: durationMinutes(s.startTime, s.endTime),
        marks: String(s.maxMarks),
        room: s.room ?? '—',
        invigilator,
      };
      let x = left;
      doc.font('Helvetica').fontSize(9).fillColor('#000');
      for (const key of COLS) {
        const w = COL[key];
        const align = isLeftAligned(key) ? 'left' : 'center';
        doc.text(cells[key], x + 3, y + 4, { width: w - 6, align });
        x += w;
      }
      y += rowH;
      doc
        .moveTo(left, y)
        .lineTo(left + tableWidth(), y)
        .strokeColor('#e5e5e5')
        .stroke();
    }
  }

  private tableHeader(doc: PDFKit.PDFDocument, y: number, left: number): number {
    doc.rect(left, y, tableWidth(), 18).fillAndStroke('#1f2937', '#1f2937');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
    let x = left;
    for (const key of COLS) {
      const w = COL[key];
      const align = isLeftAligned(key) ? 'left' : 'center';
      doc.text(HEADERS[key], x + 3, y + 5, { width: w - 6, align });
      x += w;
    }
    doc.fillColor('#000');
    return y + 18;
  }

  private drawFooter(doc: PDFKit.PDFDocument): void {
    const date = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#888')
      .text(`Generated by Roviq • ${date}`, PAGE.margin, PAGE.height - PAGE.margin + 6, {
        width: PAGE.width - 2 * PAGE.margin,
        align: 'right',
      });
  }
}

function tableWidth(): number {
  return COLS.reduce((sum, key) => sum + COL[key], 0);
}

function isLeftAligned(key: (typeof COLS)[number]): boolean {
  return key === 'subject' || key === 'date' || key === 'day' || key === 'invigilator';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });
}

function weekday(iso: string | null): string {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' });
}

function fmtTime(start: string | null, end: string | null): string {
  if (!start && !end) return '—';
  return `${start ?? '—'}–${end ?? '—'}`;
}

function durationMinutes(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const mins = toMinutes(end) - toMinutes(start);
  return mins > 0 ? String(mins) : '—';
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}
