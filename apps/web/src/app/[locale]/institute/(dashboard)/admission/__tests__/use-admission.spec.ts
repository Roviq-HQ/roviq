import { print } from 'graphql';
import { describe, expect, it } from 'vitest';
import { LIST_ENQUIRIES_QUERY } from '../use-admission';

describe('enquiry list query', () => {
  // The row and the kanban card show the number; without this field they show none.
  it('asks for the enquiry number', () => {
    expect(print(LIST_ENQUIRIES_QUERY)).toMatch(/\benquiryNumber\b/);
  });
});
