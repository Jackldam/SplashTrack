# DPIA template — SplashTrack

**What this is.** A starting point for the Data Protection Impact Assessment
required by Article 35 GDPR. Every section below marked *Filled in by the
project* is a factual description of what the SplashTrack software does — only
the project can enumerate that accurately, and without it every controller
would have to reconstruct it by reading the source. Every section marked
*Filled in by you* is a judgement only the controller can make.

**What this is not.** Legal advice. The project is not your processor, does not
receive your data, and cannot assess your processing (F-27, F-126). Complete
this with your own advisor, or with your DPO where you have one.

**Why you probably need one.** Article 35(3) requires a DPIA for large-scale
processing of special-category data. This software processes health data
(medical remarks, Art. 9) concerning **children**, at a scale covering a whole
swim school, with a new system. The [EDPB criteria][edpb] are met on several
axes at once — special-category data, vulnerable data subjects, innovative use.
Meeting two of the nine criteria is normally treated as sufficient.

[edpb]: https://ec.europa.eu/newsroom/article29/items/611236

Version of the software this describes: `<fill in>` · Date: `<fill in>` ·
Author: `<fill in>` · Reviewed by: `<fill in>`

---

## 1. Description of the processing — *filled in by the project*

### 1.1 Nature and context

A single self-hosted instance serves exactly one organisation. There is no
shared control plane, no platform operator, and no cross-organisation data path
(D-056, D-064). You run it; you are the controller. The project supplies
software and receives nothing.

### 1.2 Data classes, purposes, lawful bases and retention

The authoritative table is `docs/design/01-domain-model.md` §5, which is
generated from the same retention policy the running software enforces. Copy it
into your DPIA rather than paraphrasing it, and note two things about it:

- The **lawful basis column states proposals, not determinations** (F-27,
  D-110). Entries reading *unresolved* are unresolved and must be settled by you
  before that default ships.
- Retention defaults are the shipped values. You may lower them freely; raising
  one above a bound is refused by the settings layer (D-150).

Summary of the classes that drive the assessment:

| Class | Special category? | Concerns children? | Default retention |
|---|---|---|---|
| Person identity | No | Yes | 24 months after the last relationship ends |
| Medical / pastoral notes | **Yes (Art. 9 health)** | Yes | 12 months, hard `DELETE`, never anonymised |
| Assessment remarks | No | Yes | 12 months, hard `DELETE` |
| Attendance events | No | Yes | 24 months, hard `DELETE` |
| Skill progress | No | Yes | 7 years |
| Exam results & awards | No | Yes | Up to 10 years, **only where a ground applies** |
| Charges and payments | No | Indirectly | 7 years, then pseudonymised |
| Consent records | No | Yes | As long as needed to demonstrate compliance |
| Audit events | No | Indirectly | See the reconciliation note in §5 of the domain model |

### 1.3 Data subjects

Children enrolled in lessons; their guardians; members; instructors; internal
assessors; external examiners; anyone submitting a public contact form.
Guardian authority is modelled with evidence, and **lapses automatically at the
age of digital consent** (16 in NL, configurable), after which the affected
consents surface in the re-consent queue (D-151).

### 1.4 Recipients

**By default, none.** The software transmits personal data to no third party.
Everything below is a deployment choice you make:

- Your hosting provider or anyone administering the instance for you — likely
  your **processor**; a processing agreement is your assessment to make.
- Your outbound email provider, if you configure one — receives whatever the
  notification and invitation emails contain.
- Your backup destination, if you configure one off-host.
- The advisories endpoint for the opt-out version check: discloses your server's
  IP address and User-Agent, and therefore that this organisation runs
  SplashTrack at this address. It sends no personal data and no identifiers, and
  fetches a complete file rather than querying per version. Disable with
  `update.check.enabled = false` (D-034, F-131).

There is no transfer outside the EEA that the software initiates.

### 1.5 Technical and organisational measures

The full account is `docs/design/02-security-privacy.md`. The measures that
belong in a DPIA:

- Deny-by-default authorization; every query filtered by a resolved reach that
  cannot be constructed outside `resolveReach` (D-147).
- Special-category and free-text data (medical, pastoral, assessment remarks,
  inquiry text) encrypted at column level under a versioned envelope with AAD
  binding table, column, row and key id (D-096, D-148); **audited on read**;
  excluded from exports by default; never logged.
- MFA mandatory for the high-risk permission set, bound to permissions rather
  than role names (D-130); it is an `invariant` setting and cannot be turned off
  from the UI (D-150).
- Tamper-evident audit chain, verified on demand, written through a database
  role with `INSERT`-only grant on the audit table (D-149).
- Backups encrypted with a two-level key envelope; key material is never inside
  an archive, and CI asserts it (D-113, D-114).
- Role assignment cannot amplify privilege: a granter may grant only what they
  hold, at or below their own scope, within their own validity window (D-139).
- Erasure is driven by a registry with a completeness test over every table
  referencing a person; exemptions are enumerated and justified, not implicit
  (D-014, D-154).
- Subject access exports **refuse rather than silently omit** when a class is
  unreadable by the requester (D-153).

### 1.6 Residual risks the design already names

These are stated so you assess them rather than discover them.

| Ref | Risk | Who carries it |
|---|---|---|
| F-07 | A backup archive is a complete copy of everything, including health data | You — storage location and access |
| F-17 | An unpatched self-hosted instance is the single biggest residual risk | You — patching |
| F-23 | A legitimate export is also the exfiltration path | You — who holds export permissions |
| F-24 | Lose the recovery token and the backups are unrecoverable by design | You — token custody |

---

## 2. Necessity and proportionality — *filled in by you*

- Why is each data class necessary for the purpose it is recorded against?
- Is there a less intrusive way to achieve the same purpose?
- How is data minimisation demonstrated in your configuration — which optional
  fields have you disabled, which retention defaults have you shortened?
- On what lawful basis does each *unresolved* entry rest in your organisation?
- How do you inform data subjects (see the privacy-notice skeleton alongside
  this file)?

## 3. Risk assessment — *filled in by you*

For each risk, state likelihood, severity and the measures you rely on:

- Unauthorised access to health data about a child.
- An instructor retaining access to a child they no longer teach.
- A guardian obtaining data about a child they no longer have authority over.
- Loss of the recovery token or of the instance.
- Disclosure through a backup stored off-host.
- A breach discovered late, or not at all.

## 4. Measures to address risk — *filled in by you*

Which of the measures in §1.5 you rely on, what you add organisationally
(vetting, training, device policy, who holds which role), and what residual risk
you accept.

## 5. Consultation and sign-off — *filled in by you*

DPO advice where applicable; whether prior consultation with the supervisory
authority (Art. 36) is required; who signs; review date.

---

## 6. Keeping this current

Re-run this assessment when the processing changes, not on a calendar. In
practice that means: a new data class, a change of lawful basis, a new recipient
(email provider, off-host backup destination, an identity provider), a change to
retention defaults, or a major version that changes any of the above. The
release notes flag changes to the retention table and to the permission
catalogue for exactly this reason.
