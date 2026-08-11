# Portfolio Manager — Stage 11D
## Transactional Resource Demand + Resource Scenario Workflow

Build: **2026.08.07.23**

Stage 11D migrates the remaining resource-planning child collections together:

- `ppmResourceDemand` → `public.resource_demand`
- `ppmResourceScenarios` → `public.resource_scenarios`

The two collections are deliberately coupled. A resource scenario is a snapshot of
live demand and may span several projects, so publishing it cannot safely be a
browser sequence that rewrites one store and then marks the scenario Published.
Stage 11D gives that decision one PostgreSQL transaction boundary.

## What changes

Normal resource-demand CRUD remains compatible with the existing Resource
Management page and uses the established child-adapter optimistic write-through.
Draft scenario creation and adjustment also continue through normal row-level
write-through.

Scenario terminal decisions use one PostgreSQL transaction:

```text
Publish scenario
  → validate AAL2 / linked resource / resourceManagement.edit
  → validate resourceManagement.publishScenario
  → lock the scenario and verify its optimistic version
  → validate access to EVERY project represented in the scenario
  → verify the immutable source-demand version snapshot
  → lock every snapshotted demand row in deterministic order
  → refuse if any snapshotted demand changed or disappeared
  → apply only those snapshotted demand rows
  → mark the scenario Published
  → server audit
  → COMMIT

Reject scenario
  → validate AAL2 / linked resource / resourceManagement.edit
  → lock + version-check scenario
  → validate access to every represented project
  → mark scenario Rejected; live demand stays unchanged
  → server audit
  → COMMIT
```

Any error rolls back the whole workflow operation.

### Safer publication semantics

The old browser implementation replaced the live demand collection with the
scenario's array. That creates a race: demand added after the scenario was created
could be silently removed by publishing an older snapshot.

Stage 11D instead records an immutable `sourceDemandVersions` map when a new Draft
scenario is created. Publishing updates only those snapshotted demand rows and
refuses if any of them has changed since snapshot creation. Demand created later
is deliberately left untouched.

A Draft scenario created **before Stage 11D cutover** has no server-verifiable
version snapshot. It can still be viewed, edited or rejected, but it cannot be
published. Recreate it after cutover if it needs to be published.

## Scope/security corrections included in Stage 11D

Stage 10A correctly recognised that a scenario is not owned by one project, but its
interim database policy was permission-only. A scoped Resource Manager could
therefore potentially receive a scenario whose embedded demand included a project
outside their project scope.

Stage 11D fixes that by:

- deriving `resource_scenarios.project_codes` from the embedded demand snapshot;
- requiring access to **all** those projects for scenario SELECT/INSERT/UPDATE;
- applying the same all-project rule to scenario audit visibility;
- updating the browser's local compatibility scope filter so hidden scenarios are
  neither exposed nor accidentally destroyed by a scoped user's save;
- completing the previously deferred Team-project scope logic using the now-
  database-backed resource-demand and project-plan data.

`project_codes` is server-derived. The browser does not get to declare its own
scenario scope.

## Resource audit improvement

`resource_demand` and `resource_scenarios` were Stage 9 scaffold tables, so their
business fields live in `legacy_payload`. The generic Stage 8/9 audit deliberately
ignores `legacy_payload` to avoid storing giant duplicate payloads.

Stage 11D therefore adds a compact payload-aware audit trigger for meaningful
resource-demand fields and scenario state/snapshot changes. It keeps the existing
append-only `audit_log`; no browser audit INSERT privilege is introduced.

## Still local / outside Stage 11D

This stage does **not** invent database tables for resource-planning stores that were
not part of the Stage 9 child schema. The following remain local in this build:

- `ppmResourceAbsence`
- `ppmResourceConfig`
- `ppmResourceGanttViews`

They should be reviewed as a separate migration decision rather than silently folded
into the demand/scenario transaction.

## Important first-run order

**Do not install the Stage 11D SQL before seeding.**

Historical resource scenarios must be in PostgreSQL before the new workflow guard
and all-project scope are installed.

### 1. Keep the current working folder

Keep the post-Stage-11C folder unchanged as a rollback copy.

Extract the Stage 11D full ZIP to a new folder and serve that folder with:

```bat
py -m http.server 8000
```

Sign in normally and verify:

```javascript
await fetch("VERSION", { cache: "no-store" }).then(r => r.text())
```

Expected build:

```text
2026.08.07.23
```

### 2. Inspect the two local collections

```javascript
PPMChildDatabase.preview("resourceDemand")
PPMChildDatabase.preview("resourceScenarios")
```

Both should report `valid: true`.

### 3. Seed current browser data

```javascript
await PPMChildDatabase.seedStage11D()
```

This does **not** cut either module over.

Then:

