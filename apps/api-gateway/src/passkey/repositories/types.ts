export interface AuthProviderRecord {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string | null;
  providerData: unknown;
  createdAt: Date;
}

export interface CreatePasskeyData {
  provider: 'passkey';
  providerUserId: string;
  providerData: unknown;
}
