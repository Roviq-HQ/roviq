# User Identity & Auth Redesign

**Date:** 2026-03-06
**Status:** Approved

## Problem

Login currently requires Organization ID alongside username/password. This is poor UX and doesn't support users belonging to multiple institutes (e.g., a parent who is also a teacher at another institute).

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Username uniqueness | Globally unique (Roviq ID) | Platform-wide identity, simplifies login |
| Email uniqueness | Globally unique | One account per person |
| Multi-org login flow | Org picker after login → tenant-scoped JWT | Preserves entire RLS/CASL pipeline unchanged |
| Phone numbers | Platform-level table on User | Phones are identity, not org-specific |
| Guardian model | `StudentGuardian` join table | Supports revocation, primary change, parent vs guardian |
| Impersonation | View-only by default + explicit write toggle | Safe for support, audited escalation for fixes |
| Future auth | Schema ready for OAuth2/OIDC/SAML via `AuthProvider` table | No implementation now, just the table |

## Data Model

### Platform-level tables (no RLS, queried via admin client)

#### User
The core identity. No `tenantId` — this is a platform entity.

```prisma
model User {
  id           String   @id @default(uuid())
  username     String   @unique
  email        String   @unique
  passwordHash String   @map("password_hash")
  avatarUrl    String?  @map("avatar_url")
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  phoneNumbers  PhoneNumber[]
  authProviders AuthProvider[]
  memberships   Membership[]
  refreshTokens RefreshToken[]

  @@map("users")
}
```

#### PhoneNumber
Multiple phones per user with primary/WhatsApp flags.

```prisma
model PhoneNumber {
  id          String  @id @default(uuid())
  userId      String  @map("user_id")
  countryCode String  @map("country_code")
  number      String
  label       String  @default("personal") // personal | work | home
  isPrimary   Boolean @default(false) @map("is_primary")
  isWhatsapp  Boolean @default(false) @map("is_whatsapp")
  isVerified  Boolean @default(false) @map("is_verified")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id])

  @@unique([countryCode, number])
  @@index([userId])
  @@map("phone_numbers")
}
```

#### AuthProvider
Future-ready for OAuth2, OIDC, SAML SSO, passkeys.

```prisma
model AuthProvider {
  id             String   @id @default(uuid())
  userId         String   @map("user_id")
  provider       String   // password | passkey | google | microsoft | saml
  providerUserId String?  @map("provider_user_id")
  providerData   Json?    @map("provider_data")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id])

  @@unique([provider, providerUserId])
  @@index([userId])
  @@map("auth_providers")
}
```

### Tenant-scoped tables (RLS enforced)

#### Membership
Links a User to an Organization with a role. One user can have many memberships.

```prisma
model Membership {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  tenantId  String   @map("tenant_id")
  roleId    String   @map("role_id")
  abilities Json?    @default("[]")
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user         User         @relation(fields: [userId], references: [id])
  organization Organization @relation(fields: [tenantId], references: [id])
  role         Role         @relation(fields: [roleId], references: [id])
  profiles     Profile[]
  refreshTokens RefreshToken[]

  @@unique([userId, tenantId])
  @@index([tenantId])
  @@index([tenantId, roleId])
  @@map("memberships")
}
```

#### Profile
Domain identity within an org. A membership can have multiple profiles (e.g., parent + teacher).

```prisma
model Profile {
  id           String   @id @default(uuid())
  membershipId String   @map("membership_id")
  tenantId     String   @map("tenant_id")
  type         String   // student | staff | parent | guardian
  metadata     Json?    @default("{}")
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  membership        Membership         @relation(fields: [membershipId], references: [id])
  studentGuardians  StudentGuardian[]  @relation("StudentProfile")
  guardianStudents  StudentGuardian[]  @relation("GuardianProfile")

  @@unique([membershipId, type])
  @@index([tenantId])
  @@map("profiles")
}
```

#### StudentGuardian
Links student profiles to guardian/parent profiles. Supports revocation and primary changes.

