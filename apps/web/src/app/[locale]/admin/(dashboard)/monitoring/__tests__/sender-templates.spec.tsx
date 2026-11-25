import type { MockedResponse } from '@apollo/client/testing';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';
import { SenderTemplates } from '../_components/sender-templates';
import {
  AdminMessagingTemplatesDocument,
  type AdminMessagingTemplatesQuery,
  AdminSyncWhatsAppTemplatesDocument,
} from '../_lib/notification-health.graphql.generated';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { adminMonitoring: ids } = testIds;
const SENDER = 'sender-1';

type Row = AdminMessagingTemplatesQuery['adminMessagingTemplates'][number];
const row = (over: Partial<Row>): Row => ({
  __typename: 'AdminMessagingTemplate',
  name: 'attendance_absent_v1',
  language: 'en',
  status: 'APPROVED',
  declaredCategory: 'UTILITY',
  approvedCategory: 'UTILITY',
  rejectedReason: null,
  outOfStep: false,
  sendable: true,
  ...over,
});

function templates(rows: Row[]): MockedResponse<AdminMessagingTemplatesQuery> {
  return {
    request: { query: AdminMessagingTemplatesDocument, variables: { senderId: SENDER } },
    result: { data: { __typename: 'Query', adminMessagingTemplates: rows } },
  };
}

describe('SenderTemplates', () => {
  it('should count the templates and name each refused or changed one with its reason', async () => {
    renderWithProviders(<SenderTemplates senderId={SENDER} hasAccount />, {
      apolloMocks: [
        templates([
          row({}),
          row({ language: 'hi', status: 'PENDING', approvedCategory: null, sendable: false }),
          row({
            name: 'fee_overdue_v1',
            status: 'REJECTED',
            rejectedReason: 'INVALID_FORMAT',
            sendable: false,
          }),
          row({ name: 'delivery_canary_v1', approvedCategory: 'MARKETING', sendable: false }),
        ]),
      ],
    });

    expect(await screen.findByTestId(ids.senderTemplatesApproved(SENDER))).toHaveTextContent(
      '1 approved',
    );
    const problems = screen.getByTestId(ids.senderTemplatesProblems(SENDER));
    expect(problems).toHaveTextContent('fee_overdue_v1 (en): REJECTED, reason INVALID_FORMAT');
    expect(problems).toHaveTextContent(
      'delivery_canary_v1 (en): approved as MARKETING, declared UTILITY',
    );
    expect(problems).not.toHaveTextContent('attendance_absent_v1');
  });

  it('should say why nothing can be registered for a sender without an account', () => {
    renderWithProviders(<SenderTemplates senderId={SENDER} hasAccount={false} />, {
      apolloMocks: [],
    });

    expect(screen.getByTestId(ids.senderTemplatesNoAccount(SENDER))).toHaveTextContent(
      'no provider account id',
    );
  });

  it('should start a sync and say so', async () => {
    renderWithProviders(<SenderTemplates senderId={SENDER} hasAccount />, {
      apolloMocks: [
        templates([row({})]),
        {
          request: { query: AdminSyncWhatsAppTemplatesDocument, variables: { senderId: SENDER } },
          result: { data: { adminSyncWhatsAppTemplates: true } },
        },
      ],
    });

    await userEvent.click(await screen.findByTestId(ids.senderTemplatesSync(SENDER)));

    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
