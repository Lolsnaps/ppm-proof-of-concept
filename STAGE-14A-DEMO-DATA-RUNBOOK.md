# Stage 14A — load the demo portfolio

This adds a realistic delivery portfolio to your database so you can test
functions, permissions and workflows against data that behaves like real life.

**1,412 rows.** 20 people, 12 projects across 5 programmes, and the full set of
child records: plans, milestones, RAID, actions, decisions, documents, financials,
cost lines, budget approvals, benefits, status reports, stage gates, recorded RAG
history, resource demand and plan baselines — plus the global configuration tables
that were still empty.

---

## Before you start

**Nothing you already have is deleted or overwritten.**

| What | What happens to it |
|---|---|
| Your 4 people and their logins (RES-0001 to RES-0004) | Untouched |
| Projects PRJ-00001 to PRJ-00005 | Untouched |
| Portfolio PORT-00001 | Filled in — description, budget, owner, sponsor |
| Programmes PRG-00001 to PRG-00005 | Filled in — dates, budgets, sponsors, commentary |

The five programmes and the portfolio were near-empty shells, which is why those
pages looked broken. The seed fills in the blanks using `coalesce`, so anything
you have already typed is kept.

Every row the seed creates is tagged `demoDataSet = "STAGE-14A"`. That tag is how
it can be removed again cleanly.

---

## Load it

There are **six files** to run, in order. They are in the `batches` folder:

```
STAGE-14A-RUN-1-of-6.sql
STAGE-14A-RUN-2-of-6.sql
STAGE-14A-RUN-3-of-6.sql
STAGE-14A-RUN-4-of-6.sql
STAGE-14A-RUN-5-of-6.sql
STAGE-14A-RUN-6-of-6.sql
```

The order matters: people are created before the projects that reference them, and
projects before everything that hangs off them.

### Step by step

1. Go to **https://supabase.com/dashboard** and open your project
   (`qmfigesgkoirirgpgmse`).
2. In the left sidebar click **SQL Editor**.
3. Click **+ New query** (top left of the editor area).
4. Open `batches/STAGE-14A-RUN-1-of-6.sql` in Notepad, select all
   (**Ctrl+A**), copy (**Ctrl+C**).
5. Click into the Supabase query box and paste (**Ctrl+V**).
6. Click **Run** (bottom right, or **Ctrl+Enter**).
7. Wait for **Success**. It may take 10–30 seconds.
8. Repeat steps 3 to 7 for files 2, 3, 4, 5 and 6 **in that order**.

### If a file fails

Nothing is half-applied. Each section inside each file is its own transaction, so
a failure rolls that section back rather than leaving a mess. Send me the error
message and I will fix it.

Re-running a file that already succeeded is harmless — every insert is
`on conflict do nothing`.

---

## Then see it in the tool

1. Open the tool: **https://lolsnaps.github.io/ppm-proof-of-concept/login.html**
2. Sign in as normal, including your authenticator code.
3. **Hard refresh** the page — **Ctrl+F5**. The tool loads the database into the
   browser when a page opens, so it needs one clean load to pick up the new data.

You should now see 17 projects on the Projects page (your 5 plus the 12 new ones),
and the Resources page should list 24 people.

---

## What to test, and where the interesting cases are

The data was built so that the awkward paths have something to exercise them.

**Off-track reporting.** `PRJ-00007 Servicing Data Migration` and
`PRJ-00011 ISA Range Repricing 2027` are Red, each with a stated cause, a
return-to-green plan, and the RAID entries that explain why. `PRJ-00011` has no
route back to Green while its mandatory April date stands — which is the honest
answer for that situation and worth seeing reported properly.

**Cross-project dependencies.** These are real, not decorative:

- `PRJ-00007` blocks `PRJ-00014` (transferred records need the migrated platform)
- `PRJ-00012` blocks `PRJ-00011` (fair value assessments need the measure set)
- `PRJ-00016` unblocked `PRJ-00006` and `PRJ-00009` (both closed, delivered on time)

**Approval workflows with something pending.**

- Budget increase on `PRJ-00010`, `PRJ-00011` and `PRJ-00014` — awaiting decision
- Rebaseline request on `PRJ-00007` — awaiting decision
- The latest status report on every project is in **Draft**, so submit-and-approve
  has something to act on
- Stage gates: passed gates are Approved with decision history; the gate each
  project is currently working towards is Draft or Submitted

