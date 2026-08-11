# Stage 10C — Low-risk child collection batch cutover

**Prepared:** 7 August 2026  
**Build:** `2026.08.07.19`  
**Starting point:** PPM Tool 31 / Stage 10B passed in the live browser

## What this stage does

Stage 10B proved the child-table pattern with milestones. Stage 10C enables the same database-authoritative path for five additional collections:

- `plans` → `ppmProjectPlans` → `public.project_plans`
- `raid` → `ppmProjectRaid` → `public.project_raid`
- `benefits` → `ppmProjectBenefits` → `public.project_benefits`
- `documents` → `ppmProjectDocuments` → `public.project_documents`
- `statusReports` → `ppmStatusReports` → `public.status_reports`

Nothing is switched merely by opening this build. All five remain local until the explicit seed/parity/cutover commands below are run.

Milestones remain database-authoritative if they were already cut over in Stage 10B.

## Why only these five

The remaining collections are deliberately held back because several participate in workflows that span more than one child collection:

- stage-gate decisions can create/update Actions and Decisions;
- budget approval changes both approval requests and financial summaries;
- baseline approval couples baseline requests and approved baselines;
- resource scenario publication couples scenarios and demand;
- RAG history is generated alongside other status/project changes;
- legacy audit has a separate historical/server-audit migration story.

Cutting those collections independently would recreate the partial-transaction risk that the migration is trying to eliminate. They are left for the transactional workflow stage.

## A bootstrap race fixed in this stage

The original application intentionally has synchronous page scripts, while PostgreSQL hydration is asynchronous. Stage 10B explicitly awaited child hydration on the Milestones page, but other pages still loaded their page/domain scripts directly.

Stage 10C adds `ppm-page-loader.js`. On every protected application page it:

1. waits for `PPMDatabase.ready` (projects/programmes/portfolios);
2. waits for `PPMChildDatabase.ready` (active child collections);
3. loads the page's existing domain/page scripts in **the same order they used before**.

The scripts themselves are not rewritten and remain ordinary classic JavaScript. No `defer`, `async` or module conversion was introduced.

`ppm-auth-utils.js` and `ppm-notifications.js` also wait for hydration before their DOM-ready work. The synchronous `requireAuth()` gate remains synchronous and still runs before protected page code.

This also closes a latent Stage 6 race where a fast page could theoretically read the compatibility local store before top-level database hydration completed.

---

# Files changed

- `ppm-child-database.js` — five-module cutover allowlist + batch controls
- `ppm-page-loader.js` — new hydration-aware page bootstrap
- `ppm-auth-utils.js` — post-auth DOM initialization waits for hydration
- `ppm-notifications.js` — first notification refresh waits for hydration
- all 18 protected HTML pages — body script chain routed through the loader, original order preserved
- `VERSION` — `2026.08.07.19`

No database schema migration is required by Stage 10C. Stage 9 and Stage 10A already created the tables, RLS, optimistic-lock triggers, audit triggers and `deleted_at` support.

---

# Before cutover

Keep the working PPM Tool 31 folder as the rollback copy and use the Stage 10C full bundle from a fresh folder.

Start localhost normally and sign in with MFA.

Check the build:

```javascript
await fetch("VERSION", { cache: "no-store" }).then((r) => r.text())
```

Expected: `2026.08.07.19`.

Then:

```javascript
PPMChildDatabase.explain()
```

The five Stage 10C rows should show `cutoverEligible: true`, stage `10C`, and source `local` until you switch them.

Milestones should remain stage `10B` and source `database` if your Stage 10B cutover is still active.

---

# Step 1 — optional database posture check

Run `STAGE-10C-VERIFY.sql` in the Supabase SQL Editor.

It is read-only. All checks should say `PASS`.

Stop if any check fails.

---

# Step 2 — seed the five collections

In the browser console:

```javascript
await PPMChildDatabase.seedBatch()
```

This does **not** change what the application reads.

For each collection it:

- validates the current browser shape;
- inserts records that do not already exist;
- leaves existing database records untouched;
- compares localStorage with the database immediately afterwards.

Empty collections are valid. An empty local collection and empty table should report `IDENTICAL`.

If the operation stops/refuses, do not cut over. Inspect the named module first.

---

# Step 3 — parity gate

Run:

```javascript
await PPMChildDatabase.compareBatch()
```

Required result:

```text
Stage 10C parity PASS for plans, raid, benefits, documents, statusReports.
```

The returned object must have:

```javascript
identical === true
```

Do not continue while any module has:

- only-in-local rows;
- only-in-database rows;
- field differences;
- an invalid local record.

---

# Step 4 — cut over as one guarded batch

Run:

