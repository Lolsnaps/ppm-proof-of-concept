# Stage 8 — Server-side, append-only audit

**Completed:** 7 August 2026
**Rollback copy:** `PPM Tool 28 - pre-8-backup`
**Migration:** `STAGE-8-AUDIT-MIGRATION.sql` (already applied)

Your audit trail lived in localStorage. It recorded what happened but could not
**prove** it — anyone with developer tools could rewrite it. This adds a second
trail written by the database itself, attributed to the authenticated user, that
nothing can forge, edit or delete through the API.

Applying this changed no application behaviour. It only started recording.

---

## Why Stage 7 was skipped

The handoff's Stage 7 moves six workflows to Postgres functions. Your database has
four tables, and five of those six need tables that do not exist yet:

| Workflow | Needs | Status |
|---|---|---|
| Archive / reopen | `projects` | possible — but already enforced by the Stage 6 trigger |
| Stage gate approval | `ppmStageGates` | no table |
| Baseline approval | `ppmPlanBaselines` | no table |
| Financial approval | `ppmFinancialApprovalRequests` | no table |
| Lifecycle transitions | lifecycle templates | no table |
| Scenario publication | `ppmResourceScenarios` | no table |

Stage 7 is blocked until more modules migrate. Stage 8 was not, so it went first.

---

## What is now recorded

Every `INSERT`, `UPDATE` and `DELETE` on portfolios, programmes and projects,
into `public.audit_log`, with:

- **who** — taken from `auth.uid()`, never from the page's claim, plus the
  person's name, email and role copied at write time so the entry stays readable
- **what** — table, business key, row id, operation, row version
- **which fields changed** — a before/after list, and only fields that actually
  changed
- **when** — server time, not browser time

### Design decisions worth knowing

**The browser has no INSERT grant on the audit table at all.** Entries are
written by a `SECURITY DEFINER` trigger running as the table owner, so an entry
cannot be fabricated from the client — there is no path to write one.

**Append-only is enforced, not assumed.** Triggers refuse `UPDATE` and `DELETE`
outright, so even a mistaken future grant could not rewrite history.

**Refused writes leave no trace.** The audit triggers are `AFTER`, so a write
blocked by a policy or by the version check is never logged as if it had
happened.

**A write that changes nothing is not recorded.** Otherwise the trail fills with
noise from re-saves.

**Auditing can never block a legitimate change.** If the audit write itself
failed, the failure is raised as a warning and the user's change still goes
through. An audit trail is not worth losing someone's work over.

**`legacy_payload` and `import_payload` are skipped.** `legacy_payload`
duplicates the normalised columns and would make every entry unreadable.

### Who can read it

| | Sees |
|---|---|
| holds `audit.view` | the entire trail |
| everyone else | only entries for records they could already read |
| AAL1 (no MFA) | nothing |
| `anon` | nothing |

So the audit log can never become a way around project scoping.

---

## Using it

```javascript
// Everything, newest first
await PPMDatabase.auditReport()

// One record's history
await PPMDatabase.auditReport({ recordKey: "PRJ-00001" })

// Raw entries, in the shape the Audit History page understands
await PPMDatabase.getAuditTrail({ limit: 100 })
```

Entries are mapped into the same shape as your existing local audit records, so
the two trails can be shown side by side. Anything from the database carries
`verified: true` and `sourcePage: "Database"` — that is the half that cannot be
forged.

---

## Verification

**28 of 28 database tests** against local PostgreSQL across all nine roles,
before anything touched your project:

- an edit writes exactly one entry, naming the changed field with before and after
- only the changed field is listed, not the whole row
- a no-op update writes **no** entry
- an insert is recorded as `INSERT`
- a write refused by the version check leaves **no** entry
- `INSERT`, `UPDATE` and `DELETE` on the audit table are all refused (`42501`)
- history is intact after every tamper attempt
- a Project Manager's edit is attributed to the **Project Manager**, not to
  whoever edited last
- a PM without `audit.view` still sees history for their own project, and none
  for projects outside their scope
- an auditor with `audit.view` sees the whole trail
- AAL1 sees nothing

**Live on your database**, in a rolled-back transaction: the entry was written as
"Alex Kain / System Administrator", recording `current_position` changing from
"Requirements workshops are underway." to "audit live test". Update, delete and
forge attempts all refused `42501`. Your data is untouched.

**Adapter: 20 of 20 tests** — id prefixing so database entries cannot clash with
local ones, timestamp normalisation, field mapping, `verified` flag, filters, and
a refused read returning empty rather than throwing.

**All prior regressions green:** 19 pages clean, Stage 6 36/36, cutover guard
9/9, key-order 4/4, adapter 45/45, shadow 25/25, backup 21/21.

### One advisor regression, caught and fixed

The security advisor flagged a function I had just created —
`private.audit_log_is_immutable` — as having a mutable `search_path`. Every other
function across Stages 3F to 8 pins it to empty; this one slipped.

Fixed, and re-verified: all nine functions now report `search_path=""`, auditing
still records, and immutability is still enforced. The advisor is clean apart
from the Pro-plan-only item below.

---

## Still outstanding

- ~~Leaked password protection~~ — **not actionable.** Supabase's documentation
  states it is Pro Plan and above, so the toggle does not exist on this project.
  The advisor will keep reporting it. MFA is required for every sign-in, read and
  write, which covers the same risk more strongly.
- **Local audit is still the only trail for unmigrated modules.** Plans, RAID,
  milestones, stage gates, financials and the rest still write to
  `ppmAuditHistory` in localStorage, which remains forgeable. They gain a
  verified trail only when their tables exist.
- **People changes are not audited**, because `people` is still read-only from
  the browser — there is nothing to record.
- **Stage 7 workflows** remain blocked on tables.

## Next step

Milestones, as agreed: create the table, import, RLS, adapter mapping and
cutover. It is the same pattern Stages 2 through 6 established, it will pick up
audit coverage automatically once its trigger is added, and it is the smallest
safe test of that pattern on a project-scoped module.
