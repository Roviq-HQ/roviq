/** Minimum length of a password a user chooses. */
export const NEW_PASSWORD_MIN_LENGTH = 8;

/** Rules a user-chosen password must meet; the server and the UI checklist both read this list. */
export const PASSWORD_RULE_IDS = [
  // At least NEW_PASSWORD_MIN_LENGTH characters.
  'MIN_LENGTH',
  // At least one upper-case and one lower-case letter.
  'MIXED_CASE',
  // At least one digit.
  'NUMBER',
] as const;
export type PasswordRuleId = (typeof PASSWORD_RULE_IDS)[number];

const RULE_CHECKS: Record<PasswordRuleId, (password: string) => boolean> = {
  MIN_LENGTH: (password) => password.length >= NEW_PASSWORD_MIN_LENGTH,
  MIXED_CASE: (password) => /\p{Lu}/u.test(password) && /\p{Ll}/u.test(password),
  NUMBER: (password) => /\p{Nd}/u.test(password),
};

/** Whether `password` meets one rule. */
export function meetsPasswordRule(password: string, rule: PasswordRuleId): boolean {
  return RULE_CHECKS[rule](password);
}

/** The rules `password` fails, in list order; empty when it is acceptable. */
export function failedPasswordRules(password: string): PasswordRuleId[] {
  return PASSWORD_RULE_IDS.filter((rule) => !RULE_CHECKS[rule](password));
}
