# Portfolio Manager — Stage 11A
## Actions + Decisions + Stage Gates, with transactional governance workflow

**Build:** `2026.08.07.20`

Stage 11A moves the next coupled governance group to PostgreSQL:

- `ppmProjectActions` → `public.project_actions`
- `ppmProjectDecisions` → `public.project_decisions`
- `ppmStageGates` → `public.stage_gates`

The important change is not just the three collection cutovers. Stage-gate workflow decisions now have a single database transaction as their commit boundary.

## Why this stage is different

The legacy stage-gate workflow could change several stores in sequence: the gate, generated Actions, a linked Decision and, on final approval, the Project stage. A browser/network failure between those writes could leave a half-completed governance decision.

After Stage 11A cutover, the browser still calculates the same result for UI compatibility, but captures those changes in memory and sends them to `public.ppm_commit_stage_gate_workflow(...)`. PostgreSQL then validates and commits the whole workflow together. If any validation or write fails, the transaction rolls back.

The RPC checks, among other things:

- authenticated AAL2 session;
- active `people.auth_user_id` linkage;
- project scope;
- `stageGates.submit`, `stageGates.approve` or `stageGates.override` as appropriate;
- loaded optimistic-lock versions;
- allowed workflow transition;
- submitter / owner self-approval rules;
- assigned approver identity and decision ownership;
- active approvers with the required server-side permission on submission;
- route-exception approver and separation of duties;
- unchanged gate definition / approver identities during a workflow action;
- generated Actions matching the already-submitted `actionsArising` definitions;
- linked Decision integrity;
- project-stage consistency before final approval.

Final approval does **not** accept an arbitrary replacement Project payload. PostgreSQL preserves the existing Project and changes only the stage-related fields, appending the stage-history entry server-side.

Stage 11A also installs `private.guard_stage_gate_workflow_write()`. Ordinary Draft/Deferred/Rejected gate editing still uses the normal row write-through path, but direct table writes can no longer change workflow status/history/links or modify submitted/approved/closed gates. Workflow movement must use the transactional RPC.

## Important first-run order

**Seed the three Stage 11A collections before running the Stage 11A migration SQL.**

This is intentional. Once the workflow guard is installed, a brand-new direct `stage_gates` INSERT must be a clean Draft. That prevents a browser caller from manufacturing an already-approved gate. Existing historical non-Draft gates therefore need to be seeded before the guard is enabled.

Seeding does **not** cut the application over; all three collections remain local until the explicit cutover step.

## Step 1 — Start the v20 application

Keep the currently working folder as your rollback copy. Extract the v20 full bundle into a fresh folder and run it normally with:

```bat
py -m http.server 8000
```

Sign in with password + TOTP and verify:

```javascript
await fetch("VERSION", { cache: "no-store" }).then(r => r.text())
```

Expected: `2026.08.07.20`.

Then:

```javascript
PPMChildDatabase.explain()
```

`actions`, `decisions` and `stageGates` should show `stage: "11A"`, `cutoverEligible: true`, and initially `source: "local"`.

## Step 2 — Seed Stage 11A BEFORE the migration SQL

Run:

```javascript
await PPMChildDatabase.seedStage11A()
```

Then independently compare:

```javascript
await PPMChildDatabase.compareStage11A()
```

Do not continue unless the returned object has:

```text
identical: true
```

for Actions, Decisions and Stage Gates.

If one differs, stop. At this point the application is still local, so nothing has been cut over.

## Step 3 — Apply the Stage 11A database migration

In Supabase SQL Editor, run the **entire** file:

`STAGE-11A-GOVERNANCE-WORKFLOW-MIGRATION.sql`

It creates/replaces:

- `private.guard_stage_gate_workflow_write()`;
- trigger `trg_stage_gates_workflow_guard`;
- `public.ppm_stage11a_ready()`;
- `public.ppm_commit_stage_gate_workflow(...)`.

The migration is safe to re-run after the initial seed has been completed.

Then run `STAGE-11A-VERIFY.sql`. Every PASS/FAIL check should return `PASS`. The final row-count query is diagnostic only.

Back in the browser, confirm the migration is visible:

```javascript
await PPMChildDatabase.stage11AServerReady()
```

Expected:

