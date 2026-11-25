/**
 * Component tests for the Leave Apply page.
 *
 * Mocks `next/navigation`, `nuqs`, `@roviq/auth`, and the feature's `use-leave`
 * hook. Also partial-mocks `@roviq/i18n` so the locale-aware `useRouter()` used
 * by the page resolves to a spy — the rest of the i18n exports (zodValidator,
 * translators) keep their real implementations so form validation runs.
 */
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';

// Radix Select uses pointer-capture APIs and scrollIntoView that happy-dom
// does not ship. These minimal shims let the trigger open and items select
// via click in this spec (and are idempotent if they're already defined).
if (typeof Element.prototype.hasPointerCapture === 'undefined') {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.setPointerCapture === 'undefined') {
  Element.prototype.setPointerCapture = () => {};
}
if (typeof Element.prototype.releasePointerCapture === 'undefined') {
  Element.prototype.releasePointerCapture = () => {};
}
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/leave/apply',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

vi.mock('nuqs', () => ({
  parseAsString: {
    withDefault: (defaultValue: string) => ({ __kind: 'string', defaultValue }),
  },
  parseAsInteger: {
    withDefault: (defaultValue: number) => ({ __kind: 'integer', defaultValue }),
  },
  useQueryState: (_key: string, parser?: { defaultValue?: unknown }) => [
    parser && 'defaultValue' in parser ? (parser.defaultValue as unknown) : null,
    vi.fn().mockResolvedValue(null),
  ],
}));

const pushMock = vi.fn();
vi.mock('@roviq/i18n', async () => {
  const actual = await vi.importActual<typeof import('@roviq/i18n')>('@roviq/i18n');
  return {
    ...actual,
    useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn() }),
  };
});

// UUID v7-shaped so the form's z.string().uuid() default passes with the prefilled applicant.
const OWN_MEMBERSHIP_ID = '018f3e2c-0000-7000-8000-000000000001';
vi.mock('@roviq/auth', () => ({
  useAuth: () => ({ user: { membershipId: OWN_MEMBERSHIP_ID } }),
}));

vi.mock('../../use-own-name', () => ({
  useOwnName: (skip: boolean) => (skip ? null : 'Asha Verma'),
}));

// The student profile id and the membership id differ on purpose: a leave belongs to the
// membership, so only the membership id may be sent.
const STUDENT = {
  id: '018f3e2c-0000-7000-8000-000000000701',
  membershipId: '018f3e2c-0000-7000-8000-000000000404',
  admissionNumber: 'S-2026/0001',
  firstName: { en: 'Priya' },
  lastName: { en: 'Singh' },
};

const SECOND_CHILD = {
  id: '018f3e2c-0000-7000-8000-000000000702',
  membershipId: '018f3e2c-0000-7000-8000-000000000406',
  admissionNumber: 'S-2026/0002',
  firstName: { en: 'Rohan' },
  lastName: { en: 'Singh' },
};
// Readable but not linked: the picker must still leave this student out for a guardian.
const UNLINKED_STUDENT = {
  id: '018f3e2c-0000-7000-8000-000000000703',
  membershipId: '018f3e2c-0000-7000-8000-000000000407',
  admissionNumber: 'S-2026/0003',
  firstName: { en: 'Kabir' },
  lastName: { en: 'Rao' },
};

const studentsState: { list: (typeof STUDENT)[] } = { list: [STUDENT] };
vi.mock('../../../people/students/use-students', () => ({
  useStudents: () => ({
    students: studentsState.list,
    totalCount: 1,
    hasNextPage: false,
    loading: false,
    loadMore: vi.fn(),
    refetch: vi.fn(),
  }),
}));

