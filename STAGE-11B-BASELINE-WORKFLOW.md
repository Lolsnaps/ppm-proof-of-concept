# Portfolio Manager — Stage 11B
## Approved Baselines + Rebaseline Requests, with transactional plan-date application

**Build:** `2026.08.07.21`

Stage 11B migrates the next coupled planning-governance group to PostgreSQL:

- `ppmPlanBaselines` → `public.plan_baselines`
- `ppmPlanBaselineRequests` → `public.plan_baseline_requests`

`ppmProjectPlans` / `public.project_plans` is already database-authoritative from Stage 10C. Stage 11B adds a database transaction that controls the approved baseline dates on those plan rows.

## Why this stage is transactional

The legacy approval path could perform several writes in sequence. A rebaseline approval could:

1. change baseline dates on the project plan;
2. save the plan;
3. create a new approved baseline version;
4. update the rebaseline request to Approved;
5. emit audit history.

After Stage 11B cutover, the approval/rejection/request workflow uses `public.ppm_commit_baseline_workflow(...)` as the commit boundary. PostgreSQL validates the actor, permissions, scope, current versions and workflow state, then commits all participating rows together. A failure rolls the database transaction back.

The RPC supports four operations:

- `request`
- `approve_initial`
- `approve_request`
- `reject_request`

## Server-side rules added

The migration installs three guards:

1. `plan_baselines` becomes workflow-owned immutable governance history. Direct browser inserts/updates/soft deletes are refused.
2. `plan_baseline_requests` can only be created/decided by the Stage 11B workflow RPC.
3. Once a project has an approved baseline, ordinary `project_plans` writes may not change `baselineStartDate` / `baselineEndDate`. Approved baseline dates can only change through an approved rebaseline.

Ordinary task editing remains available. The third guard protects only the approved baseline date fields.

The workflow RPC validates, among other things:

- authenticated AAL2 session;
- active `people.auth_user_id` linkage;
- project scope;
- `plan.requestBaseline` for requests;
- `plan.approveBaseline` for approvals/rejections;
- archived-project read-only status;
- loaded optimistic-lock versions for the plan and request;
- current plan row count, preventing an approval against a stale plan shape;
- current approved baseline identity/version;
- requester identity from the authenticated user rather than trusting the browser;
- segregation of duties: the requester cannot approve or reject their own request;
- proposed task IDs still existing in the project plan;
- duplicate task IDs in a proposal;
- proposed baseline finish dates not preceding start dates;
- every non-Phase/non-Deliverable task having initial baseline dates before first approval.

On rebaseline approval, the function applies the stored proposed dates, creates the next approved baseline snapshot and marks the request Approved in one transaction.

## Important first-run order

**Seed Stage 11B before running the migration SQL.**

This is deliberate. Once the guards are installed, direct browser insertion of historical baseline/request records is blocked.

### Step 1 — Start the v21 application

Keep your current working folder as the rollback copy. Extract the v21 full bundle into a new folder and run:

```bat
py -m http.server 8000
```

Sign in with password + TOTP and verify:

```javascript
await fetch("VERSION", { cache: "no-store" }).then((r) => r.text())
```

Expected:

```text
2026.08.07.21
```

Then:

```javascript
PPMChildDatabase.explain()
```

`planBaselines` and `baselineRequests` should show:

```text
stage: 11B
cutoverEligible: true
source: local
```

### Step 2 — Seed Stage 11B BEFORE applying the SQL migration

Run:

```javascript
await PPMChildDatabase.seedStage11B()
```

Then independently compare:

```javascript
await PPMChildDatabase.compareStage11B()
```

Do not continue unless:

```javascript
identical === true
```

for both collections.

The application is still local at this point.

### Step 3 — Apply the database migration

In Supabase SQL Editor run the **entire** file:

`STAGE-11B-BASELINE-WORKFLOW-MIGRATION.sql`

Then run:

`STAGE-11B-VERIFY.sql`

Every PASS/FAIL row should say `PASS`. The final row counts are diagnostic only.

Back in the browser:

```javascript
await PPMChildDatabase.stage11BServerReady()
```

Expected:

```javascript
{ ready: true, reason: "" }
```

### Step 4 — Cut over both collections together

Reconfirm parity:

```javascript
await PPMChildDatabase.compareStage11B()
```

Then:

```javascript
await PPMChildDatabase.cutOverStage11B()
```

