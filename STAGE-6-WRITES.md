# Stage 6 — Database writes and cutover

**Completed:** 7 August 2026
**Rollback copy:** `PPM Tool 28 - pre-6-backup`

The first time the browser has been allowed to write anything. Portfolios,
programmes and projects can now be read from and written to the database, with
permissions, MFA and conflict detection enforced server-side.

**Nothing has switched over yet.** Every collection still reads localStorage
until you run the cutover command. Applying this stage changed no behaviour.

---

## Why all three collections had to move together

`PPMAdmin.savePortfolios()` does not only save portfolios. It calls
`reconcileProgrammeMembership()`, which rewrites **programmes and projects too**,
maintaining denormalised back-references (`portfolio.programmeIds`,
`programme.portfolioId`, `project.portfolio`).

So a per-collection cutover was never possible: saving a portfolio would have
written the other two collections to localStorage while one of them lived in the
database. They are covered together, or the database goes inconsistent.

---

## What the database now enforces

### Grants

`INSERT` and `UPDATE` on portfolios, programmes and projects. **`DELETE` was
deliberately withheld** — the application archives and deactivates rather than
hard-deleting, so nothing needs it, and withholding it means no fault in the
write path can destroy a row. `people` stays read-only. `anon` still has nothing.

### Write policies

Every write is checked against the Stage 3F permission model:

| Action | Requires |
|---|---|
| create a project | `projects.create` |
| edit a project | `projects.edit` **and** access to that project |
| archive or reopen a project | `projects.archive` |
| create or edit a programme | `programmes.edit` (+ access on edit) |
| create or edit a portfolio | `portfolios.edit` (+ access on edit) |
| any write at all | AAL2 — MFA complete |

Update policies check both `USING` and `WITH CHECK`, so a user cannot edit a
project outside their scope *nor move one out of their scope*.

### Three triggers

**Optimistic locking.** The client sends back the version it read. If the row has
moved on, the write is refused with `40001` rather than overwriting somebody
else's work. Otherwise the version is bumped and `updated_at` set.

**Immutable business keys.** `project_code`, `programme_code` and
`portfolio_code` cannot be changed once created. They identify records in every
localStorage collection that has not migrated yet — plans, RAID items,
milestones, audit history — and rewriting one would orphan all of it.

**Archive permission.** A row policy cannot compare old and new values, so the
difference between "edit this project" and "archive this project" is enforced in
a trigger. A Project Manager can edit their project but cannot archive it.

### The original import is preserved

Saves now have to update `legacy_payload`, because the application edits fields
that were never normalised into columns — `workstream`, `lifecycleTemplateId`,
`archiveHistory`. If it stayed frozen, those edits would be silently discarded on
the next load.

So the untouched Stage 2B import was snapshotted into a new `import_payload`
column on all 14 rows first, and the browser cannot write to it. The original
evidence survives whatever the write path does later.

---

## How the application uses it without being rewritten

Two problems had to be solved without a rewrite.

**Reads are synchronous, in about thirty places**, several of them top-level
constants. Rather than converting them, the store underneath them is filled from
the database *before page scripts run*. Every existing synchronous read then
works unchanged and gets database data — including the reconciliation cascade,
which is the thing that made a per-collection cutover impossible.

**Writes happen in six places across four files.** Rather than editing each,
`Storage.setItem` is intercepted for the three migrated keys: the local store is
updated exactly as before, then whatever actually changed is pushed to the
database. One seam instead of six, and no write site can be missed — including
any added later.

Only records that genuinely changed are pushed, compared against what the
database held at load.

---

## Doing the cutover

```javascript
// Check first — this refuses to be quiet if things do not match
await PPMDatabase.compareAll()

// Switch all three over
await PPMDatabase.cutOverAll()

// Reload the page.
```

From then on the database is the source of truth: pages load from it, and edits
go back to it.

### If something goes wrong

```javascript
PPMDatabase.pendingWrites()   // anything that did NOT reach the database
PPMDatabase.revertToLocal()   // back to localStorage, then reload
```

`revertToLocal()` is the panic button. It is always safe.

### What you will see

A save that works is quiet apart from a console line. A save that does not
reports which record and why, in one of three kinds:

| Kind | Meaning |
|---|---|
| **conflict** | someone changed the row first — reload and reapply |
| **refused** | your role or scope does not allow it |
| **failed** | usually the network |

Anything that does not save is recorded in the pending log, so an edit is never
silently lost. **A failed write stays dirty and is retried on your next save** —
so a save that fails while offline will go through by itself once you are back
and save again.

Hydration will **not** overwrite a record with unsaved changes. If you reload
while something is pending, the page keeps your local version and says so.

---

## Verification

**Database, 40 of 40 tests** against local PostgreSQL with all nine roles, before
anything touched your project:

