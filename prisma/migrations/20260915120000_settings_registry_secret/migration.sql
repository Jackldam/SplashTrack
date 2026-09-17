-- phase 3.2 (R-17/R-21): the settings registry's one sensitive-value table.
-- `OrganizationSettingSecret` holds every `sensitive: true` registry entry's
-- encrypted value (D-096, `settings-secret-v1`), one row per setting key. The
-- key is both the primary key and the AAD primary-key component, so a
-- ciphertext cannot be copied between settings and still authenticate.
--
-- ENCRYPTED-COLUMN-IMPACT: name-only. A brand-new table and a brand-new
-- encrypted column (`value`, registered under `organization_setting_secrets.
-- value` in `src/lib/crypto/encrypted-columns.ts`) — nothing renamed, nothing
-- re-keyed, no existing ciphertext to touch.

-- CreateTable
CREATE TABLE "OrganizationSettingSecret" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByPersonId" TEXT,

    CONSTRAINT "OrganizationSettingSecret_pkey" PRIMARY KEY ("id")
);
