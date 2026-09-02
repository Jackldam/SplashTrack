# rev7 — Independent consistency review

**Reviewer:** consistency agent, round 7 (independent verification of the fixes
made after rounds 1–6).
**Scope:** `docs/design/00..10`, `13`, `14`, `15`. Chapters 11 and 12 are
history and are excluded except where an active chapter depends on them.
**Base:** branch `design/architecture-phase`, HEAD `29a0021`.
**Lens:** internal consistency only — contradictions, duplicated normative
statements (D-134), dangling or wrong identifiers, decisions cited as live after
withdrawal. Security, domain realism and buildability are other agents' lenses.

Findings are appended in the order they were found, not in severity order. The
summary at the end ranks them.

---

## Findings

### C-1 — D-150 and D-158 state different hard ceilings for the absolute session lifetime

**Severity: high.**

Side A — `02-security-privacy.md` §4.1, the D-150 classification table, `bounded` row:

> | `bounded` | Editable within a hard floor/ceiling enforced by the setting's own schema, which `settings:reset` also respects | session idle ≤ 8 h **and absolute ≤ 12 h**; rate limits ≥ a stated minimum; audit retention ≥ 12 months (§3.2); … |

Side B — `09-decision-register.md`, D-158 (added today, 29a0021):

> Session idle and absolute timeouts are role-scoped `bounded` settings,
> administrator-editable at runtime with no restart. Defaults: idle 30 min
> (instructor), 15 min (administrator), **absolute 12 h; ceilings 8 h idle,
> 24 h absolute**

and `08-open-decisions.md` OD-6, the closure table:

> | Absolute session lifetime | 12 h | `bounded` | **≤ 24 h** |

**Why it matters.** Both statements are normative and both describe the same
field in the same settings schema. Under D-150 the absolute lifetime's ceiling
*equals its default* (12 h), which makes it a `bounded` setting that cannot
actually be raised — functionally an invariant. Under D-158/OD-6 an
administrator may raise it to 24 h. An implementer writing the settings registry
schema encodes one number and it is a security bound, so the wrong choice is
either a control that is weaker than the security chapter intends or a setting
the operator cannot use for the reason it was made editable. D-158's own "Where"
column points at `02-security-privacy.md` §4.1 (D-150) as the place this lands —
so it points at the text that disagrees with it. This is precisely the D-037
shape (one rule stated normatively in two places, the copies disagreeing) that
the previous round found and that the repair pass did not eliminate.

**Recommended resolution.** Pick the ceiling once. If 24 h is intended, edit the
D-150 table's `bounded` example to read "session idle ≤ 8 h, absolute ≤ 24 h" —
or better, replace the concrete numbers in D-150's table with a pointer
("session timeouts — see D-158") so the ceiling is stated once, in D-158, and
D-150 keeps only the classification. If 12 h is intended, correct D-158 and
OD-6's table together.

---

### C-2 — `02-security-privacy.md` §1.2 still presents the timeout values as an unresolved proposal and cites OD-6 as open

**Severity: high.**

Side A — `02-security-privacy.md` §1.2 (Authentication), unchanged by 29a0021:

> - Defined **idle and absolute** session timeouts. For SplashTrack the idle
>   timeout matters unusually much: tablets are shared at the poolside and left
>   unlocked. **Proposal: idle 30 min for instructor roles, 15 min for admin
>   roles, absolute 12 h. See open decision OD-6.**

Side B — `08-open-decisions.md` OD-6 heading and answer:

> ### OD-6 — **(CLOSED 2026-09-02)** Session timeout values.
> **Answer, from Jack: the proposed defaults are accepted, and they must be an
> administrator-changeable setting rather than a constant.**

**Why it matters.** Two defects in one paragraph, both today's.
(a) *Stale reference*: OD-6 is closed; chapter 02 is the chapter an implementer
of authentication reads, and it tells them the numbers are a proposal awaiting a
decision that has in fact been made.
(b) *Substantive*: the review brief for this round asks specifically whether
anything still "treats session timeouts as constants". This paragraph does. It
lists three fixed values with no mention that they are defaults of
administrator-editable, role-scoped `bounded` settings (D-158). Chapter 02
§1.3 has the same gap in smaller form — "A **short idle timeout** for instructor
sessions (OD-6), applied by role" — again citing OD-6 as if live.
Additionally this paragraph is a third normative copy of the same three numbers
(alongside OD-6's table and D-158), which D-134 forbids.

**Recommended resolution.** Replace §1.2's proposal bullet with a pointer:
timeouts are role-scoped `bounded` settings, values and bounds stated once in
D-158. Change §1.3's "(OD-6)" to "(D-158)". Do not restate the numbers in
chapter 02.

---