```javascript
await PPMChildDatabase.cutOverBatch()
```

The batch first re-runs parity. It refuses before changing source settings if anything differs or if any pending write exists.

On success it reports that these are database-authoritative:

```text
plans, raid, benefits, documents, statusReports
```

Then **reload the page before editing**.

Check:

```javascript
PPMChildDatabase.sources()
```

You should see database mode for the five Stage 10C modules, plus milestones from Stage 10B.

---

# Step 5 — normal application regression

Use the application normally. The most useful live tests are:

### Project Plan

Open a project plan and create or edit a disposable task. Save it.

```javascript
await PPMChildDatabase.flush("plans")
await PPMChildDatabase.compare("plans")
```

Expected: no refused/failed/conflict writes and `IDENTICAL`.

### RAID

Create or edit a disposable RAID item, save, then:

```javascript
await PPMChildDatabase.flush("raid")
await PPMChildDatabase.compare("raid")
```

Expected: `IDENTICAL`.

### Benefits

Use Benefits Management to create/edit a disposable project-level benefit. Then:

```javascript
await PPMChildDatabase.flush("benefits")
await PPMChildDatabase.compare("benefits")
```

Expected: `IDENTICAL`.

Programme-level benefits are also supported by the Stage 10A `programme_code` policy; do not manufacture one purely for testing if you do not normally use them.

### Documents

Use the Documents tab / project document UI to add or edit a disposable record, then:

```javascript
await PPMChildDatabase.flush("documents")
await PPMChildDatabase.compare("documents")
```

Expected: `IDENTICAL`.

### Status reports

Use the Status Reports register to create/edit a disposable draft, then:

```javascript
await PPMChildDatabase.flush("statusReports")
await PPMChildDatabase.compare("statusReports")
```

Expected: `IDENTICAL`.

---

# Delete test

The database still grants no SQL DELETE. Removing a record from one of these local compatibility collections is represented as an audited UPDATE setting `deleted_at`.

For one disposable record only, delete it through the normal UI, then:

```javascript
await PPMChildDatabase.flushBatch()
await PPMChildDatabase.compareBatch()
```

Expected: parity remains identical and no pending writes remain.

Check:

```javascript
PPMChildDatabase.pendingWrites()
```

Expected:

```text
no unsaved child changes
```

---

# Panic button

If a Stage 10C collection behaves incorrectly:

```javascript
PPMChildDatabase.revertBatch()
```

Then reload.

This returns only the five Stage 10C collections to local mode. It does **not** revert milestones or modify/delete database rows.

You can also revert one approved module:

```javascript
PPMChildDatabase.revertToLocal("plans")
```

Pending-write diagnostics are retained so a failure is not hidden.

---

# New console API

```javascript
PPMChildDatabase.STAGE_10C_BATCH
PPMChildDatabase.DEFERRED_WORKFLOW_MODULES

await PPMChildDatabase.seedBatch()
await PPMChildDatabase.compareBatch()
await PPMChildDatabase.cutOverBatch()
await PPMChildDatabase.flushBatch()
PPMChildDatabase.revertBatch()
```

Existing single-module methods still work for all approved cutover modules:

```javascript
await PPMChildDatabase.cutOver("plans")
PPMChildDatabase.revertToLocal("plans")
```

---

# Verification performed before delivery

### Static

- every JavaScript file parses with Node;
- all 18 protected pages use the Stage 10C page loader;
- the loader preserves each page's original body-script ordering exactly;
- all application asset stamps are `2026.08.07.19`;
- login remains a direct login flow rather than being held behind the page loader;
- no Stage 10C code uses SQL DELETE.

### Adapter harness

An isolated Supabase-compatible test exercised all five Stage 10C modules:

- seed + parity for all five;
- guarded batch cutover;
- database source persisted for all five;
- ordinary update/write-through for all five;
- optimistic version progression;
- parity after every update;
- document soft-delete via `deleted_at`;
- parity after soft delete;
- deferred workflow modules refused for cutover;
- batch revert returns the five modules to local mode.

### Page-bootstrap harness

The loader was tested with delayed database promises and confirmed that:

- no page script loads before hydration resolves;
- page scripts load sequentially in their original order.

A full Chromium localhost smoke run could not be executed in this environment because localhost browser navigation is blocked by the runtime administrator. The live browser regression steps above remain required.

---

# Still deferred

These collections intentionally remain local after Stage 10C:

```text
actions
decisions
financials
stageGates
planBaselines
baselineRequests
ragHistory
financialEntries
financialApprovals
resourceDemand
resourceScenarios
legacyAudit
```

The next stage should address the workflow groups transactionally rather than cutting their component collections over independently.
