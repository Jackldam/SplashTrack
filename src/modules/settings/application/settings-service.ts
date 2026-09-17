/**
 * The settings service (R-17): the one write path for the typed registry, and
 * the read path the admin UI and the diagnostics page both call.
 *
 * LIVE-APPLY (`13-…` §4). There is no separate cache to invalidate and no
 * restart to ask for: every registry entry here has `appliesLive: true` and
 * every read goes straight through `@/lib/settings`, which already reads
 * `Organization` fresh (the JSON document is not captured in a module-level
 * constant anywhere — D-038's own rule). `Organization.updatedAt`, bumped by
 * every write, doubles as the cheap version signal `13-…` §4 asks a dedicated
 * `settings_version` counter for; see `getFullOrganizationSettings`'s doc
 * comment in `@/lib/settings/settings.ts` for why a second counter table was
 * not added. No entry in this phase's kernel needs the `appliesLive: false`
 * "rebuild, don't restart" path (D-038/D-106) — none of the ~15 settings
 * construct a singleton at start-up the way an identity provider would.
 */

import { z } from "zod";

import type { Principal } from "@/lib/authorization";
import { requirePermission } from "@/lib/authorization";
import { open, seal } from "@/lib/crypto";
import { prisma, type DatabaseClient } from "@/lib/database";
import { ApiError } from "@/lib/errors";
import {
  getFullOrganizationSettings,
  writeOrganizationConfig,
  writeOrganizationName,
  type FullOrganizationSettings,
} from "@/lib/settings";
import { recordAuditEvent } from "@/modules/audit";

import {
  SETTINGS_REGISTRY,
  settingDefinition,
  type SettingDefinition,
} from "../domain/registry";
import { assertLockoutInvariantHolds } from "./lockout-invariant-service";

const SECRET_COLUMN_ID = "organization_setting_secrets.value";

/** One setting's effective value plus everything the UI/diagnostics need. */
export interface EffectiveSetting {
  readonly definition: SettingDefinition;
  /**
   * The current value. For a `sensitive` entry this is ALWAYS `null` — the
   * value itself never leaves this service; see {@link secretSet} instead.
   */
  readonly value: unknown;
  /** Whether a `sensitive` entry currently holds a value. Irrelevant otherwise. */
  readonly secretSet: boolean;
  /** Where the value came from — `13-…` §8's "where each value came from". */
  readonly source: "default" | "database";
}

function rawAtPath(raw: unknown, section: string, field: string): unknown {
  if (raw == null || typeof raw !== "object") return undefined;
  const sectionValue = (raw as Record<string, unknown>)[section];
  if (sectionValue == null || typeof sectionValue !== "object")
    return undefined;
  return (sectionValue as Record<string, unknown>)[field];
}

/**
 * Reads the RAW (uncoerced) stored document, so provenance can tell "an
 * administrator wrote this" apart from "the lenient reader filled the
 * default" — {@link getFullOrganizationSettings} always returns a fully-filled
 * document and cannot make that distinction on its own.
 */
async function readRawConfig(db: DatabaseClient): Promise<unknown> {
  const row = await db.organization.findUnique({
    where: { id: "organization" },
    select: { config: true },
  });
  return row?.config ?? null;
}

async function secretIsSet(db: DatabaseClient, key: string): Promise<boolean> {
  const row = await db.organizationSettingSecret.findUnique({
    where: { id: key },
    select: { id: true },
  });
  return row != null;
}

/**
 * Every registry entry's EFFECTIVE value, with provenance — the shape both the
 * settings admin page and the diagnostics page render. Requires
 * `organization.settings.manage` OR `diagnostics.read`, because both surfaces
 * that call this are themselves permission-gated screens; this function does
 * NOT gate itself; callers must.
 */
export async function getEffectiveSettings(): Promise<EffectiveSetting[]> {
  const [settings, raw] = await Promise.all([
    getFullOrganizationSettings(),
    readRawConfig(prisma),
  ]);

  const results: EffectiveSetting[] = [];
  for (const definition of SETTINGS_REGISTRY) {
    results.push(await effectiveValueFor(definition, settings, raw));
  }
  return results;
}

async function effectiveValueFor(
  definition: SettingDefinition,
  settings: FullOrganizationSettings,
  raw: unknown,
): Promise<EffectiveSetting> {
  switch (definition.storage.kind) {
    case "config": {
      const { section, field } = definition.storage;
      const value = (
        settings.config as unknown as Record<string, Record<string, unknown>>
      )[section]?.[field];
      const rawValue = rawAtPath(raw, section, field);
      return {
        definition,
        value,
        secretSet: false,
        source: rawValue === undefined ? "default" : "database",
      };
    }
    case "organizationName":
      return {
        definition,
        value: settings.name,
        secretSet: false,
        source: settings.name === definition.default ? "default" : "database",
      };
    case "secret": {
      const set = await secretIsSet(prisma, definition.key);
      return {
        definition,
        value: null,
        secretSet: set,
        source: set ? "database" : "default",
      };
    }
    case "none":
      return {
        definition,
        value: definition.default,
        secretSet: false,
        source: "default",
      };
  }
}

export interface UpdateSettingInput {
  readonly principal: Principal;
  readonly key: string;
  readonly value: unknown;
  readonly requestId?: string | null;
}