```javascript
await PPMChildDatabase.compareStage11D()
```

Do not continue unless both modules report `IDENTICAL` and the combined result has
`identical: true`.

### 4. Install the Stage 11D database workflow

Run the complete file in a fresh Supabase SQL Editor query:

`STAGE-11D-RESOURCE-WORKFLOW-MIGRATION.sql`

It is wrapped in `BEGIN` / `COMMIT`. If Supabase reports an error, stop rather than
continuing with a partially understood state.

### 5. Run read-only verification

Run:

`STAGE-11D-VERIFY.sql`

Every PASS/FAIL result should be **PASS**.

The final diagnostic rows are informational. In particular, the count of Draft
scenarios without a Stage 11D version snapshot may legitimately be non-zero if an
old Draft was seeded. Such a Draft must be recreated before publication.

### 6. Confirm server readiness from the browser

```javascript
await PPMChildDatabase.stage11DServerReady()
```

Expected:

```javascript
{ ready: true, reason: "" }
```

### 7. Cut both resource collections over together

```javascript
await PPMChildDatabase.cutOverStage11D()
```

The adapter refuses cutover if server readiness or parity does not pass.

Reload after successful cutover. Then verify:

```javascript
PPMChildDatabase.stage11DReady()
PPMChildDatabase.sourceFor("resourceDemand")
PPMChildDatabase.sourceFor("resourceScenarios")
```

Expected:

```text
true
database
database
```

## Live functional tests

Use disposable records/projects where practical.

### A. Resource-demand CRUD

1. Create a disposable resource-demand row through Resource Management.
2. Edit its allocation/date/notes and save.
3. Remove the disposable row if the normal UI provides that operation.
4. Run:

```javascript
await PPMChildDatabase.flushStage11D()
await PPMChildDatabase.compareStage11D()
PPMChildDatabase.pendingWrites()
```

Expected: both modules remain identical and no Stage 11D writes are pending.
Deletion remains a database soft delete; SQL `DELETE` stays revoked.

### B. Fresh scenario + publish

Create the scenario **after Stage 11D cutover** so it captures
`sourceDemandVersions`.

1. Create a new Draft scenario from live demand.
2. Adjust one demand item in the scenario.
3. Publish it as a user holding `resourceManagement.publishScenario`.
4. Confirm the selected demand adjustment became live.
5. Confirm demand created after the scenario, if any, was not removed.
6. Confirm the scenario now shows Published and cannot be edited as Draft.
7. Run:

```javascript
await PPMChildDatabase.flushStage11D()
await PPMChildDatabase.compareStage11D()
PPMChildDatabase.pendingWrites()
```

Expected: `IDENTICAL`, with no pending writes.

### C. Optimistic-concurrency refusal

This test proves the important race protection.

1. Create a fresh Draft scenario.
2. Before publishing it, edit one of its source demand rows in the normal live
   demand UI and ensure that edit is saved.
3. Attempt to publish the older scenario.

Expected: publication is refused as stale. The scenario remains Draft and no
scenario demand changes are partially applied to live demand. Recreate the scenario
from the current live demand before publishing.

### D. Reject scenario

1. Create a fresh Draft scenario.
2. Reject it.
3. Confirm its status is Rejected after reload.
4. Confirm live demand is unchanged.
5. Confirm parity remains exact.

### E. Scoped-user test, if you have a suitable account

For a non-Portfolio-wide resource user, a scenario that contains demand from any
project outside that user's authorised scope must not be readable or writable.
This is enforced independently by both browser compatibility filtering and RLS.

## Coupled-source protection

These two modules cannot be switched independently:

```javascript
PPMChildDatabase.setSource("resourceDemand", "database")
PPMChildDatabase.setSource("resourceScenarios", "database")
```

An individual switch that would split the pair is intentionally refused. Use the
Stage 11D batch controls instead.

## Rollback / panic control

Before further edits, return the pair to local compatibility mode with:

```javascript
PPMChildDatabase.revertStage11D()
```

Then reload.

This changes the browser source selection only. It does not delete PostgreSQL data.
Do not use rollback as a substitute for resolving pending writes after making
production edits.

## Stage 11D completion criteria

Stage 11D is complete when:

- seed and parity pass for both resource collections;
- the migration and verification SQL pass;
- `stage11DServerReady()` returns ready;
- both sources are `database` after reload;
- normal demand CRUD survives reload and parity;
- a fresh scenario publishes atomically;
- a stale scenario publish is refused without partial demand changes;
- rejection leaves live demand unchanged;
- no unexpected pending writes remain.

After this, the remaining child work is substantially smaller: RAG-history
migration and legacy-audit consolidation remain deferred, while the major coupled
governance, baseline, financial and resource workflows are database-backed.