```prisma
model StudentGuardian {
  id                String   @id @default(uuid())
  studentProfileId  String   @map("student_profile_id")
  guardianProfileId String   @map("guardian_profile_id")
  tenantId          String   @map("tenant_id")
  relationship      String   // father | mother | guardian | legal_guardian
  isPrimary         Boolean  @default(false) @map("is_primary")
  isActive          Boolean  @default(true) @map("is_active")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  studentProfile  Profile @relation("StudentProfile", fields: [studentProfileId], references: [id])
  guardianProfile Profile @relation("GuardianProfile", fields: [guardianProfileId], references: [id])

  @@unique([studentProfileId, guardianProfileId])
  @@index([tenantId])
  @@map("student_guardians")
}
```

## Auth Flow

### Login
```
POST login(username, password)
  → validate credentials against User table (admin client)
  → fetch memberships with org info
  → if 1 membership: return tenant-scoped JWT directly
  → if N memberships: return platform token (5min TTL) + membership list
```

### Select Organization
```
POST selectOrganization(tenantId)
  → requires platform token OR valid refresh token
  → verify active membership exists for (userId, tenantId)
  → issue tenant-scoped JWT { sub, tenantId, roleId, type: 'access' }
  → issue tenant-scoped refresh token
```

### Switch Organization
Same as selectOrganization. Client swaps tokens, no re-login.

### JWT Structure
- **Platform token:** `{ sub: userId, type: 'platform' }` — 5min TTL, cannot access tenant data
- **Access token:** `{ sub: userId, tenantId, roleId, type: 'access' }` — 15min TTL (unchanged)
- **Impersonation token:** `{ sub: adminUserId, tenantId, type: 'access', impersonating: true, writeAccess: false }` — logged separately

## Impersonation

### Flow
1. SaaS admin calls `impersonate(tenantId)` from admin portal
2. Returns impersonation JWT with `impersonating: true, writeAccess: false`
3. All requests audit-logged with real admin ID
4. Frontend shows "Viewing as [Institute Name]" banner
5. To enable writes: `enableImpersonationWrites()` — requires confirmation, logs escalation
6. Destructive actions (delete users, change billing) blocked even with write access

### Guard behavior
- CASL guard checks `impersonating` flag
- `writeAccess: false` → block all mutations except `enableImpersonationWrites`
- `writeAccess: true` → allow mutations, still block destructive list
- Every action logged to audit table: `{ actorId, impersonatedTenantId, action, writeAccess, timestamp }`

## What does NOT change

- Tenant-scoped JWT structure for normal operations
- RLS pipeline, `AsyncLocalStorage`, Prisma client extension
- CASL ability resolution logic (reads from Membership.abilities + Role.abilities instead of User)
- NATS message propagation
- Refresh token rotation mechanism (still tenant-scoped)
- Organization, Role models (Membership replaces User's FK to these)

## Migration Strategy

1. Create new tables: `Membership`, `Profile`, `PhoneNumber`, `AuthProvider`, `StudentGuardian`
2. For each existing User row: create a Membership with the same `tenantId`, `roleId`, `abilities`
3. Alter User: drop `tenantId`, `roleId`, `abilities` columns; add `@@unique([username])`, `@@unique([email])`
4. Update RefreshToken FK from `userId` to also reference `membershipId` (or keep `userId` + `tenantId`)
5. Add RLS policies to new tenant-scoped tables
6. Verify User table is excluded from RLS (platform table, admin client only)

## Real-World Scenarios

| Scenario | How it works |
|----------|-------------|
| Parent is teacher at same institute | 1 User, 1 Membership, 2 Profiles (parent + staff) |
| Parent is teacher at different institute | 1 User, 2 Memberships (one per org), 1 Profile each |
| Student transfers institutes | Deactivate old Membership, create new one. User ID stays. |
| Teacher at multiple institutes | 1 User, N Memberships. Org picker on login. |
| Divorce — revoke parent access | Set `StudentGuardian.isActive = false`. Guardian's Membership stays (may have other children). |
| Change primary parent | Flip `isPrimary` between two StudentGuardian rows |
| Institute owner manages multiple | 1 User, N Memberships with owner role in each |
| SaaS admin investigates issue | Impersonate → view-only. Toggle writes if needed. All audit-logged. |
