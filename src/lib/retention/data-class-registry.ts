/**
 * Binds every Prisma model to the `DataClass` it belongs to (D-065, D-110).
 *
 * `CLAUDE.md` rule 5 requires retention to arrive with the table, not later.
 * The binding lives in TWO places that must never drift: a `/// @dataClass
 * <CLASS>` doc comment directly above `model <Name> {` in
 * `prisma/schema.prisma`, and an entry here. `tests/unit/data-class-registry-sync.test.ts`
 * checks both directions — the exact shape D-167 already uses for
 * `/// @encrypted <columnId>` and `ENCRYPTED_COLUMNS` (D-135's pattern, reused
 * a second time).
 *
 * Every model in this schema is bound, not only the ones that reference
 * `Person`. A join table with no personal data still has a retention story —
 * "configuration, kept indefinitely" is `ORGANIZATION_SETTINGS`, not an
 * unstated default — and stating it here is what makes "every personal-data
 * table carries its retention policy from the day it is created" checkable
 * rather than aspirational.
 *
 * `RETENTION_CATALOGUE` (`./catalogue.ts`) then binds each `DataClass` to its
 * actual policy. This file only answers "which class does this table belong
 * to"; `tests/unit/retention-catalogue.test.ts` checks that every `DataClass`
 * the enum defines has exactly one catalogue entry.
 */
import type { DataClass } from "@/generated/prisma/client";

export const DATA_CLASS_BY_MODEL: Readonly<Record<string, DataClass>> = {
  Organization: "ORGANIZATION_SETTINGS",
  Person: "PERSON_IDENTITY",
  UserAccount: "LOGIN_CREDENTIALS",
  Session: "LOGIN_CREDENTIALS",
  Account: "LOGIN_CREDENTIALS",
  Verification: "LOGIN_CREDENTIALS",
  RateLimitCounter: "RATE_LIMIT_COUNTERS",
  TwoFactor: "LOGIN_CREDENTIALS",
  Passkey: "LOGIN_CREDENTIALS",
  Membership: "MEMBERSHIP_PERIODS",
  Role: "ORGANIZATION_SETTINGS",
  OrganizationUnit: "ORGANIZATION_SETTINGS",
  AccessGroup: "ORGANIZATION_SETTINGS",
  AccessGroupPermission: "ORGANIZATION_SETTINGS",
  RoleAccessGroup: "ORGANIZATION_SETTINGS",
  Permission: "ORGANIZATION_SETTINGS",
  RolePermission: "ORGANIZATION_SETTINGS",
  RoleAssignment: "ROLE_ASSIGNMENTS",
  ApiCredential: "API_CREDENTIALS",
  CredentialRoleAssignment: "ROLE_ASSIGNMENTS",
  AuditEvent: "AUDIT_EVENTS",
  AuditCheckpoint: "AUDIT_EVENTS",
  RetentionPolicy: "ORGANIZATION_SETTINGS",
  InstallationBootstrap: "ORGANIZATION_SETTINGS",
  BreakGlassAlert: "ORGANIZATION_SETTINGS",
};
