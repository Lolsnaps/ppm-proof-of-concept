# Stage 17 — the four governance workflows are unreachable

**Status:** investigated, not fixed. Decision needed.
**Found:** 10 August 2026, while migrating `ppm-stage-gate-utils.js` for Stage 16.
**Severity:** the four governance features do not work, and fail silently. **Not** a security hole —
the database refuses every attempt, which is why nothing was corrupted.

---

## 1. In one paragraph

Stage gates, plan baselines, budget approvals and resource-scenario publishing were each cut over
to a transactional PostgreSQL function. Each client module asks the adapter whether that workflow
is available before using it. The four functions it asks for were removed from the adapter in
Stage 14 and nothing updated the callers, so all four questions now answer "no" — silently,
because they are optional calls. Every one of those features falls back to writing rows directly.
The database refuses those writes, correctly, via a guard trigger. The refusal travels back
through the fire-and-forget write seam and is never shown. So the screen says the gate was
submitted, the database says it was not, and the next page load agrees with the database.

---

## 2. The chain, with evidence

### 2.1 The client asks a question that can no longer be answered

```js
// ppm-stage-gate-utils.js
function databaseWorkflowEnabled() {
  return Boolean(window.PPMChildDatabase?.stage11AReady?.());
}
```

Four modules, four probes, all identical in shape:

| Module | Probe it calls | Exists on the adapter? |
| --- | --- | --- |
| `ppm-stage-gate-utils.js` | `stage11AReady` | no |
| `ppm-planning-utils.js` | `stage11BReady` | no |
| `ppm-financial-utils.js` | `stage11CReady` | no |
| `ppm-resource-management-features.js` | `stage11DReady` | no |

Confirmed in the harness rig — all four are `undefined`, and
`PPMFinancial.databaseFinancialWorkflowEnabled()` returns `false`. Two of the four,
`stage11AReady` and `stage12Ready`, are on `STAGE-14-HARNESS.mjs`'s own **retired API** list: the
harness asserts they are gone. Retiring them was deliberate. Leaving four callers asking for them
was not.

**`?.()` is what makes it silent.** An optional call on a missing method yields `undefined`
rather than throwing, and `Boolean(undefined)` is `false`. A plain call would have thrown on the
first stage-gate submission and been fixed the same day.

### 2.2 So the four transactional functions are never called

`ppm_commit_stage_gate_workflow`, `ppm_commit_baseline_workflow`, `ppm_commit_financial_workflow`
and `ppm_commit_resource_scenario_workflow` all exist in the database, are implemented in the
adapter, and are covered by migrations and verification SQL. Between them they carry **174
`raise exception` clauses**. None of them is reachable from the user interface.

A sample of what the stage-gate function alone enforces:

- You cannot approve or decide a stage gate that you submitted or own
- The submission owner cannot also be a required approver
- Only an assigned required approver can decide this stage gate
- Every required approver must be an active resource with stage-gate approval permission
- Required approvers cannot be changed during an approval decision
- Stage gate % changed while you were deciding it (loaded version %, current version %)
- The calculated final status does not match the requested decision

The fourth of those is the multi-role work from Stage 15A. It is enforcing rules on a path
nothing takes.

### 2.3 The database refuses the fallback — proven, not assumed

Each of the four tables carries a guard trigger that permits the write only when the matching
session flag is set, and only the transactional function sets it:

| Guard | Session flag |
| --- | --- |
| `guard_stage_gate_workflow_write` | `ppm.stage_gate_workflow` |
| `guard_plan_baseline_workflow_write` | `ppm.baseline_workflow` |
| `guard_financial_approval_workflow_write` | `ppm.financial_workflow` |
| `guard_resource_scenario_workflow_write` | `ppm.resource_scenario_workflow` |

Two probes against the live database, both inside transactions that rolled back:

```
attempt: set an approved gate's workflowStatus directly
result : GUARD FIRED - Submitted/approved/closed stage gates are read-only
         outside the governance workflow. [42501]

attempt: submit one of the 6 Draft gates directly
result : GUARD FIRED - Stage-gate workflow status can only change through the
         governance workflow. [42501]
```

So the design holds. Nothing has been corrupted and nobody has approved their own gate. The
enforcement is exactly where it should be.

### 2.4 And the refusal is swallowed

The client write goes `rawWrite` → `PPMAuth.writeScoped` → the patched `Storage.prototype.setItem`
→ `syncFromRawValue` → `enqueueSync(...).catch(console.error)`. The local copy succeeds, the page
re-renders from it, and the database's refusal reaches a console nobody is reading.

This is the Stage 16 defect in its purest form. The database was right, the client was wrong, and
the seam is the reason the disagreement was invisible for months.

### 2.5 What the data shows

| Status | Gates | Version | Last updated |
| --- | --- | --- | --- |
| Approved | 35 | 2 | 9 Aug 2026 |
| Submitted | 6 | 2 | 9 Aug 2026 |
| Draft | 6 | 1 | 9 Aug 2026 |

Every non-Draft gate sits at version 2 — inserted, then transitioned once, all on the day the
demo portfolio was seeded server-side. No gate has ever reached version 3. Consistent with no
transition ever having succeeded from the interface.

---

## 3. What this means in practice

For each of the four features, a user can go through the motions and the change will not persist:

- **Stage gates** — submit, approve, reject, cancel, request or decide a route exception
- **Plan baselines** — request a rebaseline, approve or reject one
- **Financial approvals** — request budget approval, approve or reject
- **Resource scenarios** — publish a scenario to live demand, reject a scenario

