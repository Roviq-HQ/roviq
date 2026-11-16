/**
 * ROV-173 compliance #15 — bot API keys are stored only as argon2id hashes.
 *
 * Drives createBot and rotateBotApiKey through the real GraphQL pipeline, then reads
 * bot_profiles directly to prove the plaintext key never reaches the database.
 */
import assert from 'node:assert';
import { verify } from '@node-rs/argon2';
import { BotType } from '@roviq/common-types';
import { botProfiles, mkAdminCtx, withAdmin } from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

const CREATE_BOT = /* GraphQL */ `
  mutation CreateBot($input: CreateBotInput!) {
    createBot(input: $input) {
      apiKey
      bot {
        id
      }
    }
  }
`;

const ROTATE_BOT_KEY = /* GraphQL */ `
  mutation RotateBotApiKey($botId: ID!) {
    rotateBotApiKey(botId: $botId) {
      apiKey
    }
  }
`;

interface CreateBotResponse {
  createBot: { apiKey: string; bot: { id: string } };
}
interface RotateBotKeyResponse {
  rotateBotApiKey: { apiKey: string };
}

describe('Bot API key storage (integration)', () => {
  let result: IntegrationAppResult;
  let token: string;

  const storedHash = async (botId: string): Promise<string> => {
    const rows = await withAdmin(result.db, mkAdminCtx('test:bot'), (tx) =>
      tx
        .select({ apiKeyHash: botProfiles.apiKeyHash })
        .from(botProfiles)
        .where(eq(botProfiles.id, botId)),
    );
    const row = rows[0];
    assert(row);
    return row.apiKeyHash;
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    const institute = await createTestInstitute(result.db);
    token = createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  it('createBot stores an argon2id hash of the returned key, never the key itself', async () => {
    const res = await gqlRequest<CreateBotResponse>(result.httpServer, {
      query: CREATE_BOT,
      variables: { input: { botType: BotType.FEE_REMINDER } },
      token,
    });
    expect(res.errors).toBeUndefined();
    const created = res.data?.createBot;
    assert(created);

    const hash = await storedHash(created.bot.id);

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain(created.apiKey);
    expect(await verify(hash, created.apiKey)).toBe(true);
  });

  it('rotateBotApiKey replaces the hash; the old key no longer verifies', async () => {
    const createRes = await gqlRequest<CreateBotResponse>(result.httpServer, {
      query: CREATE_BOT,
      variables: { input: { botType: BotType.FEE_REMINDER } },
      token,
    });
    expect(createRes.errors).toBeUndefined();
    const created = createRes.data?.createBot;
    assert(created);

    const rotateRes = await gqlRequest<RotateBotKeyResponse>(result.httpServer, {
      query: ROTATE_BOT_KEY,
      variables: { botId: created.bot.id },
      token,
    });
    expect(rotateRes.errors).toBeUndefined();
    const rotatedKey = rotateRes.data?.rotateBotApiKey.apiKey;
    assert(rotatedKey);

    const hash = await storedHash(created.bot.id);

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain(rotatedKey);
    expect(await verify(hash, rotatedKey)).toBe(true);
    expect(await verify(hash, created.apiKey)).toBe(false);
  });
});
