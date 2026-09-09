import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { revealRelationshipEvidence } from "@/modules/people";

import { guarded, requireSignedIn } from "../../../../access";

/**
 * Disclosing one relationship's authority evidence — a page of its own, because
 * it is an act of its own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A COLUMN ON THE PERSON PAGE
 *
 * `PersonRelationship.evidence` is the first production column written through
 * the D-096/D-167 envelope. It is free text about a family's legal arrangements,
 * and D-063's own worked example for why it exists is a custody dispute. Three
 * consequences, all of which need a separate surface:
 *
 *   1. **It is decrypted only when somebody asks for it.** The person page
 *      selects a boolean — does evidence exist — and never the ciphertext, so an
 *      ordinary look at a child's record does not put a plaintext in a render
 *      tree, a React payload, or a server log line.
 *   2. **Every disclosure is audited, before it happens.** The service writes
 *      `people.relationship.evidence_revealed` with the THROWING variant and
 *      awaits it; a disclosure whose record could not be written does not
 *      occur. That is stricter than the design demands for this column — D-148's
 *      read-auditing covers the protected free-text class and this is not in it
 *      — and it is here because "who looked at that" is a question somebody
 *      eventually asks about exactly this field.
 *   3. **It is guarded on the SUBJECT**, not on the relative: `people.read` over
 *      the child whose family the text describes.
 *
 * Navigating here IS the disclosure. There is no "reveal" button that would let
 * the audit event and the plaintext come apart.
 */
export default async function EvidencePage({
  params,
}: {
  params: Promise<{ personId: string; relationshipId: string }>;
}) {
  const [t, { personId, relationshipId }, session] = await Promise.all([
    getTranslations(),
    params,
    requireSignedIn(),
  ]);

  const result = await guarded(() =>
    revealRelationshipEvidence(
      { principal: { personId: session.person.id } },
      relationshipId,
    ),
  );

  if (!result.ok) {
    return (
      <main className="container py-5">
        <h1>{t("people.evidence.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("people.denied.title")}</h2>
          <p className="mb-0">
            {t("people.denied.explanation", { permission: result.permission })}
          </p>
        </div>
        <Link href={`/people/${personId}`}>{t("people.backToPerson")}</Link>
      </main>
    );
  }

  if (!result.value) notFound();

  return (
    <main className="container py-5">
      <nav className="mb-3">
        <Link href={`/people/${personId}`}>{t("people.backToPerson")}</Link>
      </nav>

      <h1>{t("people.evidence.title")}</h1>

      {/* Non-dismissable, at the point of disclosure. It says the read was
          recorded, because a control nobody knows about changes no behaviour. */}
      <div className="alert alert-info" role="note">
        {t("people.evidence.auditNotice")}
      </div>

      {result.value.evidence ? (
        <blockquote className="border-start border-3 ps-3">
          <p className="mb-0" style={{ whiteSpace: "pre-wrap" }}>
            {result.value.evidence}
          </p>
        </blockquote>
      ) : (
        <p className="text-muted">{t("people.evidence.none")}</p>
      )}

      <p className="text-muted mt-4">{t("people.evidence.claimNotice")}</p>
    </main>
  );
}
