// libs/database/src/seed/demo/academics.ts
import { eq } from 'drizzle-orm';
import {
  academicYears,
  SYSTEM_USER_ID,
  sectionSubjects,
  sections,
  standardSubjects,
  standards,
  subjects,
} from '../..';
import type { DrizzleDB } from '../../providers';
import type { StandardDef, SubjectDef, SubjectMapping } from './data';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

export async function seedAcademicStructure(
  tx: DrizzleDB,
  instId: string,
  ayId: string,
  stdDefs: StandardDef[],
  label: string,
) {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

  const [ay] = await tx
    .insert(academicYears)
    .values({
      id: ayId,
      tenantId: instId,
      label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
      startDate: `${startYear}-04-01`,
      endDate: `${startYear + 1}-03-31`,
      isActive: true,
      status: 'ACTIVE',
      termStructure: [
        { label: 'Term 1', startDate: `${startYear}-04-01`, endDate: `${startYear}-09-30` },
        { label: 'Term 2', startDate: `${startYear}-10-01`, endDate: `${startYear + 1}-03-31` },
      ],
      ...BY,
    })
    .onConflictDoNothing()
    .returning({ id: academicYears.id });

  if (!ay) return null;

  const streamConfigs: Record<string, { name: string; code: string }> = {
    Science: { name: 'Science PCM/PCB', code: 'science' },
    Commerce: { name: 'Commerce', code: 'commerce' },
    Arts: { name: 'Humanities', code: 'arts' },
  };

  for (const s of stdDefs) {
    const [std] = await tx
      .insert(standards)
      .values({
        tenantId: instId,
        academicYearId: ay.id,
        name: { en: s.name },
        numericOrder: s.order,
        level: s.level,
        nepStage: s.nep ?? null,
        isBoardExamClass: s.boardExam ?? false,
        streamApplicable: s.stream ?? false,
        maxStudentsPerSection: s.level === 'PRE_PRIMARY' ? 30 : 40,
        udiseClassCode: s.udise,
        ...BY,
      })
      .onConflictDoNothing()
      .returning({ id: standards.id });

    if (std) {
      for (const secName of s.sections) {
        await tx
          .insert(sections)
          .values({
            tenantId: instId,
            standardId: std.id,
            academicYearId: ay.id,
            name: { en: secName },
            displayLabel: `${s.name}-${secName}`,
            capacity: s.level === 'PRE_PRIMARY' ? 30 : 40,
            stream: streamConfigs[secName] ?? null,
            mediumOfInstruction: label.includes('NEP') ? 'English' : 'Hindi',
            shift: 'Morning',
            ...BY,
          })
          .onConflictDoNothing();
      }
    }
  }
  console.log(`  ${label}: ${stdDefs.length} standards, sections seeded`);
  return ay;
}

export async function seedSubjects(
  tx: DrizzleDB,
  instId: string,
  subjectDefs: SubjectDef[],
): Promise<Record<string, string>> {
  const idMap: Record<string, string> = {};
  for (const s of subjectDefs) {
    const [sub] = await tx
      .insert(subjects)
      .values({
        tenantId: instId,
        name: s.name,
        shortName: s.shortName,
        boardCode: s.boardCode ?? null,
        type: s.type,
        isMandatory: s.mandatory,
        hasPractical: !!s.practical,
        theoryMarks: s.theory ?? null,
        practicalMarks: s.practical ?? null,
        internalMarks: s.internal ?? null,
        ...BY,
      })
      .onConflictDoNothing()
      .returning({ id: subjects.id });
    if (sub) idMap[s.shortName] = sub.id;
  }
  console.log(`  Subjects: ${Object.keys(idMap).length} created for ${instId.slice(-3)}`);
  return idMap;
}

export async function linkSubjectsToStructure(
  tx: DrizzleDB,
  instId: string,
  ayId: string,
  subjectIds: Record<string, string>,
  mappings: SubjectMapping[],
) {
  const allStds = await tx
    .select({ id: standards.id, order: standards.numericOrder })
    .from(standards)
    .where(eq(standards.academicYearId, ayId));

  for (const mapping of mappings) {
    const [minOrder, maxOrder] = mapping.orderRange;
    const matchingStds = allStds.filter((s) => s.order >= minOrder && s.order <= maxOrder);

    for (const std of matchingStds) {
      for (const subKey of mapping.subjects) {
        const subId = subjectIds[subKey];
        if (!subId) continue;

        await tx
          .insert(standardSubjects)
          .values({ tenantId: instId, subjectId: subId, standardId: std.id, ...BY })
          .onConflictDoNothing();

        const secs = await tx
          .select({ id: sections.id })
          .from(sections)
          .where(eq(sections.standardId, std.id));

        for (const sec of secs) {
          await tx
            .insert(sectionSubjects)
            .values({ tenantId: instId, subjectId: subId, sectionId: sec.id, ...BY })
            .onConflictDoNothing();
        }
      }
    }
  }
  console.log(`  Subject links created for ${instId.slice(-3)}`);
}