The screen updates. The next page load undoes it.

Drafting a gate still works: creating a Draft row is an ordinary insert the guard permits.
Everything *after* the draft is where it stops.

---

## 4. Why the release gates did not catch it

Fairly: nothing was looking for this.

- `VERIFY-STATIC.mjs` checks structure, not whether a method a caller depends on exists.
- `STAGE-14-HARNESS.mjs` asserts the retired names are **absent**, which is the opposite question,
  and it never asserted that a workflow could still be run.
- `VERIFY-INVARIANTS.sql` checks the database, which is behaving correctly.
- `SCHEMA-DRIFT-CHECK.mjs` compares three descriptions of the schema, and the schema is fine.

The gap is that no gate asks whether the client and the adapter still agree about the adapter's
API. That is worth fixing whatever is decided below, and it is cheap: the names a module calls on
another module's global can be checked statically.

---

## 5. Options

**A. Re-enable the workflows.** Replace the four probes with something that reports the truth —
the workflow is available if the adapter exposes the commit function and the session is at AAL2.
This restores transactional governance and turns on 174 server-side checks that have never run
against real use. Expect it to surface disagreements between the client's rules and the database's,
because the client's have been the only ones operating.

**B. Remove the fallback path.** Whether or not A happens, the direct-write path in these four
modules is dead weight that pretends to work. Making it fail loudly — or deleting it — means a
future regression is an error rather than a silence.

**C. Do neither yet, but stop it lying.** Smallest change: surface the refusal. The Stage 16 work
already makes writes return a reason, so these become visible errors rather than silent ones.

**Recommendation: A and B together, before continuing Stage 16.** The stage-gate module is the
next one due for migration, and there is no sense migrating a fallback path that should not exist.
Doing A first also means the Stage 16 migration of that module is small — the workflow calls the
RPC, and the RPC does the writing.

The risk in A is real and worth stating: these checks have never run in anger. Some will fire on
data the interface currently allows. That is the point of them, but it will look like new failures
appearing, and it should be done with time to work through what they report rather than in a hurry.

---

## 6. Fixed, and verified against the live database

**A — reachable again.** The four probes now call `PPMChildDatabase.workflowReady(name)`, which
reports something true: the commit function exists and there is a client to call it with. Named
by workflow rather than by migration stage, so it does not date. All four report ready.

**B — no fallback.** Nine places across four modules used to write rows the database refuses.
Stage gates now throw; the other three show an error and stop. A governance transition either
goes through the transaction that enforces the rules, or it does not happen.

### 6.1 What was verified, and how

Every probe below ran inside a transaction that rolled back. Nothing was left changed.

| Check | Result |
| --- | --- |
| All four RPC call signatures match the live function parameters | matched, 9/7/7/3 arguments |
| The RPC refuses with no signed-in user | `You must be signed in to record a governance workflow.` |
| A workflow write outside the transaction | refused: `...can only change through the governance workflow.` |
| The same write with `ppm.stage_gate_workflow` set, as the RPC sets it | permitted |

Then the whole function was exercised as a real signed-in user, by setting `request.jwt.claims`
to a genuine person's id at `aal2`, exactly as PostgREST would. It refused four times in a row,
each time for a different and correct reason, walking further into the rules each attempt:

1. `The stage gate is outside your project access.` — actor lacked project scope
2. `Required approver identities cannot be changed while recording a workflow decision.`
3. `The workflow actor does not match the signed-in account.` — checks `updatedByResourceId`
4. `Every required approver must be an active resource with stage-gate approval permission.`

The function works. Those guards are live and doing their job.

### 6.2 The blocker: no stage gate in the portfolio can currently be submitted

Attempt 4 is not a code fault. It is the data:

| Named approver | Role | Account | Can approve? | Gates naming them |
| --- | --- | --- | --- | --- |
| Rachel Okonjo | Portfolio Manager / PMO Manager | Not enabled | no | 47 |
| Daniel Whitfield | Executive / Steering User | Not enabled | no | 19 |
| Nadia Kaur | Project Sponsor / Project Lead | Not enabled | no | 16 |
| Owen Pritchard | Project Sponsor / Project Lead | Not enabled | no | 12 |

Those are the only four people named as required approvers anywhere in the portfolio, and none
of them can approve. They hold the right *roles* — two of the three roles that carry
`stageGates.approve` — but they have no login, and `private.person_has_permission` requires an
active account. The only two people who can approve anything are the two System Administrators.

So with the workflow correctly enabled, **every stage-gate submission will be refused** until
this is resolved.

**This is not a disagreement between client and database.** `stage-gates-page.js` filters the
approver picker by `accountStatus === "Active" && resourceCan(resource, "stageGates.approve")`,
which is the same rule. The gates were seeded server-side with approvers the interface itself
would not have offered.

Two ways to resolve it, and it is a business decision rather than a technical one:

- **Give those four people enabled accounts.** Correct if they are the real approvers — a
  sponsor who approves gates needs a login to do it.
- **Reseed the demo gates with eligible approvers.** Correct if they are illustrative names.

### 6.3 What is still untested

The signed-in path was simulated by setting the JWT claims directly. That exercises every rule
in the function, but not the browser: the client building the payload, the adapter sending it,
and the response coming back through `ppm-child-database.js`. That needs one real submission
through the interface, which needs the blocker above cleared first.
