import { bigint } from 'drizzle-orm/pg-core';

/** All monetary amounts stored in paise (1 INR = 100 paise). NEVER use floats for money. */
export const money = (columnName: string) =>
  bigint(columnName, { mode: 'bigint' }).notNull().default(0n);
