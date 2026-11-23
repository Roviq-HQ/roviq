import type { NewAuthEventRecord } from './types';

export abstract class AuthEventRepository {
  abstract insert(record: NewAuthEventRecord): Promise<void>;
}