- a correct version is accepted and the version auto-increments
- a **stale version is refused** (`40001`) and the row is not clobbered
- `project_code`, `programme_code`, `portfolio_code` all refuse to change
- `DELETE` refused on all three tables, even for a System Administrator
- a Project Manager can edit their own project but **cannot archive it**
- a PM cannot edit — or even read — a project outside their scope
- a read-only auditor changes nothing and cannot insert
- a suspended account and an AAL1 session write nothing
- "untouched" claims verified with row-level security **off**, because the
  blocked user often cannot read the row to check
- applying the migration three times changes nothing

**Live on your database**, in a transaction that was rolled back: correct version
accepted and bumped 1→2, stale version refused `40001` with the name unclobbered,
code change refused `42501`, delete refused `42501`, all three projects intact.
Your data is exactly as it was — versions back to 1.

**Adapter, 35 of 35 tests**:

- with nothing cut over, no hydration happens and **no database call is made**
- after cutover, exactly one record is pushed — only the one that changed
- re-saving unchanged data pushes nothing
- `workstream` and `lifecycleTemplateId` survive in `legacy_payload`; adapter
  bookkeeping is stripped out
- empty strings become `null` for date columns
- conflict, refusal and offline are each classified correctly and recorded
- **hydration refuses to overwrite an unsaved edit**, and the edit survives
- an unreachable database does not wipe the store
- revert stops writes reaching the database

**All prior regressions still green:** 19 pages clean, Stage 4 45/45, Stage 5
25/25, backup 21/21, every JS file parses. No new security advisors.

---

---

## Post-cutover findings (7 August 2026)

The first real cutover surfaced three things. The data came through intact —
`legacy_payload` was verified byte-identical to the frozen `import_payload` on all
three projects — but two genuine bugs were fixed and one point needs recording.

### 1. The console showed large differences. That was expected, and the database was right.

localStorage held the **built-in demo seed**, not real data. Every local value
matched the hardcoded `initialProjects` in `index-page.js` exactly: PRJ-00003 as
`Completed` with five `Green` RAGs and no archive fields, PRJ-00002 all
`Not Assessed`, blank sponsors. `lifecycleAssignmentMigratedAt` was stamped that
same afternoon, when the seed was created and the lifecycle migration ran over it.

The database held the real imported backup — resolved sponsor names and resource
IDs, and PRJ-00003 genuinely archived with its archive history. The cutover
replaced demo data with real records, which is the migration working.

**Visible change:** PRJ-00003 now shows as Archived rather than Completed. That is
its true state from the backup.

### 2. `cutOver()` warned about differences and then proceeded anyway — fixed

It printed "the database version will replace what is on screen" and continued. A
warning that scrolls past after the overwrite has already happened is no
protection at all. Had localStorage held real edits, they would have been lost.

It now **refuses** and explains what to do:

```javascript
await PPMDatabase.cutOver("projects", { force: true })
```

`cutOverAll()` reports which collections it declined. Verified with 9 tests:
refuses on divergence, leaves the source on `local`, does not touch local data,
proceeds with `force`, and still cuts over cleanly when the data matches.

### 3. Every hydrated record was pushed straight back to the database — fixed

All three projects jumped to version 2 immediately after cutover, with content
identical to the import. Two causes, both now fixed:

- **Key order.** Records were compared with `JSON.stringify`, which preserves key
  insertion order. The reconciliation cascade rebuilds records routinely, so
  identical data compared as different. Comparison is now order-independent.
- **Undefined fields.** The mappers set fields like `archivedAt` to `undefined`
  when a project is not archived. `JSON.stringify` drops undefined keys, so a
  record held in memory and the same record read back from storage differed —
  every hydrated record looked modified the instant it was stored. The comparison
  now follows JSON's own semantics.

Harmless in a single browser, but version churn is exactly what causes false
conflicts once two people edit at once.

Verified: re-saving with keys reordered pushes nothing, while a genuine change is
still detected and pushed correctly.

---

## Still outstanding

- ~~Leaked password protection~~ — **closed, not actionable.** Supabase's
  documentation states it is available on the Pro Plan and above, so the toggle
  does not exist on this project. The advisor will keep reporting it; treat it as
  noise. MFA is required for every sign-in, read and write, which covers the same
  risk more strongly.
- **Resources / people writes.** People stays read-only. Editing a Resource still
  only writes localStorage and does not reach `public.people`.
- **The other modules.** Plans, RAID, milestones, financials, stage gates and the
  rest are still localStorage-only and have no tables yet.
- **Server-side audit** (Stage 8). Audit entries are still written locally.
- **Workflow RPCs** (Stage 7) — stage gate approval, baseline approval, financial
  approval and archive currently rely on UI checks plus the archive trigger.

## Suggested next step

Cut over in a quiet moment, use the tool normally, and check
`PPMDatabase.pendingWrites()` afterwards. If it stays empty, the foundation
collections are fully migrated and Stage 7 workflow functions are the next piece.
