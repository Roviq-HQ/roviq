import type { CreateUserData, UserRecord } from './types';

export abstract class UserRepository {
  abstract create(data: CreateUserData): Promise<UserRecord>;
  abstract findById(id: string): Promise<UserRecord | null>;
  abstract findByUsername(username: string): Promise<UserRecord | null>;
}
