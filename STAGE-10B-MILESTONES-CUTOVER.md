# Stage 10B — Milestones database cutover

**Build:** `2026.08.07.18`  
**Input build:** PPM Tool 30 / `2026.08.07.17`  
**Database migration required:** none — Stage 10A already supplied the required `deleted_at` column and Stage 9 already supplied RLS, write grants, optimistic locking and audit triggers.

## What this stage does

Milestones are the first of the 18 Stage 9 child collections to become database-authoritative.

The existing application has deliberately **not** been rewritten. It still reads and writes the familiar object-shaped `ppmProjectMilestones` store. Stage 10B sits underneath that interface:

```text
PostgreSQL project_milestones
        ↓ page load
PPMChildDatabase hydration
        ↓
ppmProjectMilestones compatibility store
        ↓
existing synchronous page code
        ↓ save
Storage.setItem write-through
        ↓
INSERT / UPDATE / soft-delete in PostgreSQL
```

The source setting is browser-local and stored in `ppmChildDatabaseSources`. It is excluded from backups.

Only **milestones** can be switched to database mode in this build. The generic implementation will be reused for later child modules, but Stage 10B deliberately refuses a cutover command for any of the other 17 collections.

---

## Safety behaviour

### Parity gate

`cutOver("milestones")` first runs the same local-vs-database comparison proven in Stage 10A. If anything differs, cutover is refused unless the caller explicitly uses `{ force: true }`.

Do not use `force` for the normal migration.

### Optimistic locking

The adapter keeps the database version that this browser actually loaded. Every update and soft delete sends that version back to the Stage 9 optimistic-lock trigger.

If another user changes the row first, PostgreSQL returns `40001`. The local change is not allowed to clobber the newer database row.

A per-module write queue means two quick saves from the same page are serialized: the second save uses the version produced by the first rather than creating a false self-conflict.

### Deletes are soft deletes

The browser still has **no SQL DELETE privilege**.

When a milestone disappears from `ppmProjectMilestones`, Stage 10B performs:

```text
UPDATE project_milestones
SET deleted_at = <server-bound write timestamp>, version = <loaded version>
```

Normal reads filter `deleted_at IS NULL`, so the row disappears from the application while remaining recoverable/auditable in PostgreSQL.

If the same milestone key is reintroduced during the same database session, Stage 10B restores the soft-deleted row by clearing `deleted_at` instead of trying to create a duplicate.

### Pending writes

Child writes share the existing `ppmDatabasePending` diagnostic store, so all failed database writes remain visible in one place.

Use:

```javascript
PPMChildDatabase.pendingWrites("milestones")
```

- **network/refusal failures** block hydration on the next load so the unsaved local copy is not overwritten;
- **conflicts** are resolved by reloading: the database version is hydrated and the stale local edit is discarded, after which the user can reapply it.

### Panic button

```javascript
PPMChildDatabase.revertToLocal("milestones")
```

This changes only the browser's source setting. It does not delete or rewrite database rows. Reload the page before making further edits after reverting.

---

## Application changes

### `ppm-child-database.js`

Added:

- per-child source control (`local` / `database`);
- `ready`/boot hydration for active child modules;
- database baseline tracking;
- queued row-level write-through;
- INSERT/UPDATE support using the Stage 9 schema;
- soft delete via `deleted_at`;
- optimistic-lock conflict handling;
- pending-write diagnostics;
- cutover/revert controls.

Public Stage 10B calls:

```javascript
PPMChildDatabase.sourceFor("milestones")
await PPMChildDatabase.cutOver("milestones")
PPMChildDatabase.revertToLocal("milestones")
await PPMChildDatabase.hydrateModule("milestones")
await PPMChildDatabase.flush("milestones")
PPMChildDatabase.pendingWrites("milestones")
```

### `milestones-page.js`

Initial project/milestone loading now waits for `PPMChildDatabase.ready` so a database-authoritative milestone store is hydrated before the page reads it.

No milestone CRUD logic was rewritten.

### `add-project-page.js`

The project editor's initial lifecycle-readiness calculation waits for child hydration because readiness checks whether the project has milestone rows.

### `ppm-data-safety.js`

`ppmChildDatabaseSources` is now a personal/machine-local key and is excluded from portfolio backups.

### HTML files

All 19 application pages were bumped to build `2026.08.07.18`, keeping the existing synchronous script order.

---

# Live cutover procedure

You already seeded milestones in Stage 10A and received `IDENTICAL`. After replacing the application files with this build:

## 1. Start from a clean browser load

```bat
py -m http.server 8000
```

Open the app, hard refresh with **Ctrl+F5**, sign in and complete MFA.

