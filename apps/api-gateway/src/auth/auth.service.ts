import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { AbilityFactory } from '@roviq/casl';
import type { AbilityRule, AuthScope, AuthUser, InstituteContext } from '@roviq/common-types';
import {
  BusinessException,
  ErrorCode,
  NEW_PASSWORD_MIN_LENGTH,
  ResellerStatus,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import type { AuthSecurityEvent } from '@roviq/notifications';
import { NOTIFICATION_SUBJECTS } from '@roviq/notifications';
import { AuthEventService } from './auth-event.service';
import type { AuthPayload, InstituteLoginResult } from './dto/auth-payload';
import type { RegisterInput } from './dto/register.input';
import { LoginLockoutService } from './login-lockout.service';
import { MembershipRepository } from './repositories/membership.repository';
import { PlatformMembershipRepository } from './repositories/platform-membership.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import { ResellerMembershipRepository } from './repositories/reseller-membership.repository';
import type { RefreshTokenWithRelations, UserRecord } from './repositories/types';
import { UserRepository } from './repositories/user.repository';

const ACCOUNT_LOCKED_MESSAGE = 'Too many attempts. Try again in 30 minutes.';

// ── Token payload types ──────────────────────────────────

interface AccessTokenPayload {
  sub: string;
  scope: AuthScope;
  tenantId?: string;
  resellerId?: string;
  membershipId: string;
  roleId: string;
  type: 'access';
  /** ROV-96 — first-login enforcement claim. Read by MustChangePasswordGuard via JwtStrategy. */
  mustChangePassword?: boolean;
  // Impersonation fields (optional)
  isImpersonated?: boolean;
  impersonatorId?: string;
  impersonationSessionId?: string;
}

interface RefreshTokenPayload {
  sub: string;
  tokenId: string;
  membershipId: string;
  type: 'refresh';
}

// TTL per scope (seconds)
const ACCESS_TTL_SECONDS: Record<AuthScope, number> = {
  platform: 5 * 60,
  reseller: 10 * 60,
  institute: 15 * 60,
};
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

interface RefreshMembership {
  scope: AuthScope;
  tenantId?: string;
  resellerId?: string;
  membershipId: string;
  roleId: string;
  roleAbilities: Record<string, unknown>[];
  membershipAbilities: Record<string, unknown>[] | null;
}

interface RequestMeta {
  ip?: string;
  userAgent?: string;
  deviceInfo?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly userRepo: UserRepository,
    private readonly membershipRepo: MembershipRepository,
    private readonly platformMembershipRepo: PlatformMembershipRepository,
    private readonly resellerMembershipRepo: ResellerMembershipRepository,
    private readonly refreshTokenRepo: RefreshTokenRepository,
    private readonly authEventService: AuthEventService,
    private readonly abilityFactory: AbilityFactory,
    private readonly lockout: LoginLockoutService,
    private readonly eventBus: EventBusService,
  ) {}

  getPreferredLocale(userId: string): Promise<string | null> {
    return this.userRepo.getPreferredLocale(userId);
  }

  async updatePreferredLocale(userId: string, locale: string | null): Promise<string | null> {
    await this.userRepo.updatePreferredLocale(userId, locale);
    return locale;
  }

  // ── Registration ───────────────────────────────────────

  async register(input: RegisterInput): Promise<AuthPayload> {
    const passwordHash = await hash(input.password);
    const user = await this.userRepo.create({
      username: input.username,
      email: input.email,
      passwordHash,
    });
    return {
      user: { id: user.id, username: user.username, email: user.email },
    };
  }

  // ── Three login mutations ──────────────────────────────

  async adminLogin(username: string, password: string, meta?: RequestMeta): Promise<AuthPayload> {
    const user = await this.verifyCredentials(username, password, meta);

    const membership = await this.platformMembershipRepo.findByUserId(user.id);
    if (!membership?.isActive) {
      this.rejectWrongPortal(user.id, 'platform', meta);
    }

    const result = await this.issueTokens({
      user,
      scope: 'platform',
      membershipId: membership.id,
      roleId: membership.roleId,
      roleAbilities: membership.role.abilities as Record<string, unknown>[],
      membershipAbilities: membership.abilities as Record<string, unknown>[] | null,
      meta,
    });

    if (result.user) {
      result.user.abilityRules = await this.getAbilityRules(
        user.id,
        'platform',
        undefined,
        membership.id,
        membership.roleId,
      );
      result.user.primaryNavSlugs = await this.getPrimaryNavSlugs(membership.roleId);
    }

    this.authEventService
      .emit({
        userId: user.id,
        type: 'login_success',
        scope: 'platform',
        authMethod: 'password',
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        deviceInfo: meta?.deviceInfo,
      })
      .catch(() => {});
    this.emitLoginNotification(user.id, null, meta);

    return result;
  }

  async resellerLogin(
    username: string,
    password: string,
    meta?: RequestMeta,
  ): Promise<AuthPayload> {
    const user = await this.verifyCredentials(username, password, meta);

    const memberships = await this.resellerMembershipRepo.findByUserId(user.id);
    const m = memberships[0];
    if (!m?.reseller.isActive || m.reseller.status !== ResellerStatus.ACTIVE) {
      this.rejectWrongPortal(user.id, 'reseller', meta);
    }

    const result = await this.issueTokens({
      user,
      scope: 'reseller',
      resellerId: m.resellerId,
      membershipId: m.id,
      roleId: m.roleId,
      roleAbilities: m.role.abilities as Record<string, unknown>[],
      membershipAbilities: m.abilities as Record<string, unknown>[] | null,
      meta,
    });

    this.authEventService
      .emit({
        userId: user.id,
        type: 'login_success',
        scope: 'reseller',
        resellerId: m.resellerId,
        authMethod: 'password',
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        deviceInfo: meta?.deviceInfo,
      })
      .catch(() => {});

    if (result.user) {
      result.user.abilityRules = await this.getAbilityRules(
        user.id,
        'reseller',
        undefined,
        m.id,
        m.roleId,
      );
      result.user.primaryNavSlugs = await this.getPrimaryNavSlugs(m.roleId);
    }
    this.emitLoginNotification(user.id, null, meta);

    return result;
  }

  async instituteLogin(
    username: string,
    password: string,
    meta?: RequestMeta,
  ): Promise<InstituteLoginResult> {
    const user = await this.verifyCredentials(username, password, meta);

    const memberships = await this.membershipRepo.findActiveByUserId(user.id);
    if (memberships.length === 0) {
      this.rejectWrongPortal(user.id, 'institute', meta);
    }

    if (memberships.length === 1) {
      const m = memberships[0];
      const result = await this.issueTokens({
        user,
        scope: 'institute',
        tenantId: m.tenantId,
        resellerId: m.institute.resellerId,
        membershipId: m.id,
        roleId: m.roleId,
        roleAbilities: m.role.abilities as Record<string, unknown>[],
        membershipAbilities: m.abilities as Record<string, unknown>[] | null,
        meta,
      });

      this.authEventService
        .emit({
          userId: user.id,
          type: 'login_success',
          scope: 'institute',
          tenantId: m.tenantId,
          authMethod: 'password',
          ip: meta?.ip,
          userAgent: meta?.userAgent,
          deviceInfo: meta?.deviceInfo,
        })
        .catch(() => {});

      if (result.user) {
        result.user.abilityRules = await this.getAbilityRules(
          user.id,
          'institute',
          m.tenantId,
          m.id,
          m.roleId,
        );
        result.user.primaryNavSlugs = await this.getPrimaryNavSlugs(m.roleId);
      }
      this.emitLoginNotification(user.id, m.tenantId, meta);

      return result;
    }

    // Multiple institutes — return membership list for picker
    const selectionToken = this.jwtService.sign(
      { sub: user.id, purpose: 'institute-selection' },
      { secret: this.config.getOrThrow<string>('JWT_SECRET'), expiresIn: 300 },
    );

    return {
      requiresInstituteSelection: true,
      userId: user.id,
      selectionToken,
      memberships: memberships.map((m) => ({
        membershipId: m.id,
        tenantId: m.tenantId,
        roleId: m.roleId,
        instituteName: m.institute.name,
        instituteSlug: m.institute.slug,
        instituteLogoUrl: m.institute.logoUrl ?? undefined,
        roleName: m.role.name,
      })),
    };
  }

  // ── Passkey login (no password, institute scope) ────────

  async instituteLoginByUserId(userId: string, meta?: RequestMeta): Promise<InstituteLoginResult> {
    const user = await this.userRepo.findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials');
    }

    const memberships = await this.membershipRepo.findActiveByUserId(user.id);
    if (memberships.length === 0) {
      throw new BusinessException(ErrorCode.ACCOUNT_NOT_FOUND, 'No account found');
    }

    if (memberships.length === 1) {
      const m = memberships[0];
      const result = await this.issueTokens({
        user,
        scope: 'institute',
        tenantId: m.tenantId,
        resellerId: m.institute.resellerId,
        membershipId: m.id,
        roleId: m.roleId,
        roleAbilities: m.role.abilities as Record<string, unknown>[],
        membershipAbilities: m.abilities as Record<string, unknown>[] | null,
        meta,
      });

      this.authEventService
        .emit({
          userId: user.id,
          type: 'login_success',
          scope: 'institute',
          tenantId: m.tenantId,
          authMethod: 'passkey',
          ip: meta?.ip,
          userAgent: meta?.userAgent,
          deviceInfo: meta?.deviceInfo,
        })
        .catch(() => {});

      return result;
    }

    const selectionToken = this.jwtService.sign(
      { sub: user.id, purpose: 'institute-selection' },
      { secret: this.config.getOrThrow<string>('JWT_SECRET'), expiresIn: 300 },
    );

    return {
      requiresInstituteSelection: true,
      userId: user.id,
      selectionToken,
      memberships: memberships.map((m) => ({
        membershipId: m.id,
        tenantId: m.tenantId,
        roleId: m.roleId,
        instituteName: m.institute.name,
        instituteSlug: m.institute.slug,
        instituteLogoUrl: m.institute.logoUrl ?? undefined,
        roleName: m.role.name,
      })),
    };
  }

  // ── Institute selection (after multi-institute login) ──

  async selectInstitute(
    selectionToken: string,
    membershipId: string,
    meta?: RequestMeta,
  ): Promise<AuthPayload> {
    let userId: string;
    try {
      const payload = this.jwtService.verify(selectionToken, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      if (payload.purpose !== 'institute-selection') {
        throw new Error('wrong purpose');
      }
      userId = payload.sub;
    } catch {
      throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'Invalid or expired selection token');
    }

    const membership = await this.membershipRepo.findByIdAndUser(membershipId, userId);
    if (!membership || membership.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.NO_ACTIVE_MEMBERSHIP, 'No active membership found');
    }

    const user = await this.userRepo.findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.ACCOUNT_INACTIVE, 'User not found or inactive');
    }

    const result = await this.issueTokens({
      user,
      scope: 'institute',
      tenantId: membership.tenantId,
      resellerId: membership.institute.resellerId,
      membershipId: membership.id,
      roleId: membership.roleId,
      roleAbilities: membership.role.abilities as Record<string, unknown>[],
      membershipAbilities: membership.abilities as Record<string, unknown>[] | null,
      meta,
    });

    if (result.user) {
      result.user.abilityRules = await this.getAbilityRules(
        user.id,
        'institute',
        membership.tenantId,
        membership.id,
        membership.roleId,
      );
      result.user.primaryNavSlugs = await this.getPrimaryNavSlugs(membership.roleId);
    }

    // Multi-institute login completes here (single-institute completes in
    // instituteLogin). Emit the same login-success signals so the audit
    // trail + login notification pipeline fire regardless of which path
    // the user took.
    this.authEventService
      .emit({
        userId: user.id,
        type: 'login_success',
        scope: 'institute',
        tenantId: membership.tenantId,
        authMethod: 'password',
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        deviceInfo: meta?.deviceInfo,
      })
      .catch(() => {});

    this.emitLoginNotification(user.id, membership.tenantId, meta);

    return result;
  }

  // ── Institute switching (already authenticated) ────────

  async switchInstitute(
    current: InstituteContext,
    targetMembershipId: string,
    currentRefreshToken: string,
    meta?: RequestMeta,
  ): Promise<AuthPayload> {
    // An impersonation token must never be traded for a renewable session.
    if (current.isImpersonated) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'Cannot switch institute while impersonating',
      );
    }
    const userId = current.userId;

    const currentToken = await this.refreshTokenRepo.findByHash(
      this.hashToken(currentRefreshToken),
    );
    if (!currentToken || currentToken.userId !== userId) {
      throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'Invalid refresh token');
    }

    const membership = await this.membershipRepo.findByIdAndUser(targetMembershipId, userId);
    if (!membership || membership.status !== 'ACTIVE') {
      throw new BusinessException(
        ErrorCode.NO_ACTIVE_MEMBERSHIP,
        'No active membership for target institute',
      );
    }

    const user = await this.userRepo.findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.ACCOUNT_INACTIVE, 'User not found or inactive');
    }

    // Revoked only once the switch is certain, so a rejected switch keeps the
    // session. `user_initiated`: replaying the old token must not cascade.
    await this.refreshTokenRepo.revoke(currentToken.id, 'user_initiated');

    const result = await this.issueTokens({
      user,
      scope: 'institute',
      tenantId: membership.tenantId,
      resellerId: membership.institute.resellerId,
      membershipId: membership.id,
      roleId: membership.roleId,
      roleAbilities: membership.role.abilities as Record<string, unknown>[],
      membershipAbilities: membership.abilities as Record<string, unknown>[] | null,
      meta,
    });

    if (result.user) {
      result.user.abilityRules = await this.getAbilityRules(
        user.id,
        'institute',
        membership.tenantId,
        membership.id,
        membership.roleId,
      );
      result.user.primaryNavSlugs = await this.getPrimaryNavSlugs(membership.roleId);
    }

    this.authEventService
      .emit({
        userId,
        type: 'institute_switch',
        scope: 'institute',
        tenantId: membership.tenantId,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        deviceInfo: meta?.deviceInfo,
        metadata: {
          from_tenant_id: current.tenantId,
          to_tenant_id: membership.tenantId,
        },
      })
      .catch(() => {});

    return result;
  }

  // ── Token refresh ──────────────────────────────────────

  async refreshToken(token: string, meta?: RequestMeta): Promise<AuthPayload> {
    const payload = this.verifyRefreshTokenPayload(token);
    const storedToken = await this.loadAndValidateStoredRefreshToken(token, payload);

    // Fresh DB read so the new access token reflects the current status and
    // mustChangePassword, not the values joined onto the token row.
    const user = await this.userRepo.findById(storedToken.user.id);
    if (!user) {
      throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'Invalid refresh token');
    }
    if (user.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.ACCOUNT_INACTIVE, 'User not found or inactive');
    }

    const scope = storedToken.membershipScope as AuthScope;
    const membership = await this.resolveRefreshMembership(scope, user.id, payload.membershipId);

    // Rotated only after the membership check: a rejected refresh must not
    // leave a `rotation` row behind, or the client's retry would trip reuse
    // detection and revoke the user's sessions in other institutes.
    await this.refreshTokenRepo.revoke(storedToken.id, 'rotation');

    const result = await this.issueTokens({ user, ...membership, meta });

    this.authEventService
      .emit({
        userId: user.id,
        type: 'token_refresh',
        scope,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        deviceInfo: meta?.deviceInfo,
      })
      .catch(() => {});

    return result;
  }

  // ── Logout ─────────────────────────────────────────────

  /** Ends the caller's current session only; other devices stay signed in. */
  async logout(current: AuthUser, currentRefreshToken: string, meta?: RequestMeta): Promise<void> {
    // The impersonator holds no session of the target; nothing here is theirs to end.
    if (current.isImpersonated) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'Cannot log out while impersonating');
    }

    // A token that is already revoked is not found: logging out twice succeeds.
    const session = await this.refreshTokenRepo.findByHash(this.hashToken(currentRefreshToken));
    if (session) {
      if (session.userId !== current.userId) {
        throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'Invalid refresh token');
      }
      await this.refreshTokenRepo.revoke(session.id, 'user_initiated');
    }

    this.authEventService
      .emit({
        userId: current.userId,
        type: 'logout',
        scope: current.scope,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        deviceInfo: meta?.deviceInfo,
      })
      .catch(() => {});
  }

  // ── Session management ─────────────────────────────────

  async getActiveSessions(userId: string, currentRefreshToken: string) {
    const tokenHash = createHash('sha256').update(currentRefreshToken).digest('hex');
    const sessions = await this.refreshTokenRepo.findActiveByUserId(userId);
    if (!sessions.some((session) => session.tokenHash === tokenHash)) {
      throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'Invalid refresh token');
    }
    return sessions.map((session) => ({
      ...session,
      isCurrent: session.tokenHash === tokenHash,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    // Verify the session belongs to this user
    const session = await this.refreshTokenRepo.findByIdWithRelations(sessionId);
    if (!session || session.userId !== userId) {
      throw new BusinessException(ErrorCode.SESSION_NOT_FOUND, 'Session not found');
    }
    await this.refreshTokenRepo.revoke(sessionId, 'user_initiated');
  }

  async revokeAllOtherSessions(
    userId: string,
    currentRefreshToken: string,
    meta?: RequestMeta,
  ): Promise<void> {
    const tokenHash = createHash('sha256').update(currentRefreshToken).digest('hex');
    const currentToken = await this.refreshTokenRepo.findByHash(tokenHash);
    if (!currentToken || currentToken.userId !== userId) {
      throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'Invalid refresh token');
    }
    await this.refreshTokenRepo.revokeAllOtherForUser(userId, currentToken.id, 'user_initiated');

    this.authEventService
      .emit({
        userId,
        type: 'all_sessions_revoked',
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        deviceInfo: meta?.deviceInfo,
        metadata: { reason: 'user_initiated' },
      })
      .catch(() => {});
  }

  // ── User queries ───────────────────────────────────────

  async getUserById(id: string): Promise<UserRecord | null> {
    return this.userRepo.findById(id);
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.userRepo.findById(userId);
    if (!user) return false;
    return verify(user.passwordHash, password);
  }

  // ── Password change (ROV-96) ───────────────────────────

  /**
   * Rotate the authenticated user's password.
   *
   * 1. Verify current password.
   * 2. Validate new password (min length, must differ from current).
   * 3. Hash + persist; clears `must_change_password`, bumps `password_changed_at`.
   * 4. Revoke ALL refresh tokens for the user — caller must re-login on next request.
   * 5. Emit `password_change` + `all_sessions_revoked` auth events (fire-and-forget).
   *
   * Returns void on success. The resolver maps that to `Boolean!` so callers
   * always get a definitive yes/no instead of a token blob.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    meta?: RequestMeta,
  ): Promise<void> {
    if (currentPassword === newPassword) {
      throw new BusinessException(
        ErrorCode.PASSWORD_UNCHANGED,
        'New password must differ from current password',
      );
    }
    if (newPassword.length < NEW_PASSWORD_MIN_LENGTH) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        `New password must be at least ${NEW_PASSWORD_MIN_LENGTH} characters`,
      );
    }

    // This endpoint is behind GqlAuthGuard — userId is taken from the signed
    // JWT, not from user input. A null findById result means the account was
    // deleted mid-session; it is not an enumeration surface.
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessException(
        ErrorCode.CURRENT_PASSWORD_INCORRECT,
        'Current password is incorrect',
      );
    }

    const valid = await verify(user.passwordHash, currentPassword);
    if (!valid) {
      throw new BusinessException(
        ErrorCode.CURRENT_PASSWORD_INCORRECT,
        'Current password is incorrect',
      );
    }

    const newHash = await hash(newPassword);
    await this.userRepo.updatePassword(userId, newHash);
    await this.refreshTokenRepo.revokeAllForUser(userId, 'password_change');

    this.authEventService
      .emit({
        userId,
        type: 'password_change',
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        deviceInfo: meta?.deviceInfo,
      })
      .catch(() => {});

    this.authEventService
      .emit({
        userId,
        type: 'all_sessions_revoked',
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        deviceInfo: meta?.deviceInfo,
        metadata: { reason: 'password_change' },
      })
      .catch(() => {});
  }

  // ── Private: refresh-token validation ──────────────────

  /**
   * Verify the JWT signature + `type: 'refresh'` claim. Throws
   * `SESSION_EXPIRED` on a malformed/tampered/wrong-secret token or a
   * non-refresh token type. Pulling this out of `refreshToken()` keeps that
   * method's cyclomatic complexity within the Biome budget.
   */
  private verifyRefreshTokenPayload(token: string): RefreshTokenPayload {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'Invalid token type');
    }

    return payload;
  }

  /**
   * Look the refresh token up by its embedded `tokenId`, diff against the
   * presented raw token's hash, and enforce every revocation / expiry /
   * password-fence invariant. Returns the validated row so the caller can
   * rotate it.
   *
   * Reuse detection is reason-aware: we cascade-revoke the whole family
   * only when the presented token was revoked via `rotation` (the
   * canonical "attacker replayed the rotated token" signal) or legacy
   * NULL. User-initiated / password-change / admin-revoked tokens raise a
   * plain "revoked" error and leave sibling sessions alive — preserving
   * the `revokeAllOtherSessions` keep-alive guarantee.
   *
   * Impersonation tokens are non-renewable (Auth PRD §10.3 invariant #7):
   * the code exchange path never creates a refresh-token row, so the
   * lookup returns null and we surface a generic "invalid" error.
   */
  private async loadAndValidateStoredRefreshToken(
    rawToken: string,
    payload: RefreshTokenPayload,
  ): Promise<RefreshTokenWithRelations> {
    const tokenHash = this.hashToken(rawToken);
    const storedToken = await this.refreshTokenRepo.findByIdWithRelations(payload.tokenId);

    if (!storedToken || storedToken.tokenHash !== tokenHash) {
      throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'Invalid refresh token');
    }

    if (storedToken.revokedAt) {
      const isRotationReuse =
        storedToken.revokedReason === null || storedToken.revokedReason === 'rotation';
      if (isRotationReuse) {
        await this.refreshTokenRepo.revokeAllForUser(storedToken.userId, 'rotation');
        throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'Refresh token reuse detected');
      }
      throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'Refresh token revoked');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'Refresh token expired');
    }

    const storedUser = storedToken.user;
    if (storedUser.passwordChangedAt && storedToken.createdAt < storedUser.passwordChangedAt) {
      await this.refreshTokenRepo.revoke(storedToken.id, 'password_change');
      throw new BusinessException(
        ErrorCode.PASSWORD_CHANGED,
        'Password changed — please re-authenticate',
      );
    }

    return storedToken;
  }

  /**
   * The membership a refresh token was issued for, re-read so a deactivated
   * membership, suspended reseller or deleted institute stops refreshing.
   */
  private async resolveRefreshMembership(
    scope: AuthScope,
    userId: string,
    membershipId: string,
  ): Promise<RefreshMembership> {
    if (scope === 'platform') {
      const membership = await this.platformMembershipRepo.findByUserId(userId);
      if (!membership || membership.id !== membershipId) {
        throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'No active platform membership');
      }
      return {
        scope: 'platform',
        membershipId: membership.id,
        roleId: membership.roleId,
        roleAbilities: membership.role.abilities as Record<string, unknown>[],
        membershipAbilities: membership.abilities as Record<string, unknown>[] | null,
      };
    }

    if (scope === 'reseller') {
      const memberships = await this.resellerMembershipRepo.findByUserId(userId);
      const m = memberships.find((candidate) => candidate.id === membershipId);
      if (!m) {
        throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'No active reseller membership');
      }
      if (!m.reseller.isActive || m.reseller.status !== ResellerStatus.ACTIVE) {
        throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'Reseller account suspended');
      }
      return {
        scope: 'reseller',
        resellerId: m.resellerId,
        membershipId: m.id,
        roleId: m.roleId,
        roleAbilities: m.role.abilities as Record<string, unknown>[],
        membershipAbilities: m.abilities as Record<string, unknown>[] | null,
      };
    }

    const m = await this.membershipRepo.findByIdAndUser(membershipId, userId);
    if (!m) {
      throw new BusinessException(ErrorCode.SESSION_EXPIRED, 'No active institute membership');
    }
    return {
      scope: 'institute',
      tenantId: m.tenantId,
      resellerId: m.institute.resellerId,
      membershipId: m.id,
      roleId: m.roleId,
      roleAbilities: m.role.abilities as Record<string, unknown>[],
      membershipAbilities: m.abilities as Record<string, unknown>[] | null,
    };
  }

  /**
   * Correct password, no usable account in this portal. Same error as a wrong
   * password so the response does not confirm the credentials.
   */
  private rejectWrongPortal(userId: string, scope: AuthScope, meta?: RequestMeta): never {
    this.authEventService
      .emit({
        userId,
        type: 'login_failed',
        scope,
        failureReason: 'wrong_portal',
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        deviceInfo: meta?.deviceInfo,
      })
      .catch(() => {});
    throw new BusinessException(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials');
  }

  // ── Private: credential verification ───────────────────

  private async verifyCredentials(
    username: string,
    password: string,
    meta?: RequestMeta,
  ): Promise<UserRecord> {
    const usernameLower = username.toLowerCase();

    if (await this.lockout.isLocked(usernameLower)) {
      throw new BusinessException(ErrorCode.ACCOUNT_LOCKED, ACCOUNT_LOCKED_MESSAGE);
    }

    const user = await this.userRepo.findByUsername(username);
    if (!user || user.status !== 'ACTIVE') {
      const result = await this.lockout.recordFailure(usernameLower, meta);
      this.authEventService
        .emit({
          type: 'login_failed',
          failureReason: 'invalid_credentials',
          ip: meta?.ip,
          userAgent: meta?.userAgent,
          deviceInfo: meta?.deviceInfo,
          metadata: { username_lower: usernameLower },
        })
        .catch(() => {});
      if (result.locked) {
        throw new BusinessException(ErrorCode.ACCOUNT_LOCKED, ACCOUNT_LOCKED_MESSAGE);
      }
      throw new BusinessException(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials');
    }

    const valid = await verify(user.passwordHash, password);
    if (!valid) {
      this.authEventService
        .emit({
          userId: user.id,
          type: 'login_failed',
          failureReason: 'invalid_credentials',
          ip: meta?.ip,
          userAgent: meta?.userAgent,
          deviceInfo: meta?.deviceInfo,
        })
        .catch(() => {});
      const result = await this.lockout.recordFailure(usernameLower, meta);
      if (result.locked) {
        throw new BusinessException(ErrorCode.ACCOUNT_LOCKED, ACCOUNT_LOCKED_MESSAGE);
      }
      throw new BusinessException(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials');
    }

    await this.lockout.clearOnSuccess(usernameLower);
    return user;
  }

  // ── Ability rules (CASL) ──────────────────────────────

  async getAbilityRules(
    userId: string,
    scope: AuthScope,
    tenantId: string | undefined,
    membershipId: string,
    roleId: string,
  ): Promise<AbilityRule[]> {
    const ability = await this.abilityFactory.createForUser({
      userId,
      scope,
      tenantId,
      membershipId,
      roleId,
    });
    return ability.rules as AbilityRule[];
  }

  async getPrimaryNavSlugs(roleId: string): Promise<string[]> {
    return this.abilityFactory.getPrimaryNavSlugs(roleId);
  }

  // ── Login notification (NATS) ────────────────────────

  emitLoginNotification(userId: string, tenantId: string | null, meta?: RequestMeta): void {
    const event: AuthSecurityEvent = {
      tenantId,
      userId,
      eventType: 'LOGIN',
      metadata: {
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      },
    };
    this.eventBus.emit(NOTIFICATION_SUBJECTS.AUTH_SECURITY, event);
  }

  // ── Private: unified token issuance ────────────────────

  private async issueTokens(opts: {
    user: Omit<UserRecord, 'passwordHash'>;
    scope: AuthScope;
    tenantId?: string;
    resellerId?: string;
    membershipId: string;
    roleId: string;
    roleAbilities: Record<string, unknown>[];
    membershipAbilities: Record<string, unknown>[] | null;
    meta?: RequestMeta;
  }): Promise<AuthPayload> {
    const tokenId = randomUUID();

    const accessPayload: AccessTokenPayload = {
      sub: opts.user.id,
      scope: opts.scope,
      ...(opts.tenantId && { tenantId: opts.tenantId }),
      ...(opts.resellerId && { resellerId: opts.resellerId }),
      membershipId: opts.membershipId,
      roleId: opts.roleId,
      type: 'access',
      mustChangePassword: opts.user.mustChangePassword ?? false,
    };

    const refreshPayload: RefreshTokenPayload = {
      sub: opts.user.id,
      tokenId,
      membershipId: opts.membershipId,
      type: 'refresh',
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
      expiresIn: ACCESS_TTL_SECONDS[opts.scope],
    });

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: REFRESH_TTL_SECONDS,
    });

    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

    await this.refreshTokenRepo.create({
      id: tokenId,
      tokenHash,
      userId: opts.user.id,
      tenantId: opts.tenantId ?? null,
      membershipId: opts.membershipId,
      membershipScope: opts.scope,
      expiresAt,
      ipAddress: opts.meta?.ip,
      userAgent: opts.meta?.userAgent,
      deviceInfo: opts.meta?.deviceInfo,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: opts.user.id,
        username: opts.user.username,
        email: opts.user.email,
        scope: opts.scope,
        tenantId: opts.tenantId,
        resellerId: opts.resellerId,
        membershipId: opts.membershipId,
        roleId: opts.roleId,
        abilityRules: this.mergeAbilities(opts.roleAbilities, opts.membershipAbilities),
      },
    };
  }

  private mergeAbilities(
    roleAbilities: Record<string, unknown>[] | unknown,
    membershipAbilities: Record<string, unknown>[] | null | unknown,
  ): AbilityRule[] {
    const role = Array.isArray(roleAbilities) ? roleAbilities : [];
    const member = Array.isArray(membershipAbilities) ? membershipAbilities : [];
    return [...role, ...member] as AbilityRule[];
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
