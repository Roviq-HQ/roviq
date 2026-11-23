import { describe, expect, it } from 'vitest';
import { parseSmsReports } from '../sms-report';

const item = (requestId: string, ...statuses: Array<string | number>) => ({
  requestId,
  userId: '38229',
  senderId: 'ROVIQQ',
  report: statuses.map((status) => ({
    status,
    number: '919000000001',
    desc: 'text from the provider',
    date: '2026-11-23 17:09:32.0',
  })),
});

describe('parseSmsReports', () => {
  it('should read a JSON array body', () => {
    expect(parseSmsReports([item('req-1', '1'), item('req-2', '2')])).toEqual([
      { requestId: 'req-1', status: 'DELIVERED', errorCode: null },
      { requestId: 'req-2', status: 'FAILED', errorCode: 'SMS_UNDELIVERED' },
    ]);
  });

  it('should read a form field named data that holds the JSON array', () => {
    expect(parseSmsReports({ data: JSON.stringify([item('req-3', '16')]) })).toEqual([
      { requestId: 'req-3', status: 'FAILED', errorCode: 'SMS_REJECTED' },
    ]);
    expect(parseSmsReports({ data: [item('req-4', 9)] })).toEqual([
      { requestId: 'req-4', status: 'FAILED', errorCode: 'SMS_BLOCKED_BY_RECIPIENT' },
    ]);
  });

  it('should give one entry per recipient of a request and drop a status that is not final', () => {
    expect(parseSmsReports([item('req-5', '1', '8', 2, 'unknown')])).toEqual([
      { requestId: 'req-5', status: 'DELIVERED', errorCode: null },
      { requestId: 'req-5', status: 'FAILED', errorCode: 'SMS_UNDELIVERED' },
    ]);
  });

  it('should keep no phone number, description or institute id from the body', () => {
    const parsed = parseSmsReports([{ ...item('req-6', '1'), tenantId: 'tenant-from-body' }]);
    const text = JSON.stringify(parsed);
    for (const leaked of ['919000000001', 'text from the provider', 'tenant-from-body', '38229']) {
      expect(text).not.toContain(leaked);
    }
  });

  it.each([
    ['null', null],
    ['a string', 'data=[]'],
    ['an empty object', {}],
    ['a data field that is not JSON', { data: 'not json' }],
    ['a data field that is an object', { data: { requestId: 'x' } }],
    ['an item without a request id', [{ report: [{ status: '1' }] }]],
    ['an item with an empty request id', [{ requestId: '', report: [{ status: '1' }] }]],
    ['an item without a report', [{ requestId: 'req-7' }]],
  ])('should give nothing for %s, without throwing', (_label, body) => {
    expect(parseSmsReports(body)).toEqual([]);
  });

  it('should skip a malformed item and keep the good ones beside it', () => {
    expect(parseSmsReports([{ requestId: 7 }, item('req-8', '1')])).toEqual([
      { requestId: 'req-8', status: 'DELIVERED', errorCode: null },
    ]);
  });
});
