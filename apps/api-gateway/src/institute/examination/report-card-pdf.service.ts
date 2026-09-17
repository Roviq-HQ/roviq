import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { ReportCardPayload } from './report-card-generation.service';
import { ExaminationRepository } from './repositories/examination.repository';
import type { ReportCardInstanceRecord } from './repositories/types';

const PAGE = { width: 595, height: 842, margin: 40 } as const; // A4 portrait
const COL = { subject: 200, exams: 200, pct: 75, grade: 60 } as const;

/** Renders a generated report-card instance to a downloadable PDF (on-demand). */
@Injectable()
export class ReportCardPdfService {
  constructor(private readonly repo: ExaminationRepository) {}

  async render(instanceId: string): Promise<Buffer> {
    const instance = await this.repo.findReportCardInstanceById(instanceId);
    if (!instance) throw new NotFoundException(`Report card instance ${instanceId} not found`);
    const payload = instance.payload as ReportCardPayload;
    return this.draw(instance, payload);
  }

  private draw(instance: ReportCardInstanceRecord, payload: ReportCardPayload): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.drawHeaderAndSummary(doc, instance, payload);
      this.drawScholastic(doc, payload);
      this.drawTopics(doc, payload);
      this.drawCoScholastic(doc, payload);
      this.drawRemarks(doc, instance);
      this.drawFooter(doc);

      doc.end();
    });
  }

  private drawHeaderAndSummary(
    doc: PDFKit.PDFDocument,
    instance: ReportCardInstanceRecord,
    payload: ReportCardPayload,
  ): void {
    const left = PAGE.margin;
    const right = PAGE.width - PAGE.margin;
    doc.font('Helvetica-Bold').fontSize(18).text('Report Card', { align: 'center' });
    if (payload.termName) {
      doc
        .font('Helvetica')
        .fontSize(11)
        .fillColor('#444')
        .text(payload.termName, { align: 'center' });
    }
    doc.fillColor('#000').moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(12).text(payload.student.name, left, doc.y);
    const summaryY = doc.y - 14;
    doc.font('Helvetica').fontSize(9).fillColor('#444');
    if (payload.student.rollNumber) doc.text(`Roll No: ${payload.student.rollNumber}`, left);
    const attendance =
      instance.attendancePercent != null
        ? `   •   Attendance ${fmt(instance.attendancePercent)}%`
        : '';
    doc
      .fontSize(9)
      .text(
        `Result: ${instance.resultStatus}   •   ${fmt(instance.percentage)}%   •   Grade ${instance.grade ?? '—'}   •   GPA ${fmt(instance.gpa)}   •   Rank ${instance.rank ?? '—'}${attendance}`,
        left,
        summaryY + 2,
        { width: right - left, align: 'right' },
      );
    doc.fillColor('#000').moveDown(0.8);
  }

  private drawScholastic(doc: PDFKit.PDFDocument, payload: ReportCardPayload): void {
    const left = PAGE.margin;
    const right = PAGE.width - PAGE.margin;
    this.sectionTitle(doc, 'Scholastic');
    let y = this.tableHeader(doc, doc.y + 2, left);
    for (const s of payload.subjects) {
      const examText = s.exams.map((e) => `${e.examName}: ${fmt(e.percentage)}%`).join(', ') || '—';
      const rowH = Math.max(
        18,
        doc
          .font('Helvetica')
          .fontSize(8)
          .heightOfString(examText, { width: COL.exams - 6 }) + 8,
      );
      if (y + rowH > PAGE.height - PAGE.margin - 40) {
        doc.addPage();
        y = this.tableHeader(doc, PAGE.margin, left);
      }
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#000')
        .text(s.subjectName, left + 3, y + 3, {
          width: COL.subject - 6,
        });
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#555')
        .text(examText, left + COL.subject + 3, y + 3, {
          width: COL.exams - 6,
        });
      doc
        .fillColor(s.isAbsent ? '#999' : '#000')
        .fontSize(9)
        .text(s.isAbsent ? 'AB' : `${fmt(s.percentage)}%`, left + COL.subject + COL.exams, y + 3, {
          width: COL.pct,
          align: 'center',
        });
      doc.text(s.grade ?? '—', left + COL.subject + COL.exams + COL.pct, y + 3, {
        width: COL.grade,
        align: 'center',
      });
      doc.fillColor('#000');
      y += rowH;
      doc.moveTo(left, y).lineTo(right, y).strokeColor('#e5e5e5').stroke();
    }
  }

  private drawTopics(doc: PDFKit.PDFDocument, payload: ReportCardPayload): void {
    const left = PAGE.margin;
    const right = PAGE.width - PAGE.margin;
    const withTopics = payload.subjects.filter((s) => s.topics.length > 0);
    if (withTopics.length === 0) return;
    doc.moveDown(0.8);
    this.sectionTitle(doc, 'Learning outcomes (topic-wise)');
    for (const s of withTopics) {
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(s.subjectName, left, doc.y + 4);
      for (const t of s.topics) {
        const line = `• ${t.name}: ${t.competency}${t.descriptor ? ` — ${t.descriptor}` : ''}`;
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#444')
          .text(line, left + 12, doc.y + 2, {
            width: right - left - 12,
          });
      }
      doc.fillColor('#000');
    }
  }

  private drawCoScholastic(doc: PDFKit.PDFDocument, payload: ReportCardPayload): void {
    if (payload.coScholastic.length === 0) return;
    doc.moveDown(0.8);
    this.sectionTitle(doc, 'Co-scholastic');
    for (const c of payload.coScholastic) {
      const line = `${c.area}: ${c.grade}${c.descriptor ? ` (${c.descriptor})` : ''}`;
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(line, PAGE.margin, doc.y + 3);
    }
  }

  private drawRemarks(doc: PDFKit.PDFDocument, instance: ReportCardInstanceRecord): void {
    if (!instance.classTeacherRemark && !instance.principalRemark) return;
    doc.moveDown(0.8);
    this.sectionTitle(doc, 'Remarks');
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    if (instance.classTeacherRemark)
      doc.text(`Class teacher: ${instance.classTeacherRemark}`, PAGE.margin, doc.y + 2);
    if (instance.principalRemark)
      doc.text(`Principal: ${instance.principalRemark}`, PAGE.margin, doc.y + 2);
    doc.fillColor('#000');
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

  private sectionTitle(doc: PDFKit.PDFDocument, text: string): void {
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1f2937').text(text, PAGE.margin, doc.y);
    doc.fillColor('#000');
  }

  private tableHeader(doc: PDFKit.PDFDocument, y: number, left: number): number {
    doc
      .rect(left, y, COL.subject + COL.exams + COL.pct + COL.grade, 18)
      .fillAndStroke('#1f2937', '#1f2937');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
    doc.text('Subject', left + 3, y + 5, { width: COL.subject - 6 });
    doc.text('Assessments', left + COL.subject + 3, y + 5, { width: COL.exams - 6 });
    doc.text('Total', left + COL.subject + COL.exams, y + 5, { width: COL.pct, align: 'center' });
    doc.text('Grade', left + COL.subject + COL.exams + COL.pct, y + 5, {
      width: COL.grade,
      align: 'center',
    });
    doc.fillColor('#000');
    return y + 18;
  }
}

function fmt(n: number | null): string {
  return n == null ? '—' : String(n);
}
