import { describe, expect, it } from 'vitest';
import { parseWebhookPayload } from '../webhook-payload';

const NUMBER_ID = 'fake-number-id-1';
const PROFILE_NAME = 'Sunita Guardian';
const SECRET_TEXT = 'my fee receipt number is 99881';
const TENANT_ID = '019a0000-0000-7000-8000-0000000000ff';

function change(value: Record<string, unknown>, field = 'messages') {
  return {
    field,
    value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '919000000099', phone_number_id: NUMBER_ID },
      ...value,
    },
  };
}

function body(...changes: unknown[]) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'fake-account-1', changes }] };
}

const CONTACT = { wa_id: '919000000001', user_id: 'fake-user-1', profile: { name: PROFILE_NAME } };

describe('parseWebhookPayload', () => {
  it.each(['sent', 'delivered', 'read'] as const)('should read a %s status', (status) => {
    const parsed = parseWebhookPayload(
      body(
        change({
          statuses: [
            {
              id: 'wamid.fake-1',
              status,
              timestamp: '1763900000',
              recipient_id: '919000000001',
              recipient_user_id: 'fake-user-1',
              conversation: { id: 'fake-conversation' },
              pricing: { billable: true, category: 'utility' },
            },
          ],
        }),
      ),
    );

    expect(parsed).toEqual([
      {
        providerNumberId: NUMBER_ID,
        receipts: [
          {
            messageId: 'wamid.fake-1',
            status,
            recipientPhone: '+919000000001',
            providerUserId: 'fake-user-1',
            providerErrorCode: null,
          },
        ],
        messages: [],
      },
    ]);
  });

  it('should read the error code of a failed status', () => {
    const parsed = parseWebhookPayload(
      body(
        change({
          statuses: [
            {
              id: 'wamid.fake-2',
              status: 'failed',
              recipient_id: '919000000001',
              errors: [{ code: 131026, title: 'Message undeliverable' }, { code: 1 }],
            },
          ],
        }),
      ),
    );

    expect(parsed).toEqual([
      {
        providerNumberId: NUMBER_ID,
        receipts: [
          {
            messageId: 'wamid.fake-2',
            status: 'failed',
            recipientPhone: '+919000000001',
            providerUserId: null,
            providerErrorCode: 131026,
          },
        ],
        messages: [],
      },
    ]);
  });

  it('should read a status carrying only a provider user id', () => {
    const [batch] = parseWebhookPayload(
      body(
        change({
          statuses: [{ id: 'wamid.fake-3', status: 'delivered', recipient_user_id: 'fake-user-9' }],
        }),
      ),
    );

    expect(batch?.receipts).toEqual([
      {
        messageId: 'wamid.fake-3',
        status: 'delivered',
        recipientPhone: null,
        providerUserId: 'fake-user-9',
        providerErrorCode: null,
      },
    ]);
  });

  it('should read an inbound stop request', () => {
    const parsed = parseWebhookPayload(
      body(
        change({
          contacts: [CONTACT],
          messages: [
            {
              from: '919000000001',
              id: 'wamid.in-1',
              timestamp: '1763900000',
              type: 'text',
              text: { body: 'STOP' },
            },
          ],
        }),
      ),
    );

    expect(parsed).toEqual([
      {
        providerNumberId: NUMBER_ID,
        receipts: [],
        messages: [
          {
            messageId: 'wamid.in-1',
            phone: '+919000000001',
            providerUserId: 'fake-user-1',
            stop: true,
          },
        ],
      },
    ]);
  });

  it('should read any other inbound text as not a stop request and keep none of it', () => {
    const parsed = parseWebhookPayload(
      body(
        change({
          contacts: [CONTACT],
          messages: [
            { from: '919000000001', id: 'wamid.in-2', type: 'text', text: { body: SECRET_TEXT } },
          ],
        }),
      ),
    );

    expect(parsed).toEqual([
      {
        providerNumberId: NUMBER_ID,
        receipts: [],
        messages: [
          {
            messageId: 'wamid.in-2',
            phone: '+919000000001',
            providerUserId: 'fake-user-1',
            stop: false,
          },
        ],
      },
    ]);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain(SECRET_TEXT);
    expect(serialized).not.toContain(PROFILE_NAME);
  });

  it('should take the phone from the contact when the message has no from', () => {
    const [batch] = parseWebhookPayload(
      body(
        change({
          contacts: [CONTACT],
          messages: [{ id: 'wamid.in-3', type: 'text', text: { body: 'hello' } }],
        }),
      ),
    );

    expect(batch?.messages).toEqual([
      {
        messageId: 'wamid.in-3',
        phone: '+919000000001',
        providerUserId: 'fake-user-1',
        stop: false,
      },
    ]);
  });

  it('should read a message from a person known only by a provider user id', () => {
    const [batch] = parseWebhookPayload(
      body(
        change({
          contacts: [{ user_id: 'fake-user-2', profile: { name: PROFILE_NAME } }],
          messages: [
            { from_user_id: 'fake-user-2', id: 'wamid.in-4', type: 'text', text: { body: 'stop' } },
          ],
        }),
      ),
    );

    expect(batch?.messages).toEqual([
      { messageId: 'wamid.in-4', phone: null, providerUserId: 'fake-user-2', stop: true },
    ]);
  });

  it('should drop a phone that is not digits', () => {
    const [batch] = parseWebhookPayload(
      body(change({ messages: [{ from: '+91 90000', id: 'wamid.in-5', text: { body: 'hi' } }] })),
    );

    expect(batch?.messages).toEqual([
      { messageId: 'wamid.in-5', phone: null, providerUserId: null, stop: false },
    ]);
  });

  it('should read a button reply whose text is a stop word', () => {
    const [batch] = parseWebhookPayload(
      body(
        change({
          contacts: [CONTACT],
          messages: [
            {
              from: '919000000001',
              id: 'wamid.in-6',
              type: 'button',
              button: { text: 'Stop', payload: 'fake-payload' },
            },
          ],
        }),
      ),
    );

    expect(batch?.messages).toEqual([
      {
        messageId: 'wamid.in-6',
        phone: '+919000000001',
        providerUserId: 'fake-user-1',
        stop: true,
      },
    ]);
  });

  it('should read several entries and changes in one body', () => {
    const parsed = parseWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'fake-account-1',
          changes: [
            change({ statuses: [{ id: 'wamid.a', status: 'delivered' }] }),
            change({ messages: [{ id: 'wamid.b', from: '919000000002', text: { body: 'stop' } }] }),
          ],
        },
        {
          id: 'fake-account-2',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'fake-number-id-2' },
                statuses: [{ id: 'wamid.c', status: 'read' }],
              },
            },
          ],
        },
      ],
    });

    expect(parsed).toEqual([
      {
        providerNumberId: NUMBER_ID,
        receipts: [
          {
            messageId: 'wamid.a',
            status: 'delivered',
            recipientPhone: null,
            providerUserId: null,
            providerErrorCode: null,
          },
        ],
        messages: [],
      },
      {
        providerNumberId: NUMBER_ID,
        receipts: [],
        messages: [
          { messageId: 'wamid.b', phone: '+919000000002', providerUserId: null, stop: true },
        ],
      },
      {
        providerNumberId: 'fake-number-id-2',
        receipts: [
          {
            messageId: 'wamid.c',
            status: 'read',
            recipientPhone: null,
            providerUserId: null,
            providerErrorCode: null,
          },
        ],
        messages: [],
      },
    ]);
  });

  it('should drop a change whose field is not messages', () => {
    const parsed = parseWebhookPayload(
      body(change({ statuses: [{ id: 'wamid.d', status: 'delivered' }] }, 'account_update')),
    );

    expect(parsed).toEqual([]);
  });

  it('should drop a change without metadata', () => {
    const parsed = parseWebhookPayload(
      body({ field: 'messages', value: { statuses: [{ id: 'wamid.e', status: 'delivered' }] } }),
    );

    expect(parsed).toEqual([]);
  });

  it('should drop unknown statuses and malformed items and keep the rest', () => {
    const parsed = parseWebhookPayload(
      body(
        change({
          statuses: [
            { id: 'wamid.f', status: 'deleted' },
            { id: '', status: 'delivered' },
            { status: 'delivered' },
            'not an object',
            null,
            { id: 'wamid.g', status: 'delivered', errors: 'not an array' },
            { id: 'wamid.h', status: 'delivered', brand_new_field: { nested: true } },
          ],
          messages: [42, { id: 7 }, { id: 'wamid.in-7', text: 'not an object' }],
        }),
      ),
    );

    expect(parsed).toEqual([
      {
        providerNumberId: NUMBER_ID,
        receipts: [
          {
            messageId: 'wamid.h',
            status: 'delivered',
            recipientPhone: null,
            providerUserId: null,
            providerErrorCode: null,
          },
        ],
        messages: [],
      },
    ]);
  });

  it('should give no batch for a change with nothing understood in it', () => {
    expect(
      parseWebhookPayload(body(change({ statuses: [{ id: 'x', status: 'deleted' }] }))),
    ).toEqual([]);
  });

  it.each([
    ['null', null],
    ['a string', 'not json'],
    ['an empty object', {}],
    ['an array', [1, 2]],
    ['entries that are not an array', { entry: 'nope' }],
    ['a number', 7],
  ])('should give no batch for %s', (_case, input) => {
    expect(parseWebhookPayload(input)).toEqual([]);
  });

  it('should never take a tenant id from the body', () => {
    const parsed = parseWebhookPayload({
      object: 'whatsapp_business_account',
      tenant_id: TENANT_ID,
      tenantId: TENANT_ID,
      entry: [
        {
          id: 'fake-account-1',
          tenantId: TENANT_ID,
          changes: [
            {
              ...change({
                tenant_id: TENANT_ID,
                contacts: [{ ...CONTACT, tenantId: TENANT_ID }],
                statuses: [{ id: 'wamid.i', status: 'delivered', tenant_id: TENANT_ID }],
                messages: [{ id: 'wamid.in-8', from: '919000000001', tenantId: TENANT_ID }],
              }),
              tenantId: TENANT_ID,
            },
          ],
        },
      ],
    });

    expect(parsed).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toContain(TENANT_ID);
    expect(JSON.stringify(parsed)).not.toContain('tenant');
  });
});
