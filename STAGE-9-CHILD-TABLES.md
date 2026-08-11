# Stage 9 — The 18 project-scoped tables

**Completed:** 7 August 2026
**Rollback copy:** `PPM Tool 28 - pre-8-backup`
**Migration:** `STAGE-9-CHILD-TABLES.sql` (already applied)

All 18 project-scoped collections now exist in the database with row-level
security, permission gating, optimistic locking and auditing. Your database went
from 5 tables to 23.

**No application file changed and no data was migrated yet.** The tables are
empty and nothing reads them. This stage built the destination; filling it and
cutting over comes next.

---

## Columns came from your data, not from the code

You asked for full per-module columns. I tried the code first and it was not good
enough: a broad scan produced 385 "fields" for project plans, and a precise scan
for record templates recovered only 12 of 18, some visibly conflated.

So the schema was generated from the real records in
`portfolio-manager-backup-2026-08-07-14-52.json`. **190 typed columns**, each
traceable to a field that actually exists in your data.

| | Collections |
|---|---|
| **Modelled from real records** (10) | plans (3 recs, 30 cols), milestones (1, 10), RAID (1, 53), decisions (1, 9), financials (1, 25), baselines (1, 9), baseline requests (1, 7), financial entries (4, 10), approval requests (3, 19), legacy audit (44, 18) |
| **Scaffold only** (8) | actions, benefits, documents, status reports, stage gates, RAG history, resource demand, resource scenarios |

The eight scaffolds were **empty or absent from the backup**. They get the
standard shape — project scoping, record key, `legacy_payload`, `version` — so
they are protected from day one, and will be normalised when they hold real data.
Nothing about their fields is guessed.

**Every column is nullable.** Eight of the ten modelled collections contained
exactly one record: enough to prove a field exists, not that it is ever required.

### Decisions made along the way

- **Diverged budget fields.** `proposedBudget` (121113) and `budget` (50000) had
  drifted apart. As you chose, `proposedBudget`/`approvedBudget` and the `*Cost`
  fields became columns; the older `budget`/`forecast`/`actual`/`commitments`/
  `variance` aliases stay in `legacy_payload` only. Nothing is lost.
- **`ppmPlanBaselines` has its own `version` field** (the baseline number), which
  collided with the optimistic-locking column. Renamed to `record_version` rather
  than dropped.
- **`createdAt`/`updatedAt`** map onto the standard columns; the originals remain
  in `legacy_payload`.
- **RAID is a union of four record types** — 57 fields on one row, 29 empty,
  discriminated by `type`. All modelled, most null for any given row. That is
  faithful to how the application stores them.
- **`legacy_audit_history` is read-only.** It is a historical import, not a live
  collection, and the browser cannot write to it.

---

## Security, applied uniformly

Written as a loop over the 18 tables rather than 18 near-identical blocks, so no
table can quietly end up with a different posture from its neighbours.

Each table: AAL2 required to read or write, reads gated on the module's view
permission **and** `private.can_access_project`, writes gated on the module's edit
permission and the same scope check, optimistic locking on `version`, immutable
`record_key`, rows cannot be moved between projects, **no DELETE**, and an audit
trigger.

The permission mapping follows your existing model — for example financial
approval requests need `financials.approve` to write, while financial entries
need only `financials.edit`.

Audit entries for child rows key on `PRJ-00001 / TSK-0003`, and the audit read
policy was rewritten to match on the project prefix so scoping still holds.

---

## Two real problems found on the way

### 1. A live data-loss bug in the scoping filter — fixed

`ppmFinancialEntries` and `ppmFinancialApprovalRequests` were listed as flat
arrays in `ppm-auth-utils.js`, but the backup proves they are stored as objects
keyed by project code. That mismatch was not cosmetic:

- **Reading** — `filterProjectArray` returns a non-array unchanged, so a scoped
  user was handed **every project's** financial entries and approval requests,
  unfiltered. A scope leak.
- **Writing** — `mergeProjectArray` coerces a non-array to `[]`, so the first
  save by a scoped user would have **replaced both collections with an empty
  array** and destroyed them.

Only users below Portfolio-wide scope were affected, which is why it had never
been seen. Fixed and proved with a scoped test user: 8/8 — reads now filter
correctly, and a save leaves the hidden project's data intact.

### 2. TRUNCATE was still granted on the original four tables — fixed

Supabase grants new `public` tables to `authenticated` by default. Stage 6
revoked DELETE, but **TRUNCATE is a separate privilege and is not subject to
row-level security** — it would have emptied a table outright, past every policy
protecting it.

A TRUNCATE attempt did fail, but only because `CASCADE` also needed rights on the
new child tables. That is incidental, not protection. `has_table_privilege`
confirmed the privilege was genuinely held.

TRUNCATE, TRIGGER and REFERENCES are now revoked on all five original tables, and
the schema default privileges were changed so future tables cannot inherit them.

This also explains a subtler point: the same default grant is why
`legacy_audit_history` came out INSERT-able despite the setup loop only granting
SELECT. Granting is additive; the fix was to revoke everything first, then grant
back precisely.

---

## Verification

**28 of 28 database tests** against local PostgreSQL across all nine roles:

- optimistic locking, immutable `record_key`, rows cannot move project
- DELETE refused on every child table, even for a System Administrator
- a scoped Project Manager sees only in-scope milestones and financial entries
- that PM can edit milestones but **cannot** write approval requests, because
  those need `financials.approve` and milestones need `milestones.edit`
- a read-only auditor cannot insert anything
- `legacy_audit_history` cannot be written by anyone
- AAL1 sees nothing and writes nothing
- every child change is audited, including owner-level inserts, and seeded rows
  are recorded with **no actor** rather than misattributed
- applying the migration three times changes nothing

**Live grant audit on your database — all PASS:**

| Check | Result |
|---|---|
| tables where `authenticated` holds TRUNCATE | 0 |
| tables where `authenticated` holds TRIGGER | 0 |
| tables where `authenticated` holds DELETE | 0 |
| tables `anon` can read | 0 |
| `legacy_audit_history` INSERT-able | false |
| writable tables still writable | 20 |
| tables with RLS enabled | 23 of 23 |

**App regressions all green:** 19 pages clean, scoping fix 8/8, adapter 45/45,
Stage 6 36/36, audit 20/20, backup 21/21.

**Security advisor:** clean apart from the Pro-plan-only leaked-password notice.

---

## Stage 6 is working in real use

Your database now contains **PRJ-00004 "testing"**, created at 18:39 today. That
came from you using the app: the write-through picked up the new project and
pushed it to the database on its own. The cutover is doing what it should.

---

## What is not done yet

- **The 18 tables are empty.** No data has been moved into them.
- **Nothing reads or writes them from the app.** The adapter only knows about
  projects, programmes, portfolios and people.
- **The adapter cannot yet handle these shapes.** Thirteen of the collections are
  objects keyed by project code and five are flat arrays; the adapter currently
  assumes flat arrays of whole collections. That needs building once, then it
  works for all 18.

## Next step

Three pieces, in order:

1. **Adapter support for project-scoped child collections** — one mapper that
   handles both storage shapes, since in SQL they are the same thing.
2. **Seed from your browser** — a one-time push of each collection's current
   localStorage contents into its table, then a parity check. This uses your live
   data and needs no import file.
3. **Cut over module by module**, smallest first, with `revertToLocal()` available
   throughout.
