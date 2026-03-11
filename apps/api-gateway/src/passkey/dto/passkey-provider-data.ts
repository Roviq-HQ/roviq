export interface PasskeyProviderData {
  publicKey: string;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  webauthnUserID: string;
  name: string;
  registeredAt: string;
  lastUsedAt: string | null;
  aaguid: string;
}
