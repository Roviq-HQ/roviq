import { describe, expect, it } from 'vitest';
import {
  BASELINE_FILE,
  buildBaseline,
  compareWithBaseline,
  countByFile,
  FIX_HINT,
  findFormToastErrors,
  parseBaseline,
} from '../check-form-errors';

const FILE = 'apps/web/src/app/form/page.tsx';

function lines(source: string): number[] {
  return findFormToastErrors(FILE, source).map((v) => v.line);
}

describe('check-form-errors: finding toast.error in submit handlers', () => {
  it('should find toast.error inside an inline onSubmit', () => {
    const source = `const form = useAppForm({
  defaultValues: {},
  onSubmit: async () => {
    toast.error('Failed');
  },
});`;
    expect(lines(source)).toEqual([4]);
  });

  it('should find toast.error inside a catch nested in a callback of onSubmit', () => {
    const source = `const form = useAppForm({
  onSubmit: async ({ value }) => {
    await save(value).then(() => {
      try {
        run();
      } catch (err) {
        toast.error(t('failed'));
      }
    });
  },
});`;
    expect(lines(source)).toEqual([7]);
  });

  it('should find toast.error inside onSubmitInvalid', () => {
    const source = `const form = useAppForm({
  onSubmit: () => undefined,
  onSubmitInvalid: () => {
    toast.error(t('fix'));
  },
});`;
    expect(lines(source)).toEqual([4]);
  });

  it('should find toast.error in a same-file handler passed by name', () => {
    const source = `async function handleSave(value) {
  try {
    await save(value);
  } catch {
    toast.error('x');
  }
}
const handleOther = () => toast.error('y');
const form = useAppForm({ onSubmit: handleSave });
const other = useForm({ onSubmit: handleOther });`;
    expect(lines(source)).toEqual([5, 8]);
  });

  it('should find toast.error in a shorthand onSubmit and in a method', () => {
    const source = `const onSubmit = () => { toast.error('a'); };
const a = useAppForm({ onSubmit });
const b = useAppForm({
  onSubmitInvalid() {
    toast.error('b');
  },
});`;
    expect(lines(source)).toEqual([1, 5]);
  });

  it('should count a handler shared by onSubmit and onSubmitInvalid once', () => {
    const source = `const fail = () => toast.error('a');
const form = useAppForm({ onSubmit: fail, onSubmitInvalid: fail });`;
    expect(lines(source)).toEqual([1]);
  });

  it('should ignore toast.error elsewhere in the same file', () => {
    const source = `const form = useAppForm({
  onSubmit: async () => {
    await save();
  },
});
const handleDelete = async () => {
  try {
    await remove();
  } catch {
    toast.error(t('deleteFailed'));
  }
};`;
    expect(lines(source)).toEqual([]);
  });

  it('should ignore toast.success in onSubmit', () => {
    const source = `const form = useAppForm({
  onSubmit: async () => {
    toast.success(t('saved'));
  },
});`;
    expect(lines(source)).toEqual([]);
  });

  it('should ignore an onSubmit on an object that is not passed to a form hook', () => {
    const source = `const config = {
  onSubmit: () => {
    toast.error('x');
  },
};
useDialog({ onSubmit: () => toast.error('y') });
const form = useAppForm(config);`;
    expect(lines(source)).toEqual([]);
  });
});

describe('check-form-errors: baseline', () => {
  const found = (count: number) =>
    countByFile(Array.from({ length: count }, (_, i) => ({ file: FILE, line: i + 10 })));

  it('should fail a file that is not in the baseline and print each call with the fix', () => {
    const failures = compareWithBaseline(found(2), {});

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(`${FILE}:10`);
    expect(failures[0]).toContain(`${FILE}:11`);
    expect(failures[0]).toContain('not in the baseline');
    expect(failures[0]).toContain(FIX_HINT);
  });

  it('should fail a count above the baseline', () => {
    const failures = compareWithBaseline(found(3), { [FILE]: 2 });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('baseline allows 2');
  });

  it('should fail a count below the baseline and ask for the entry to be lowered', () => {
    const failures = compareWithBaseline(found(1), { [FILE]: 2 });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(`lower its entry in ${BASELINE_FILE} to 1`);
  });

  it('should fail a clean or deleted file still in the baseline and ask for its removal', () => {
    const failures = compareWithBaseline(new Map(), { [FILE]: 1 });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(`remove its entry from ${BASELINE_FILE}`);
  });

  it('should pass a count equal to the baseline', () => {
    expect(compareWithBaseline(found(2), { [FILE]: 2 })).toEqual([]);
  });

  it('should build a baseline sorted by path', () => {
    const map = countByFile([
      { file: 'apps/web/src/b.tsx', line: 1 },
      { file: 'apps/web/src/a.tsx', line: 3 },
      { file: 'apps/web/src/a.tsx', line: 9 },
    ]);

    expect(JSON.stringify(buildBaseline(map))).toBe(
      JSON.stringify({ 'apps/web/src/a.tsx': 2, 'apps/web/src/b.tsx': 1 }),
    );
  });

  it('should refuse a baseline entry that is not a positive whole number', () => {
    expect(() => parseBaseline(JSON.stringify({ [FILE]: 0 }))).toThrow(BASELINE_FILE);
    expect(() => parseBaseline(JSON.stringify([FILE]))).toThrow(BASELINE_FILE);
    expect(parseBaseline(null)).toEqual({});
  });
});