```javascript
{ ready: true, reason: "" }
```

The client refuses Stage 11A cutover if this server check does not pass.

## Step 4 — Cut over the three collections together

Reconfirm parity:

```javascript
await PPMChildDatabase.compareStage11A()
```

Then:

```javascript
await PPMChildDatabase.cutOverStage11A()
```

Expected: `refused: false`, `source: "database"`.

Reload the page. Then check:

```javascript
PPMChildDatabase.stage11AReady()
PPMChildDatabase.sourceFor("actions")
PPMChildDatabase.sourceFor("decisions")
PPMChildDatabase.sourceFor("stageGates")
```

Expected: `true`, then `database` for all three modules.

## Step 5 — Normal Register CRUD test

Using a disposable test project/record:

1. Create an Action through Registers.
2. Edit it and save.
3. Create a Decision through Registers.
4. Edit it and save.
5. Delete the disposable Action/Decision through the UI if appropriate.

Then run:

```javascript
await PPMChildDatabase.flushStage11A()
await PPMChildDatabase.compare("actions")
await PPMChildDatabase.compare("decisions")
PPMChildDatabase.pendingWrites()
```

Both comparisons should be `IDENTICAL`; there should be no Stage 11A pending write.

Deletes remain soft deletes through `deleted_at`; the browser still has no SQL `DELETE` grant. For Stage Gates specifically, once Stage 11A is database-authoritative only **Draft** gates can be deleted. Deferred/Rejected/submitted/decided gates are retained as governance history.

## Step 6 — Stage-gate workflow test that needs only one login

Use a **disposable gate** on a test project.

1. Create/save it as Draft normally.
2. Give it a required approver who is a different active resource with `stageGates.approve`.
3. Submit it through the normal Stage Gates page.
4. After the successful submit, cancel it as the submitter/owner.

Submission and cancellation both use the Stage 11A RPC after cutover. They exercise the database workflow boundary without requiring you to sign in as a second user.

After each operation:

```javascript
await PPMChildDatabase.flushStage11A()
await PPMChildDatabase.compareStage11A()
PPMChildDatabase.pendingWrites()
```

Expected: all three collections `IDENTICAL`, with no pending write.

## Step 7 — Full approval / multi-record transaction

A genuine approval must retain separation of duties, so the submitter cannot approve their own gate. To live-test the full Gate + Action + Decision + Project transaction, use a disposable project and a second linked Supabase account with AAL2:

1. User A creates/submits a disposable gate.
2. Assign User B as required approver.
3. Include one disposable Action arising with owner and due date.
4. Sign in as User B and approve the gate.
5. Verify the Project advanced exactly once.
6. Verify the linked Action was created.
7. Verify the linked Decision was created/updated.
8. Verify the Stage Gate is Approved.

Do not weaken or bypass the self-approval rule just to perform this test. If a second linked AAL2 account is not available, the submit/cancel test above can still validate the RPC wiring, but the final multi-record approval path remains to be live-tested later.

## Server audit check

The PostgreSQL audit triggers remain active on Actions, Decisions, Stage Gates and Projects. After a test workflow, this console command shows the immutable server-side changes visible to the signed-in role:

```javascript
await PPMDatabase.auditReport()
```

The existing local audit events are also replayed **only after** PostgreSQL commits so the current Audit History UX continues to work. They are not the security boundary; `public.audit_log` remains the verified audit trail.

## Failure behaviour

If the RPC is refused or conflicts:

- PostgreSQL rolls back the workflow transaction;
- the captured browser mutations are discarded;
- legacy local audit/events are not emitted;
- no Project stage is partially advanced;
- no linked Action/Decision is partially created;
- the error is shown to the user.

A version conflict should be resolved by reloading and reapplying the workflow decision against the newest database state.

## Panic rollback

To return these three collections to local source selection:

```javascript
PPMChildDatabase.revertStage11A()
location.reload()
```

This changes the application's source selection only. It does **not** undo database rows already committed.

## Deferred after Stage 11A

Stage 11A deliberately does not cut over the remaining coupled groups yet:

- Project financials / financial entries / financial approval requests;
- plan baselines / baseline requests;
- resource demand / resource scenarios;
- RAG history;
- legacy audit-history consolidation.

Those remain later transactional stages.