Check:

```javascript
await fetch("VERSION", { cache: "no-store" }).then(r => r.text())
```

Expected build:

```text
2026.08.07.18
```

Then:

```javascript
PPMChildDatabase.sourceFor("milestones")
```

Expected before cutover:

```text
local
```

## 2. Reconfirm parity

```javascript
await PPMChildDatabase.compare("milestones")
```

Do not continue unless:

```text
IDENTICAL
```

and `identical: true`.

## 3. Cut over

```javascript
await PPMChildDatabase.cutOver("milestones")
```

Expected:

```text
source: "database"
```

and a message saying milestones are now database-authoritative.

Then **reload the page**.

## 4. Confirm database hydration

```javascript
PPMChildDatabase.sourceFor("milestones")
```

Expected:

```text
database
```

Open the Milestones page for the project containing the seeded milestone. It should appear exactly as before.

Then:

```javascript
await PPMChildDatabase.compare("milestones")
```

Expected: `IDENTICAL`.

---

# Live write tests

Use a disposable/test milestone rather than deleting anything important.

## A. Edit

Edit a milestone through the normal page and choose **Save changes**.

Then wait for write-through:

```javascript
await PPMChildDatabase.flush("milestones")
```

Expected: one saved change, zero conflicts/refusals/failures.

Re-run:

```javascript
await PPMChildDatabase.compare("milestones")
```

Expected: `IDENTICAL`.

## B. Add

Create a new test milestone through the normal UI, save, then:

```javascript
await PPMChildDatabase.flush("milestones")
await PPMChildDatabase.compare("milestones")
```

Expected: `IDENTICAL`, with the new row present in PostgreSQL.

## C. Delete the disposable row

Delete that test milestone through the normal UI and save.

Then:

```javascript
await PPMChildDatabase.flush("milestones")
await PPMChildDatabase.compare("milestones")
```

Expected: `IDENTICAL`.

The row should be absent from normal child queries but still exist in PostgreSQL with a non-null `deleted_at` value.

To inspect it directly from the authenticated browser:

```javascript
await PPMSupabase
  .from("project_milestones")
  .select("project_code, record_key, version, deleted_at")
  .eq("record_key", "<THE TEST MILESTONE ID>")
```

Expected: one row with `deleted_at` populated.

## D. Pending-write check

```javascript
PPMChildDatabase.pendingWrites("milestones")
```

Expected:

```text
no unsaved child changes
```

---

# Audit verification

Milestone INSERTs, UPDATEs and soft deletes pass through the Stage 9 child audit trigger and are therefore written to `public.audit_log` by the database.

For the test record, use its server audit key:

```text
<project code> / <milestone id>
```

For example:

```javascript
await PPMDatabase.auditReport({ recordKey: "PRJ-00005 / <milestone id>" })
```

The soft delete is an audited **UPDATE** whose changed field is `deleted_at`; there is deliberately no hard SQL DELETE.

---

# Conflict behaviour

A true optimistic-lock conflict is intentionally not something to manufacture against important live data.

The adapter test harness verified that when the database version advances independently, a stale browser update:

- receives a conflict;
- does not overwrite the newer database value;
- enters the pending log;
- is resolved on reload by hydrating the current database version so the change can be reapplied deliberately.

---

# Verification performed before delivery

Stage 10B was tested with an isolated Supabase-compatible mock of the Stage 9 milestone table.

Passed cases:

1. initial Stage 10A parity remains identical;
2. cutover persists database mode;
3. hydration reconstructs the object-shaped legacy store;
4. first edit updates the database and increments version;
5. a second edit in the same page uses the new version — no false self-conflict;
6. milestone removal performs a soft delete and increments version;
7. no SQL DELETE operation is called;
8. reintroducing the same key restores the soft-deleted row;
9. an externally advanced version produces a conflict;
10. the stale local write does not clobber the external database value;
11. conflict is written to the pending log;
12. revert changes the source back to local without destructive database activity.

Static checks:

- every JavaScript file parses with Node;
- all 19 application HTML files reference build `2026.08.07.18`;
- all 19 still load `ppm-child-database.js`;
- `ppmChildDatabaseSources` is excluded from backups;
- no Stage 10B code calls SQL DELETE.

---

# What Stage 10B does not do

- The other 17 child collections remain local.
- No new database grants or policies are added.
- Milestone page business logic is not rewritten.
- Local `PPMChangeLog` remains in place alongside the server audit.
- Stage 7 transactional workflows are still separate work.

Once the live edit/add/delete checks above pass, milestones are the first completed child-module cutover and the same adapter pattern can be extended to the next small collection.
