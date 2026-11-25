import { describe, expect, it } from 'vitest';
import { HELP_LIMITS } from '../../libs/frontend/ui/src/form/help/field-help';
import { checkTopics, findTextBeforeInput } from '../check-field-help';

const FORM = 'apps/web/src/app/form.tsx';
const HELP = 'apps/web/src/help/staff/staff-new.help.ts';

function lines(source: string): number[] {
  return findTextBeforeInput(FORM, source).map((p) => p.line);
}

function helpFile(topic: string): string {
  return `import { defineFieldHelp } from '@roviq/ui';
export const staffNewHelp = defineFieldHelp('staff.new', {
${topic}
});
`;
}

const OK_TOPIC = `  code: {
    title: { en: 'Code', hi: 'कोड' },
    body: { en: 'Printed on receipts.', hi: 'रसीद पर छपता है।' },
  },`;

const USE = { file: FORM, text: 'const x = <TextField help={staffNewHelp.code} />;' };

function problems(topic: string, appFiles = [USE], exists = () => true): string[] {
  return checkTopics([{ file: HELP, text: helpFile(topic) }], appFiles, exists).map(
    (p) => p.message,
  );
}

describe('check-field-help: text between a label and its input', () => {
  it('should flag a description placed before the input', () => {
    const source = `const a = (
  <Field>
    <FieldLabel htmlFor="code">Code</FieldLabel>
    <FieldDescription>Up to 8 letters.</FieldDescription>
    <Input id="code" />
  </Field>
);`;
    expect(lines(source)).toEqual([4]);
  });

  it('should flag a muted paragraph before a select', () => {
    const source = `const a = (
  <Field>
    <FieldLabel>Replacement</FieldLabel>
    <p className="text-sm text-muted-foreground">Choose one.</p>
    <Select><SelectTrigger /></Select>
  </Field>
);`;
    expect(lines(source)).toEqual([4]);
  });

  it('should accept a description after the input', () => {
    const source = `const a = (
  <Field>
    <FieldLabel htmlFor="code">Code</FieldLabel>
    <Input id="code" />
    <FieldDescription>Up to 8 letters.</FieldDescription>
  </Field>
);`;
    expect(lines(source)).toEqual([]);
  });

  it('should accept the topic hint before the input', () => {
    const source = `const a = (
  <Field>
    <FieldLabel htmlFor="code">Code</FieldLabel>
    <FieldHint topic={help.code} id="code-hint" />
    <Input id="code" />
  </Field>
);`;
    expect(lines(source)).toEqual([]);
  });

  it('should accept a read-only field that has no input', () => {
    const source = `const a = (
  <Field>
    <FieldLabel>Departments</FieldLabel>
    <FieldDescription>Offered by this institute.</FieldDescription>
    <div><Badge>Primary</Badge></div>
  </Field>
);`;
    expect(lines(source)).toEqual([]);
  });

  it('should treat the branches of a ternary as alternatives', () => {
    const source = `const a = (
  <Field>
    <FieldLabel>Institute</FieldLabel>
    {empty ? <p className="text-muted-foreground">None left.</p> : <Select />}
  </Field>
);`;
    expect(lines(source)).toEqual([]);
  });

  it('should flag text that an optional input follows', () => {
    const source = `const a = (
  <Field>
    <FieldLabel>Board</FieldLabel>
    <FieldDescription>Primary board.</FieldDescription>
    {ready && <BoardCombobox />}
  </Field>
);`;
    expect(lines(source)).toEqual([4]);
  });

  it('should accept text inside a nested element such as a horizontal field label column', () => {
    const source = `const a = (
  <Field orientation="horizontal">
    <FieldContent>
      <FieldLabel htmlFor="demo">Demo</FieldLabel>
      <FieldDescription>Hidden from reports.</FieldDescription>
    </FieldContent>
    <Switch id="demo" />
  </Field>
);`;
    expect(lines(source)).toEqual([]);
  });

  it('should not treat a form library wrapper as the Field component or an input', () => {
    const source = `const a = (
  <FieldSet>
    <FieldLegend variant="label">Lunch breaks</FieldLegend>
    <FieldDescription>Inserted after the chosen period.</FieldDescription>
    <form.Field name="lunch">
      {(field) => {
        if (rows.length === 0) return <p className="text-muted-foreground">None yet.</p>;
        return <Input id="lunch-0" />;
      }}
    </form.Field>
  </FieldSet>
);`;
    expect(lines(source)).toEqual([4]);
  });

  it('should accept a section intro under a plain legend', () => {
    const source = `const a = (
  <FieldSet>
    <FieldLegend>Contact</FieldLegend>
    <FieldDescription>How the institute is reached.</FieldDescription>
    <Field><FieldLabel htmlFor="p">Phone</FieldLabel><Input id="p" /></Field>
  </FieldSet>
);`;
    expect(lines(source)).toEqual([]);
  });
});

describe('check-field-help: help topics', () => {
  it('should accept a complete topic that a field uses', () => {
    expect(problems(OK_TOPIC)).toEqual([]);
  });

  it('should refuse an empty Hindi text', () => {
    expect(
      problems(`  code: {
    title: { en: 'Code', hi: '' },
    body: { en: 'Printed on receipts.', hi: 'रसीद पर छपता है।' },
  },`),
    ).toEqual(['staff.new.code.title.hi: empty']);
  });

  it('should refuse a missing locale', () => {
    expect(
      problems(`  code: {
    title: { en: 'Code' },
    body: { en: 'Printed on receipts.', hi: 'रसीद पर छपता है।' },
  },`),
    ).toEqual(['staff.new.code.title.hi: missing or not a string literal']);
  });

  it('should refuse a hint longer than the limit', () => {
    const long = 'x'.repeat(HELP_LIMITS.hint + 1);
    expect(
      problems(`  code: {
    title: { en: 'Code', hi: 'कोड' },
    hint: { en: '${long}', hi: 'छोटा' },
    body: { en: 'Printed on receipts.', hi: 'रसीद पर छपता है।' },
  },`),
    ).toEqual([
      `staff.new.code.hint.en: ${HELP_LIMITS.hint + 1} characters, the limit is ${HELP_LIMITS.hint}`,
    ]);
  });

  it('should refuse a topic no field uses', () => {
    expect(problems(OK_TOPIC, [])).toEqual([
      'topic staff.new.code is not used by any field (staffNewHelp.code)',
    ]);
  });

  it('should refuse an article whose file does not exist', () => {
    expect(
      problems(
        `  code: {
    title: { en: 'Code', hi: 'कोड' },
    body: { en: 'Printed on receipts.', hi: 'रसीद पर छपता है।' },
    article: () => import('./staff-new.articles').then((m) => m.code),
  },`,
        [USE],
        () => false,
      ),
    ).toEqual(['staff.new.code.article: ./staff-new.articles does not exist']);
  });

  it('should refuse the same topic id in two help files', () => {
    const text = helpFile(OK_TOPIC);
    const result = checkTopics(
      [
        { file: HELP, text },
        { file: 'apps/web/src/help/staff/other.help.ts', text },
      ],
      [USE],
      () => true,
    );
    expect(result.map((p) => p.message)).toEqual([
      `topic id staff.new.code is also declared in ${HELP}:3`,
    ]);
  });

  it('should refuse defineFieldHelp outside the help folder', () => {
    expect(problems(OK_TOPIC, [USE, { file: FORM, text: "defineFieldHelp('x', {});" }])).toEqual([
      `defineFieldHelp belongs in apps/web/src/help/`,
    ]);
  });
});