/**
 * Updates ONE registry setting. The single write path every admin surface
 * (and, later, an import/export path — `13-…` §7's "configuration can be
 * exported and imported without secrets") must go through.
 *
 * ORDER, and why it is this order:
 *   1. Resolve the registry entry — an unknown key is refused before anything
 *      else runs.
 *   2. `requirePermission` — D-147's guard, never skipped.
 *   3. `class: "invariant"` — refused outright, audited at high severity
 *      (`13-…` §3.2: "any attempt to change an invariant is a high-severity
 *      audit event").
 *   4. The Zod schema — the registry's OWN validation, not a second copy.
 *   5. D-141's lockout invariant, for `Authentication`/`Security` writes only
 *      — checked against the DATABASE, not against the value just validated
 *      (D-141's own words), so it runs whether or not the value looks
 *      dangerous.
 *   6. The write itself, then an audit event recording the field NAME only
 *      (`@/modules/audit`'s own rule — never a value, secret or not).
 */
export async function updateSetting(
  input: UpdateSettingInput,
): Promise<EffectiveSetting> {
  const definition = settingDefinition(input.key);
  if (!definition) {
    throw new ApiError("NOT_FOUND", `Unknown setting "${input.key}".`);
  }

  await requirePermission(input.principal, definition.permission, {
    organization: true,
  });

  if (definition.class === "invariant") {
    await recordAuditEvent({
      eventType: "settings.invariant_write_refused",
      outcome: "DENIED",
      actorPersonId: input.principal.personId,
      targetType: "Setting",
      targetId: definition.key,
      requestId: input.requestId,
      reason: "setting is invariant and cannot be changed",
    });
    throw new ApiError(
      "FORBIDDEN",
      `"${definition.key}" is not editable — it is enforced in code, not a setting.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = definition.schema.parse(input.value);
  } catch (error) {
    const detail =
      error instanceof z.ZodError
        ? error.issues.map((issue) => ({
            field: definition.key,
            issue: issue.message,
          }))
        : [{ field: definition.key, issue: "Invalid value." }];
    throw new ApiError("VALIDATION_ERROR", "The submitted value is invalid.", {
      details: detail,
    });
  }

  if (
    definition.category === "Authentication" ||
    definition.category === "Security"
  ) {
    try {
      await assertLockoutInvariantHolds(prisma);
    } catch (error) {
      await recordAuditEvent({
        eventType: "settings.lockout_invariant_refused",
        outcome: "DENIED",
        actorPersonId: input.principal.personId,
        targetType: "Setting",
        targetId: definition.key,
        requestId: input.requestId,
        reason:
          "would risk leaving no local ORGANIZATION-scoped account with a " +
          "verified MFA factor (D-141)",
      });
      throw error;
    }
  }

  await applyWrite(definition, parsed, input.principal.personId);

  await recordAuditEvent({
    eventType: "settings.updated",
    outcome: "SUCCESS",
    actorPersonId: input.principal.personId,
    targetType: "Setting",
    targetId: definition.key,
    requestId: input.requestId,
    // Field NAME only — never a value, per `@/modules/audit`'s own rule,
    // which is stricter than (and supersedes) the literal "old → new" phrase
    // in `13-…` §7: this codebase treats even a non-secret setting's value as
    // something the append-only trail must not carry.
    changedFields: { [definition.key]: "changed" },
  });

  const settings = await getFullOrganizationSettings();
  const raw = await readRawConfig(prisma);
  return effectiveValueFor(definition, settings, raw);
}

async function applyWrite(
  definition: SettingDefinition,
  value: unknown,
  updatedByPersonId: string | null,
): Promise<void> {
  switch (definition.storage.kind) {
    case "config": {
      const { section, field } = definition.storage;
      await writeOrganizationConfig(
        { [section]: { [field]: value } },
        updatedByPersonId,
      );
      return;
    }
    case "organizationName":
      await writeOrganizationName(value as string, updatedByPersonId);
      return;
    case "secret": {
      if (value == null) {
        await prisma.organizationSettingSecret.deleteMany({
          where: { id: definition.key },
        });
        return;
      }
      const sealed = seal(SECRET_COLUMN_ID, definition.key, value as string);
      await prisma.organizationSettingSecret.upsert({
        where: { id: definition.key },
        create: {
          id: definition.key,
          value: sealed,
          updatedByPersonId,
        },
        update: { value: sealed, updatedByPersonId },
      });
      return;
    }
    case "none":
      // Unreachable — `class: "invariant"` entries are refused before this
      // function is called.
      throw new ApiError(
        "FORBIDDEN",
        `"${definition.key}" has no storage and cannot be written.`,
      );
  }
}

/**
 * Reads back a `sensitive` setting's PLAINTEXT — used nowhere but by whatever
 * eventually sends the SMTP test/mail (not built this phase). NEVER exposed
 * through the admin API or any route; importing this outside a server-only
 * mail sender is the mistake `@/lib/crypto`'s own header warns about.
 */
export async function readSecretPlaintext(key: string): Promise<string | null> {
  const row = await prisma.organizationSettingSecret.findUnique({
    where: { id: key },
    select: { value: true },
  });
  if (!row) return null;
  return open(SECRET_COLUMN_ID, key, row.value);
}