const applyMock = vi.fn();
vi.mock('../../use-leave', () => ({
  LEAVE_TYPE_VALUES: ['MEDICAL', 'CASUAL', 'BEREAVEMENT', 'EXAM', 'OTHER'] as const,
  useApplyLeave: () => ({ apply: applyMock, loading: false }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Import AFTER mocks.
import ApplyLeavePage from '../page';

// Drives a Radix Select trigger + option click using the pointer events the
// primitive actually listens on. Used for the FILES_REQUIRED refine test
// that needs a valid `type` enum before the refinement runs.
async function openAndSelectRadixOption(
  trigger: HTMLElement,
  optionName: string,
  user: ReturnType<typeof userEvent.setup>,
) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.pointerUp(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const option = await screen.findByRole('option', { name: optionName }, { timeout: 2000 });
  // Radix SelectItem selects on pointerUp AFTER a pointerDown on the same
  // item — mirror that sequence here.
  fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' });
  fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
  // Best-effort click for environments where the pointer pair alone
  // doesn't commit; Radix no-ops the second invocation.
  await user.click(option);
}

function graphQLError(code: string) {
  return new CombinedGraphQLErrors({
    errors: [{ message: 'raw server text', extensions: { code } }],
  });
}

// A one-day leave needs no document, so the form is valid once these are set.
async function fillValidLeave(user: ReturnType<typeof userEvent.setup>) {
  await openAndSelectRadixOption(screen.getByTestId('leave-apply-type-select'), 'Medical', user);
  await user.type(screen.getByTestId('leave-apply-start-date'), '2026-04-10');
  await user.type(screen.getByTestId('leave-apply-end-date'), '2026-04-10');
  await user.type(screen.getByTestId('leave-apply-reason'), 'Fever');
}

describe('ApplyLeavePage', () => {
  beforeEach(() => {
    applyMock.mockReset();
    applyMock.mockResolvedValue({});
    pushMock.mockReset();
    studentsState.list = [STUDENT];
  });

  it('renders the form shell with all expected fields', () => {
    renderWithProviders(<ApplyLeavePage />);
    expect(screen.getByTestId('leave-apply-title')).toBeInTheDocument();
    expect(screen.getByTestId('leave-apply-user-picker')).toBeInTheDocument();
    expect(screen.getByTestId('leave-apply-type-select')).toBeInTheDocument();
    expect(screen.getByTestId('leave-apply-start-date')).toBeInTheDocument();
    expect(screen.getByTestId('leave-apply-end-date')).toBeInTheDocument();
    expect(screen.getByTestId('leave-apply-reason')).toBeInTheDocument();
    expect(screen.getByTestId('file-upload-leave-apply-choose-btn')).toBeInTheDocument();
    expect(screen.getByTestId('leave-apply-submit-btn')).toBeInTheDocument();
  });

  it('submitting with no reason shows the reason validation error inline', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ApplyLeavePage />);

    // Pick a valid type so the reason validator is among the errors.
    await openAndSelectRadixOption(screen.getByTestId('leave-apply-type-select'), 'Medical', user);
    // Fill a 1-day range so the FILES_REQUIRED refine doesn't fire.
    await user.type(screen.getByTestId('leave-apply-start-date'), '2026-04-10');
    await user.type(screen.getByTestId('leave-apply-end-date'), '2026-04-10');

    // Touch the reason field without typing so `fieldErrorMessages()`
    // surfaces the z.string().min(1) error (it filters pristine fields).
    const reasonInput = screen.getByTestId('leave-apply-reason');
    await user.click(reasonInput);
    reasonInput.blur();

    await user.click(screen.getByTestId('leave-apply-submit-btn'));

    // The Zod `.min(1, t('fields.reason'))` message renders under the
    // textarea as a FieldError. Scope to the reason <Field> so we don't
    // match the label itself.
    const reasonField = screen.getByTestId('leave-apply-reason').closest('[data-slot="field"]');
    expect(reasonField).not.toBeNull();
    await waitFor(() => {
      if (!reasonField) throw new Error('reason field container missing');
      // The error row is under the textarea; the label also contains
      // "Reason" so we assert on a data-slot that only errors render.
      const errorEl = reasonField.querySelector('[data-slot="field-error"]');
      expect(errorEl).not.toBeNull();
    });
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('surfaces the files-required error for leaves longer than 2 days with no attachments', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ApplyLeavePage />);

    // Drive the Radix type select to a valid enum value so the schema's
    // `.refine(days > 2 && no files)` rule can actually run.
    await openAndSelectRadixOption(screen.getByTestId('leave-apply-type-select'), 'Medical', user);

    // 2026-04-10 → 2026-04-13 is a 4-day span which trips the
    // `FILES_REQUIRED_GT2_DAYS` refine.
    await user.type(screen.getByTestId('leave-apply-start-date'), '2026-04-10');
    await user.type(screen.getByTestId('leave-apply-end-date'), '2026-04-13');
    await user.type(screen.getByTestId('leave-apply-reason'), 'Wedding');

    // The message shows as soon as the dates need a document: the upload field cannot be
    // "touched" without picking a file, so it must not wait for that.
    await waitFor(() => {
      expect(screen.getByTestId('file-upload-leave-apply')).toHaveTextContent(
        'Leaves longer than 2 days require at least one supporting document.',
      );
    });
    const submit = screen.getByTestId('leave-apply-submit-btn');
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(screen.getByTestId('file-upload-leave-apply')).toHaveTextContent(
      'Leaves longer than 2 days require at least one supporting document.',
    );
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('shows access-denied copy and hides the form when ability denies create Leave', () => {
    renderWithProviders(<ApplyLeavePage />, {
      abilityRules: [
        { action: 'manage', subject: 'all' },
        { action: 'create', subject: 'Leave', inverted: true },
      ],
    });
    expect(screen.getByTestId('leave-apply-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('leave-apply-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('leave-apply-submit-btn')).not.toBeInTheDocument();
  });

  it('shows that a user who may not create leaves may not apply', () => {
    renderWithProviders(<ApplyLeavePage />, {
      abilityRules: [
        { action: 'manage', subject: 'all' },
        { action: 'create', subject: 'Leave', inverted: true },
      ],
    });
    expect(screen.getByTestId('leave-apply-access-denied')).toHaveTextContent(
      'You are not allowed to apply for leave.',
    );
  });

  it('labels the prefilled applicant with the signed-in person name, not an id prefix', () => {
    renderWithProviders(<ApplyLeavePage />);
    expect(screen.getByTestId('leave-apply-user-picker')).toHaveTextContent('Asha Verma');
  });

  it('applies for the picked student membership, not the student profile id', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ApplyLeavePage />);

    await user.click(screen.getByTestId('leave-apply-user-picker'));
    await user.click(await screen.findByTestId(`leave-apply-user-option-${STUDENT.membershipId}`));
    expect(screen.getByTestId('leave-apply-user-picker')).toHaveTextContent(
      'Priya Singh · S-2026/0001',
    );
    await fillValidLeave(user);
    await user.click(screen.getByTestId('leave-apply-submit-btn'));

    await waitFor(() =>
      expect(applyMock).toHaveBeenCalledWith({
        userId: STUDENT.membershipId,
        type: 'MEDICAL',
        startDate: '2026-04-10',
        endDate: '2026-04-10',
        reason: 'Fever',
        fileIds: [],
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('Leave application submitted.');
    expect(pushMock).toHaveBeenCalledWith('/leave');
  });

  it('explains a refused application as a leave rule, not as a file-upload error', async () => {
    applyMock.mockRejectedValue(graphQLError('FORBIDDEN'));
    const user = userEvent.setup();
    renderWithProviders(<ApplyLeavePage />);

    await fillValidLeave(user);
    await user.click(screen.getByTestId('leave-apply-submit-btn'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'You are not allowed to apply for leave for this person.',
      ),
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('still explains an attachment problem with the file-upload message', async () => {
    applyMock.mockRejectedValue(graphQLError('FILE_NOT_FOUND'));
    const user = userEvent.setup();
    renderWithProviders(<ApplyLeavePage />);

    await fillValidLeave(user);
    await user.click(screen.getByTestId('leave-apply-submit-btn'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'An uploaded file is no longer available. Remove it and upload it again.',
      ),
    );
  });

  describe('as a student or teacher', () => {
    // As the server sends them: `$user.*` placeholders already substituted.
    const SELF_RULES = [
      { action: 'create', subject: 'Leave', conditions: { userId: OWN_MEMBERSHIP_ID } },
    ] as const;

    it('shows their own name instead of a picker', () => {
      renderWithProviders(<ApplyLeavePage />, { abilityRules: [...SELF_RULES] });

      expect(screen.getByTestId('leave-apply-applicant-self')).toHaveTextContent('Asha Verma');
      expect(screen.queryByTestId('leave-apply-user-picker')).not.toBeInTheDocument();
    });

    it('applies for themself', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ApplyLeavePage />, { abilityRules: [...SELF_RULES] });

      await fillValidLeave(user);
      await user.click(screen.getByTestId('leave-apply-submit-btn'));

      await waitFor(() =>
        expect(applyMock).toHaveBeenCalledWith({
          userId: OWN_MEMBERSHIP_ID,
          type: 'MEDICAL',
          startDate: '2026-04-10',
          endDate: '2026-04-10',
          reason: 'Fever',
          fileIds: [],
        }),
      );
    });
  });

  describe('as a guardian', () => {
    const guardianRules = (childProfileIds: string[]) => [
      {
        action: 'create' as const,
        subject: 'Leave' as const,
        conditions: { studentProfileId: { $in: childProfileIds } },
      },
    ];

    it('lists only the linked children and does not start as the guardian', async () => {
      studentsState.list = [STUDENT, SECOND_CHILD, UNLINKED_STUDENT];
      const user = userEvent.setup();
      renderWithProviders(<ApplyLeavePage />, {
        abilityRules: guardianRules([STUDENT.id, SECOND_CHILD.id]),
      });

      const trigger = screen.getByTestId('leave-apply-user-picker');
      expect(trigger).toHaveTextContent('Select a person');
      expect(trigger).not.toHaveTextContent('Asha Verma');

      await user.click(trigger);
      expect(
        await screen.findByTestId(`leave-apply-user-option-${STUDENT.membershipId}`),
      ).toHaveTextContent('Priya Singh · S-2026/0001');
      expect(
        screen.getByTestId(`leave-apply-user-option-${SECOND_CHILD.membershipId}`),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(`leave-apply-user-option-${UNLINKED_STUDENT.membershipId}`),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(`leave-apply-user-option-${OWN_MEMBERSHIP_ID}`),
      ).not.toBeInTheDocument();
    });

    it('applies for the picked child’s membership', async () => {
      studentsState.list = [STUDENT, SECOND_CHILD, UNLINKED_STUDENT];
      const user = userEvent.setup();
      renderWithProviders(<ApplyLeavePage />, {
        abilityRules: guardianRules([STUDENT.id, SECOND_CHILD.id]),
      });

      await user.click(screen.getByTestId('leave-apply-user-picker'));
      await user.click(
        await screen.findByTestId(`leave-apply-user-option-${SECOND_CHILD.membershipId}`),
      );
      await fillValidLeave(user);
      await user.click(screen.getByTestId('leave-apply-submit-btn'));

      await waitFor(() =>
        expect(applyMock).toHaveBeenCalledWith({
          userId: SECOND_CHILD.membershipId,
          type: 'MEDICAL',
          startDate: '2026-04-10',
          endDate: '2026-04-10',
          reason: 'Fever',
          fileIds: [],
        }),
      );
    });

    it('preselects the only linked child', async () => {
      studentsState.list = [STUDENT, UNLINKED_STUDENT];
      const user = userEvent.setup();
      renderWithProviders(<ApplyLeavePage />, { abilityRules: guardianRules([STUDENT.id]) });

      await waitFor(() =>
        expect(screen.getByTestId('leave-apply-user-picker')).toHaveTextContent(
          'Priya Singh · S-2026/0001',
        ),
      );
      await fillValidLeave(user);
      await user.click(screen.getByTestId('leave-apply-submit-btn'));

      await waitFor(() =>
        expect(applyMock).toHaveBeenCalledWith({
          userId: STUDENT.membershipId,
          type: 'MEDICAL',
          startDate: '2026-04-10',
          endDate: '2026-04-10',
          reason: 'Fever',
          fileIds: [],
        }),
      );
    });
  });

  describe('required fields', () => {
    it('asks for a reason in words, not with the field label', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ApplyLeavePage />);

      await openAndSelectRadixOption(
        screen.getByTestId('leave-apply-type-select'),
        'Medical',
        user,
      );
      await user.type(screen.getByTestId('leave-apply-start-date'), '2026-04-10');
      await user.type(screen.getByTestId('leave-apply-end-date'), '2026-04-10');
      await user.type(screen.getByTestId('leave-apply-reason'), 'x');
      await user.clear(screen.getByTestId('leave-apply-reason'));
      await user.tab();

      expect(await screen.findByText('Enter a reason.')).toBeInTheDocument();
      const submit = screen.getByTestId('leave-apply-submit-btn');
      expect(submit).toBeEnabled();
      await user.click(submit);
      await waitFor(() => expect(screen.getByTestId('leave-apply-reason')).toHaveFocus());
      expect(applyMock).not.toHaveBeenCalled();
    });

    it('asks a guardian to choose the child', async () => {
      studentsState.list = [STUDENT, SECOND_CHILD];
      const user = userEvent.setup();
      renderWithProviders(<ApplyLeavePage />, {
        abilityRules: [
          {
            action: 'create',
            subject: 'Leave',
            conditions: { studentProfileId: { $in: [STUDENT.id, SECOND_CHILD.id] } },
          },
        ],
      });

      await fillValidLeave(user);
      // Not chosen yet, so not touched: no message before a submit attempt.
      expect(screen.queryByText('Choose who the leave is for.')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('leave-apply-submit-btn'));

      expect(await screen.findByText('Choose who the leave is for.')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('leave-apply-user-picker')).toHaveFocus());
      expect(applyMock).not.toHaveBeenCalled();
    });
  });

  it('lets someone who applies for anyone pick themself again after picking a student', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ApplyLeavePage />);

    await user.click(screen.getByTestId('leave-apply-user-picker'));
    await user.click(await screen.findByTestId(`leave-apply-user-option-${STUDENT.membershipId}`));
    await user.click(screen.getByTestId('leave-apply-user-picker'));
    const self = await screen.findByTestId(`leave-apply-user-option-${OWN_MEMBERSHIP_ID}`);
    expect(self).toHaveTextContent('Asha Verma');
    await user.click(self);
    expect(screen.getByTestId('leave-apply-user-picker')).toHaveTextContent('Asha Verma');

    await fillValidLeave(user);
    await user.click(screen.getByTestId('leave-apply-submit-btn'));

    await waitFor(() =>
      expect(applyMock).toHaveBeenCalledWith({
        userId: OWN_MEMBERSHIP_ID,
        type: 'MEDICAL',
        startDate: '2026-04-10',
        endDate: '2026-04-10',
        reason: 'Fever',
        fileIds: [],
      }),
    );
  });
});