**Permissions.** This is the part the people data was designed for. All nine
access roles and all four scopes are represented:

| Person | Role | Scope | Why they are interesting |
|---|---|---|---|
| Rachel Okonjo (RES-0101) | Portfolio Manager / PMO Manager | Portfolio-wide | Sees everything except user administration |
| Priya Raghavan (RES-0103) | Project Manager | Assigned projects | Should see only PRJ-00006, PRJ-00011, PRJ-00015 |
| Greg Sanderson (RES-0106) | Project Manager | Selected projects | Explicitly limited to PRJ-00008 and PRJ-00012 |
| Stephen Nkemelu (RES-0109) | Resource Manager / Team Manager | Team projects | Sees projects only because Technology owns work on them |
| Yvonne Baptiste (RES-0116) | Read-only / Auditor | Selected projects | Should be able to read PRJ-00007, PRJ-00010, PRJ-00013 and change nothing |
| Ian Gallagher (RES-0117) | *(none)* | — | A leaver: deactivated, but still named on historical records |
| Developer (unallocated) (RES-0118) | *(none)* | — | A vacancy: holds demand, can never hold a login |

**None of these people can sign in yet**, and that is deliberate — the database
refuses to attach a login to a person from the application, at any permission
level. To turn one into a real tester:

1. In Supabase: **Authentication → Users → Add user**, with an email and a
   temporary password. Tick *Auto Confirm User*.
2. In the **SQL Editor**, run — as the owner, which the dashboard editor is:

   ```sql
   select public.ppm_link_person_login('their.email@example.com', 'RES-0103');
   ```

3. Give them the temporary password. On first sign-in they will be made to set up
   an authenticator and choose their own password.

Pick someone with a narrow scope — Greg Sanderson (RES-0106) or Yvonne Baptiste
(RES-0116) — because that is where row-level security is actually doing work and
where a mistake would be visible.

---

## Removing it again

Run `STAGE-14A-DEMO-DATA-REMOVE.sql` the same way. It deletes strictly where the
`demoDataSet` tag matches, so it can only remove what the seed created.

Two things it deliberately does not undo:

- **The portfolio and programme detail.** Those rows existed before the seed, and
  the added description and dates are an improvement worth keeping.
- **Audit history.** The audit log is append-only by design. The record of the
  seed having happened is not something the application is allowed to erase.

---

## Notes on how this was built

**The data is generated, not hand-written.** `STAGE-14A-DEMO-BUILD.mjs` reads the
real field map out of `ppm-child-database.js` and derives every normalised column
exactly the way the adapter's own `toColumns()` does. There is one source of truth
for the mapping and it is the application. If the adapter changes, regenerate:

```
node STAGE-14A-DEMO-BUILD.mjs
node STAGE-14A-DEMO-VERIFY.mjs
```

The generator is deterministic — no random numbers, no reading the clock — so
regenerating produces a byte-identical file and any change shows up in a diff.

**Verification.** `STAGE-14A-DEMO-VERIFY.mjs` runs 81,621 checks that SQL parsing
cannot do: every date is a real calendar date, no `undefined` reaches a payload,
approved budgets equal the sum of their cost lines, task dependencies point at
tasks that exist, every RAG override carries a justification, and no statement in
the remove script can reach your real records.

**Two things were found by testing against the live database rather than assuming.**

1. The lifecycle template is `LIFE-00001`, not the identifier I first assumed.
   Every project would have failed to resolve its stages.
2. `manager_id` is derived by a trigger that looks the manager up in
   `public.people`, so it silently stays null whenever a manager is created after
   their report. A probe insert proved it, and the seed now has a second pass that
   fixes the reporting line once everyone exists.

**Stage gates are inserted as Draft and then advanced.** Their insert guard refuses
any gate carrying a decision or history, and that check runs before the workflow
override — so a decided gate genuinely cannot be inserted, not even by the database
owner. Seeding them in two steps is not a workaround; it is the only correct path,
and it exercises the guard rather than going around it.

**Recorded RAG history cannot be edited or deleted**, including by the owner —
its immutability trigger refuses. The remove script switches that trigger off for
exactly one statement and switches it straight back on, inside a transaction.

**The seed shows no actor in the audit trail.** `auth.uid()` is null when SQL runs
from the dashboard rather than the application, which is what lets the seed set
access roles directly. The cost is that audit entries for these rows have no named
person. Changes you make in the tool afterwards will be attributed to you normally.
