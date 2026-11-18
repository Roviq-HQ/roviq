import type { AdminGetUserQuery, AdminListUsersQuery } from './use-users.generated';

export type UserListNode = AdminListUsersQuery['adminListUsers']['edges'][number]['node'];
export type UserDetail = AdminGetUserQuery['adminGetUser'];

export function formatPhone(phone: { countryCode: string; number: string } | null | undefined) {
  return phone ? `+${phone.countryCode} ${phone.number}` : null;
}
