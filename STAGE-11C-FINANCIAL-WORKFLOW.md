# Portfolio Manager — Stage 11C
## Transactional Financial Workflow

Build: **2026.08.07.22**

Stage 11C migrates the remaining financial child collections together:

- `ppmProjectFinancials` → `public.project_financials`
- `ppmFinancialEntries` → `public.financial_entries`
- `ppmFinancialApprovalRequests` → `public.financial_approval_requests`

The three collections are deliberately cut over as one unit. A budget approval is
not just an approval-row edit: it also changes the project financial summary and
must refer to a stable cost-plan snapshot. The adapter now refuses individual
source changes/cutovers for coupled Stage 11 workflows, so the three financial
collections cannot accidentally be left half-local and half-database.

## What changes

Normal cost-plan editing remains compatible with the existing page. The page still
reads and writes the legacy localStorage-shaped collections synchronously, while
`ppm-child-database.js` hydrates those stores from PostgreSQL and writes row changes
back through the established Stage 10/11 adapter.

Budget workflow operations use one PostgreSQL transaction:

```text
Request approval
  → validate AAL2 / linked resource / project scope / financials.edit
  → lock project + financial summary + active cost lines
  → verify browser optimistic versions
  → verify selected approver is active, sign-in linked, has financials.approve + financials.viewDetail, and can access the project
  → create immutable Pending Approval snapshot
  → mark financial summary Pending Approval
  → COMMIT

Approve / reject
  → validate AAL2 / scope / financials.approve
  → lock project + financial summary + cost lines + request
  → verify assigned approver + segregation of duties
  → verify request and summary optimistic versions
  → on approval, verify budget lines still match the submitted snapshot
  → decide request
  → apply approved budget/version or retain the current approved budget
  → recalculate financial summary totals
  → COMMIT
```

Any error rolls back the whole workflow operation.

## Additional database controls

Stage 11C installs:

- a guard preventing direct browser INSERT/UPDATE of financial approval requests;
- a guard preventing ordinary browser writes from changing approved-budget fields;
- a unique active financial-summary invariant per project;
- a unique Pending Approval invariant per project;
- removal of browser INSERT/UPDATE/DELETE privileges from
  `financial_approval_requests` after the historical rows are seeded;
- `public.ppm_stage11c_ready()`;
- `public.ppm_commit_financial_workflow(...)`.

The approval RPC derives requester / decision-maker identity from `auth.uid()`.
The browser cannot spoof either actor. For a new request the browser may select the target approver, but the server independently verifies that person is active, linked to a sign-in account, allowed to view and approve detailed financials, in project scope, and different from the requester.

## Important first-run order

**Do not install the Stage 11C SQL before seeding.**

The migration intentionally makes the approval table browser read-only, so existing
historical rows must be in PostgreSQL first.

### 1. Keep the current working folder

Keep your post-Stage-11B folder unchanged as the rollback copy.

Extract the Stage 11C full ZIP to a new folder and serve that folder with:

```bat
py -m http.server 8000
```

Sign in normally and verify:

```javascript
await fetch("VERSION", { cache: "no-store" }).then(r => r.text())
```

Expected build:

```text
2026.08.07.22
```

### 2. Inspect Stage 11C local data

```javascript
PPMChildDatabase.preview("financials")
PPMChildDatabase.preview("financialEntries")
PPMChildDatabase.preview("financialApprovals")
```

All three should report `valid: true`.

### 3. Seed the current browser data

```javascript
await PPMChildDatabase.seedStage11C()
```

This does **not** cut anything over.

Then compare:

```javascript
await PPMChildDatabase.compareStage11C()
```

Do not continue unless all three modules are `IDENTICAL` and the combined result
reports `identical: true`.

### 4. Install the database workflow

Run the complete file in a fresh Supabase SQL Editor query:

`STAGE-11C-FINANCIAL-WORKFLOW-MIGRATION.sql`

The script is wrapped in `BEGIN` / `COMMIT`. If Supabase reports an error, stop and
resolve that error before proceeding.

### 5. Run the read-only verification

Run:

`STAGE-11C-VERIFY.sql`

Every PASS/FAIL row should report **PASS**.

### 6. Confirm the browser can see the server workflow

```javascript
await PPMChildDatabase.stage11CServerReady()
```

Expected:

```javascript
{ ready: true, reason: "" }
```

### 7. Cut over all three financial collections together

```javascript
await PPMChildDatabase.cutOverStage11C()
```

The command refuses to continue if parity is not exact, pending writes exist, or
the Stage 11C server migration is not ready.

Reload the page after a successful cutover.

Then verify:

```javascript
PPMChildDatabase.stage11CReady()
PPMChildDatabase.sourceFor("financials")
PPMChildDatabase.sourceFor("financialEntries")
PPMChildDatabase.sourceFor("financialApprovals")
```

Expected:

```text
true
database
database
database
```

## Live functional test

Use a disposable/test project where practical.

### Cost-plan CRUD

1. Open Financial Management.
2. Add a financial line and save.
3. Edit its forecast/actual/notes and save.
4. Delete the disposable line and save.
5. Run:

```javascript
await PPMChildDatabase.flushStage11C()
await PPMChildDatabase.compareStage11C()
PPMChildDatabase.pendingWrites()
```

Expected: parity is identical and there are no pending child writes.

Deletion remains a database **soft delete** (`deleted_at`), not SQL `DELETE`.

### Approval request

1. Save the cost plan so there are no unsaved edits.
2. Choose an active, sign-in-linked resource with `financials.approve`, `financials.viewDetail`, and access to the project as approver.
3. Submit the budget request.
4. Confirm the request appears as `Pending Approval` after a reload.
5. Re-run Stage 11C parity.

The server independently derives the requester identity, proposed budget, request
type and budget snapshot.

### Approval decision

A requester cannot decide their own request. A complete approval/rejection test
therefore requires signing in as the assigned, linked AAL2 approver.

The decision should:

- retain the request in approval history;
- set it to Approved or Rejected;
- on approval, increment `approvedBudgetVersion` exactly once;
- on approval, apply the submitted budget snapshot amount;
- update the project financial summary atomically;
- leave no pending writes;
- produce verified server audit entries.

If budget lines were changed after the request was submitted, **approval is refused**
as stale. The approver may reject the stale request and a new request can then be
raised from the current cost plan. Forecast/actual changes that do not alter the
submitted budget-line snapshot do not invalidate the request.

## Direct-bypass checks

After cutover, these legacy calls intentionally refuse workflow mutation:

```javascript
PPMFinancial.requestApproval("PRJ-XXXXX", {...})
PPMFinancial.decideApproval("FAP-XXXXX", {...})
```

The Financial Management page routes the real operation through
`PPMChildDatabase.commitFinancialWorkflow()` instead.

The database also rejects attempts to directly change approved-budget fields or to
INSERT/UPDATE approval rows outside the RPC.

## Rollback / panic control

Before making further edits, you can return these three compatibility stores to
local mode with:

```javascript
PPMChildDatabase.revertStage11C()
```

Then reload the page.

This changes browser source selection only. It does not delete PostgreSQL data and
does not remove the Stage 11C database guards.

Inspect failed child writes with:

```javascript
PPMChildDatabase.pendingWrites()
```

Do not clear a genuine pending write until the local change has either been safely
re-applied or deliberately discarded.

## Stage 11C scope boundary

This stage does **not** migrate:

- RAG history;
- resource demand;
- resource scenarios;
- legacy local audit history;
- financial category configuration (`ppmFinancialCategories`).

Those remain on their existing storage paths for now.
