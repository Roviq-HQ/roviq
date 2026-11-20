import { Card, CardContent } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import messagesEn from '@web-messages/en/students.json';
import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoveDocumentButton } from '../[id]/remove-document-button';
import {
  DELETE_STUDENT_DOCUMENT_MUTATION,
  STUDENT_DOCUMENTS_QUERY,
  useStudentDocuments,
} from '../use-students';

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const { instituteStudents: ids } = testIds;
const copy = messagesEn.detail.documents.remove;
const STUDENT = 'stu-1';

function documentNode(id: string, type: string) {
  return {
    __typename: 'StudentDocumentModel',
    id,
    userId: 'user-1',
    type,
    description: null,
    files: [
      {
        __typename: 'FileRefModel',
        id: `${id}-page`,
        name: 'page.pdf',
        contentType: 'application/pdf',
      },
    ],
    referenceNumber: null,
    isVerified: true,
    verifiedAt: null,
    verifiedBy: null,
    rejectionReason: null,
    expiryDate: null,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

const listMock = (documents: ReturnType<typeof documentNode>[]) => ({
  request: { query: STUDENT_DOCUMENTS_QUERY, variables: { studentProfileId: STUDENT } },
  result: { data: { listStudentDocuments: documents } },
});

const deleteMock = (result: {
  data?: { deleteStudentDocument: boolean };
  errors?: GraphQLError[];
}) => ({
  request: { query: DELETE_STUDENT_DOCUMENT_MUTATION, variables: { id: 'doc-1' } },
  result,
});

/** The documents list as the tab renders it, so a refetch shows up on screen. */
function DocumentsHarness() {
  const { data } = useStudentDocuments(STUDENT);
  return (
    <>
      {(data?.listStudentDocuments ?? []).map((doc) => (
        <Card key={doc.id} aria-label={doc.id}>
          <CardContent>
            <RemoveDocumentButton documentId={doc.id} type={doc.type} />
          </CardContent>
        </Card>
      ))}
    </>
  );
}

describe('RemoveDocumentButton', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('is hidden from a user who may not update students', async () => {
    renderWithProviders(<RemoveDocumentButton documentId="doc-1" type="BIRTH_CERTIFICATE" />, {
      abilityRules: [{ action: 'read', subject: 'Student' }],
    });

    expect(screen.queryByTestId(ids.detailDocumentRemoveBtn('doc-1'))).not.toBeInTheDocument();
  });

  it('asks for confirmation naming the document type and does nothing on cancel', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RemoveDocumentButton documentId="doc-1" type="AADHAAR_CARD" />);

    await user.click(screen.getByTestId(ids.detailDocumentRemoveBtn('doc-1')));
    const dialog = await screen.findByTestId(ids.detailDocumentRemoveDialog);
    expect(
      within(dialog).getByRole('heading', { name: 'Remove Aadhaar Card?' }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByTestId(ids.detailDocumentRemoveCancelBtn));
    await waitFor(() =>
      expect(screen.queryByTestId(ids.detailDocumentRemoveDialog)).not.toBeInTheDocument(),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('removes the document, confirms with a toast and refreshes the list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DocumentsHarness />, {
      apolloMocks: [
        listMock([documentNode('doc-1', 'BIRTH_CERTIFICATE'), documentNode('doc-2', 'NOC')]),
        deleteMock({ data: { deleteStudentDocument: true } }),
        listMock([documentNode('doc-2', 'NOC')]),
      ],
    });

    await user.click(await screen.findByTestId(ids.detailDocumentRemoveBtn('doc-1')));
    await user.click(await screen.findByTestId(ids.detailDocumentRemoveConfirmBtn));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(copy.success));
    await waitFor(() =>
      expect(screen.queryByTestId(ids.detailDocumentRemoveBtn('doc-1'))).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId(ids.detailDocumentRemoveBtn('doc-2'))).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it.each([
    ['STUDENT_NOT_FOUND', copy.notFound],
    ['FORBIDDEN', copy.forbidden],
    ['INTERNAL_SERVER_ERROR', copy.error],
  ])('shows the translated message for %s', async (code, message) => {
    const user = userEvent.setup();
    renderWithProviders(<DocumentsHarness />, {
      apolloMocks: [
        listMock([documentNode('doc-1', 'BIRTH_CERTIFICATE')]),
        deleteMock({ errors: [new GraphQLError('raw server text', { extensions: { code } })] }),
      ],
    });

    await user.click(await screen.findByTestId(ids.detailDocumentRemoveBtn('doc-1')));
    await user.click(await screen.findByTestId(ids.detailDocumentRemoveConfirmBtn));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(message));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('drops the card when the document was already removed elsewhere', async () => {
    const user = userEvent.setup();
    const refetched = vi.fn(() => ({ data: { listStudentDocuments: [] } }));
    renderWithProviders(<DocumentsHarness />, {
      apolloMocks: [
        listMock([documentNode('doc-1', 'BIRTH_CERTIFICATE')]),
        deleteMock({
          errors: [new GraphQLError('gone', { extensions: { code: 'STUDENT_NOT_FOUND' } })],
        }),
        {
          request: { query: STUDENT_DOCUMENTS_QUERY, variables: { studentProfileId: STUDENT } },
          result: refetched,
          delay: 0,
        },
      ],
    });

    await user.click(await screen.findByTestId(ids.detailDocumentRemoveBtn('doc-1')));
    await user.click(await screen.findByTestId(ids.detailDocumentRemoveConfirmBtn));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(copy.notFound));
    await waitFor(() =>
      expect(screen.queryByTestId(ids.detailDocumentRemoveBtn('doc-1'))).not.toBeInTheDocument(),
    );
    expect(refetched).toHaveBeenCalledTimes(1);
  });

  // The document still exists after these, so the card stays for a retry.
  it.each([
    ['FORBIDDEN', copy.forbidden],
    ['INTERNAL_SERVER_ERROR', copy.error],
  ])('keeps the card without refetching after %s', async (code, message) => {
    const user = userEvent.setup();
    const refetched = vi.fn(() => ({ data: { listStudentDocuments: [] } }));
    renderWithProviders(<DocumentsHarness />, {
      apolloMocks: [
        listMock([documentNode('doc-1', 'BIRTH_CERTIFICATE')]),
        deleteMock({ errors: [new GraphQLError('raw server text', { extensions: { code } })] }),
        {
          request: { query: STUDENT_DOCUMENTS_QUERY, variables: { studentProfileId: STUDENT } },
          result: refetched,
          delay: 0,
        },
      ],
    });

    await user.click(await screen.findByTestId(ids.detailDocumentRemoveBtn('doc-1')));
    await user.click(await screen.findByTestId(ids.detailDocumentRemoveConfirmBtn));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(message));

    // A further round trip through the dialog gives a stray refetch time to land.
    await user.click(screen.getByTestId(ids.detailDocumentRemoveBtn('doc-1')));
    await user.click(await screen.findByTestId(ids.detailDocumentRemoveCancelBtn));
    await waitFor(() =>
      expect(screen.queryByTestId(ids.detailDocumentRemoveDialog)).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId(ids.detailDocumentRemoveBtn('doc-1'))).toBeInTheDocument();
    expect(refetched).not.toHaveBeenCalled();
  });
});