Expected: `refused: false`, `source: "database"`.

Reload the page, then confirm:

```javascript
PPMChildDatabase.stage11BReady()
PPMChildDatabase.sourceFor("planBaselines")
PPMChildDatabase.sourceFor("baselineRequests")
```

Expected:

```text
true
database
database
```

## Live test 1 — Existing history still renders

Open a Project Plan that already has baseline history. Confirm:

- approved baseline badge/version renders;
- baseline dates remain read-only after approval;
- baseline history opens;
- any existing request history is present.

Then:

```javascript
await PPMChildDatabase.compareStage11B()
PPMChildDatabase.pendingWrites()
```

Expected: both `IDENTICAL`; no pending writes.

## Live test 2 — Initial baseline approval

This can be tested with one linked AAL2 user on a disposable project that has no approved baseline.

1. Create/save the disposable plan normally.
2. Ensure every Task/Milestone has baseline start and finish dates.
3. Select **Approve initial baseline** through the normal UI.
4. Confirm the baseline becomes Approved and version 1 appears.

Then:

```javascript
await PPMChildDatabase.flush("plans")
await PPMChildDatabase.flushStage11B()
await PPMChildDatabase.compare("plans")
await PPMChildDatabase.compareStage11B()
PPMChildDatabase.pendingWrites()
```

Expected: all comparisons `IDENTICAL`; no pending writes.

## Live test 3 — Rebaseline request

Using a project with an approved baseline:

1. Open **Request rebaseline**.
2. Change one disposable baseline date.
3. Submit normally.
4. Confirm a Requested row appears and the approved plan dates have **not** changed yet.

Then run the same parity/pending checks.

## Live test 4 — Rebaseline approval/rejection

The requester cannot approve or reject their own request. That rule is enforced again in PostgreSQL.

For a complete live decision test use a second linked Supabase account with AAL2 and `plan.approveBaseline`:

1. User A raises a disposable rebaseline request.
2. User B signs in and approves it.
3. Confirm the proposed dates are applied to the project plan.
4. Confirm a new approved baseline version is created.
5. Confirm the request becomes Approved.
6. Confirm the three changes appear together after refresh.

For rejection, repeat with another disposable request and reject it. The plan dates and approved baseline version must remain unchanged while the request becomes Rejected.

Do not weaken the self-approval rule just to test the workflow.

## Direct-write protection test

After cutover, the application UI should continue working normally. A direct browser attempt to alter an approved baseline date outside the RPC should be refused by PostgreSQL.

There is no need to manufacture such a failure during normal testing; the guard is included in `STAGE-11B-VERIFY.sql` and the application path no longer calls the old local baseline mutation functions once Stage 11B is database-authoritative.

## Server audit

The existing child-table audit triggers remain active:

- baseline creation is audited on `plan_baselines`;
- request creation/status change is audited on `plan_baseline_requests`;
- approved date changes are audited on `project_plans`.

The compatibility `PPMAudit` event is emitted only after the RPC succeeds. `public.audit_log` remains the verified server-side trail.

## Failure behaviour

If the RPC is refused or conflicts:

- PostgreSQL rolls back the transaction;
- no partial approved baseline is created;
- no request is half-decided;
- no subset of plan dates is applied;
- local compatibility audit is not emitted;
- the user receives an error.

A `40001` conflict means the plan/request changed after this browser loaded it. Reload and reapply the workflow action.

## Panic rollback

To return these two collections to local source selection:

```javascript
PPMChildDatabase.revertStage11B()
```

Then reload before making more changes.

This does not delete PostgreSQL data. It only changes the browser source selection, preserving the same rollback principle used by prior cutover stages.

## Files changed

- `ppm-child-database.js`
  - Stage 11B batch controls
  - server readiness probe
  - plan-version snapshot support
  - `commitBaselineWorkflow()` RPC bridge
- `ppm-planning-utils.js`
  - prevents legacy baseline mutation functions from bypassing the database workflow after cutover
- `project-plan-page.js`
  - baseline request/approval forms use the RPC after Stage 11B cutover
  - normal pre-cutover local behaviour remains available until explicit cutover
- all application HTML pages
  - v21 cache-bust
- `VERSION`
  - `2026.08.07.21`
- `STAGE-11B-BASELINE-WORKFLOW-MIGRATION.sql`
- `STAGE-11B-VERIFY.sql`
