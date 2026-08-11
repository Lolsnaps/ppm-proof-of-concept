# Stage 3F — Server-side role permissions

**Prepared:** 7 August 2026
**Status: APPLIED AND VERIFIED against the live database on 7 August 2026.**

Stage 3F puts your 9 roles and 47 permissions **into the database**, so the server
can enforce them instead of trusting the browser. It also fixes a scope bug that
would have caused real problems at Stage 5.

**No application files changed.** Everything in this stage is SQL. Your app keeps
running exactly as it does now — you do not need to re-test the whole tool.

The migration was run in pieces because the Supabase SQL Editor would not accept
the whole script at once. **This was checked and it made no difference** — see
"Live verification" below. The instructions in the next section are kept as the
record of how it was applied, and because the script is safe to re-run.

---

## What you need to do

*(Already done — kept for reference and for re-running if needed.)*

You are running two SQL scripts in Supabase. It takes about five minutes.

### Step 1 — Open the Supabase SQL Editor

1. Go to **https://supabase.com/dashboard** and sign in.
2. Click your project (**qmfigesgkoirirgpgmse**).
3. In the left-hand sidebar, click **SQL Editor** (the icon looks like a database
   with a magnifying glass).
4. Click **+ New query** at the top.

### Step 2 — Run the migration

1. Open **`STAGE-3F-MIGRATION.sql`** from your PPM Tool 28 folder in Notepad
   (right-click the file → Open with → Notepad).
2. Select all of it (**Ctrl+A**), copy (**Ctrl+C**).
3. Click into the big empty box in the Supabase SQL Editor and paste (**Ctrl+V**).
4. Click the green **Run** button, bottom right. (Or press **Ctrl+Enter**.)

It should finish in a second or two.

### Step 3 — Check the results

Underneath the editor you will see the output. Scroll to the table with a
**result** column. **Every row must say PASS:**

| check | expected |
|---|---|
| permission count | 47 |
| role count | 9 |
| role-permission grants | 240 |
| System Administrator has all 47 | 47 |
| only System Administrator has users.manage | 1 |
| people rows with an unknown access_role | 0 |
| people rows with an unknown access_scope | 0 |
| restrictive view policies installed | 3 |

Below that is a second table listing your nine roles with their permission counts
(47, 46, 29, 34, 20, 16, 14, 16, 18).

**If anything says FAIL, stop and tell me what it says.** Do not carry on.

The two most likely failures are the `access_role` / `access_scope` ones. They
would mean a person record in the database has a role or scope spelled
differently from the application's list — easy to fix, but it must be fixed
before the server permissions can be trusted.

### Step 4 — Check the app still works

1. Go to `http://localhost:8000/login.html` and sign in as normal.
2. You should reach Home exactly as before.
3. Open the browser console (**F12**) and run:

   ```javascript
   (await PPMSupabase.from("projects").select("project_code, name")).data
   ```

   Your System Administrator account should still see all three projects.

That is all that is required. Nothing else in the app should behave differently
for you, because your account is a System Administrator with every permission.

### If you need to undo it

Run **`STAGE-3F-ROLLBACK.sql`** the same way. It puts the database back exactly
as Stage 3C left it. Sign-in and reads keep working throughout.

---

## What the migration actually does

### 1. The permission model now lives in the database

Three new tables in the `private` schema — which is **not** exposed through the
Data API, so the browser cannot read or tamper with them:

- `private.permissions` — the 47 permission strings
- `private.roles` — the 9 roles, their descriptions and default scopes
- `private.role_permissions` — the 240 grants saying which role gets which permission

These were **generated directly from `ROLE_DEFINITIONS` in `ppm-auth-utils.js`**,
not retyped, so they cannot drift from your application by transcription error.

### 2. `private.has_permission()` — the server's version of `can()`

It follows exactly the same rules your browser code does:

| Situation | Result |
|---|---|
| `permission_overrides` says `"allow"` | permitted, whatever the role says |
| `permission_overrides` says `"deny"` | refused, whatever the role says |
| otherwise | whatever the role grants |
| person inactive, suspended, or not linked to an auth user | no permissions at all |

There is also `private.effective_permissions()`, which lists everything the
signed-in person may do. That is the natural thing to hand to the browser in a
later stage so the UI stops relying on its hardcoded copy.

### 3. The access-scope bug is fixed

This is the important part.

Your application has four access scopes. The old database helper understood only
two of them:

| Scope | Old database behaviour | New database behaviour |
|---|---|---|
| Portfolio-wide | every project ✓ | every project ✓ |
| Selected projects | the listed codes ✓ | the listed codes ✓ |
| **Assigned projects** | **nothing** ✗ | projects where the person is named |
| **Team projects** | **nothing** ✗ | projects led by someone on their team |

"Assigned projects" is the **default scope for Project Manager, Project Sponsor
and Project Team Member** — three of your nine roles. Any of them with an empty
`selected_project_codes` would have got **zero rows** from the database while the
legacy UI still showed them their work. Harmless today because reads still come
from localStorage, but at Stage 5 it would have looked like catastrophic data loss.

Being named on a project is read from both the normalised columns
(`project_manager_id`, `sponsor_id`, `project_lead_id`) **and** the original
`legacy_payload`, because only three of the eight role fields were normalised
during the Stage 2B import. Deputy PM, business analyst, technical lead, benefit
owner and financial owner are still only in `legacy_payload`, and they now count.

### 4. Role permissions are now enforced on reads

Three new restrictive policies were added, meaning "…and your role actually grants
the matching view permission":

- reading `projects` now requires `projects.view`
- reading `programmes` now requires `programmes.view`
- reading `portfolios` now requires `portfolios.view`

All nine roles hold `projects.view` and `portfolios.view`, so those change nothing
today.

**`programmes.view` is the one real behaviour change.** Two roles do not have it —
**Resource Manager / Team Manager** and **Project Team Member**. From now on the
database refuses them programme rows. That matches what your navigation already
does: those roles never see the Programmes page. Now the server enforces it too.

`public.people` is deliberately **not** gated on `resources.view`. Signing in
requires reading your own people row, and **Executive / Steering User** does not
hold `resources.view` — gating it would have locked that role out of the
application entirely.

---

## What this stage did NOT do

- **No write access was granted.** Browser `INSERT` / `UPDATE` / `DELETE` are still
  revoked wholesale, exactly as Stage 3C left them. Write policies come at Stage 6.
- **No application file changed.** The browser still uses its own `ROLE_DEFINITIONS`
  for the UI. The database now has its own authoritative copy for enforcement.
- **No secure admin path yet.** Changing someone's role or scope still means editing
  `public.people` by hand in Supabase. Doing it from the app needs an Edge Function
  with a `users.manage` check — deliberately left for later rather than putting an
  admin key in the browser.

---

## Verification I ran before giving you this

The migration was applied to a real PostgreSQL 16 database loaded with your table
structures, the Stage 3C baseline from the handoff, and seven test people covering
every role and scope combination.

**36 of 36 behaviour tests passed**, including:

- AAL1 still reveals nothing; AAL2 portfolio-wide admin sees all three projects
- a Project Manager on "Assigned projects" with no selected codes now sees her own
  project — **the bug this stage fixes**
- a team manager reaches a project their team leads, but is **not** widened by a
  teammate merely being a business analyst elsewhere
- an auditor on "Selected projects" sees only the listed code
- a person named only in `legacy_payload` still reaches their project
- Resource Manager and Project Team Member are refused programme rows
- Executive can still read their own people row, so login works
- a suspended account gets nothing at all
- `"allow"` and `"deny"` overrides behave exactly as the browser's `can()` does
- `UPDATE` and `INSERT` on projects are still refused
- the browser role cannot read the new `private` tables

**Re-runnable:** applied three times in a row with identical results, and all 36
tests still passed afterwards.

**Reversible:** the rollback restores the Stage 3C state exactly, and the migration
re-applies cleanly afterwards.

---

## One judgement call worth knowing about

For "Team projects", your browser code works out the team's projects from
`ppmResourceDemand` and plan task owners. Neither of those is in the database yet,
so the server cannot mirror it exactly.

I used a narrower stand-in: a team manager reaches projects **led** by someone on
their team (project manager, sponsor or project lead). I chose narrow over wide
deliberately — if the server is too narrow, a team manager notices a missing row at
Stage 5 and it gets fixed; if it were too wide, they would silently gain access to
rows the UI never shows them. This should be revisited when the resource-demand and
plan modules migrate.

---

## Live verification (run against your real database)

Because the script had to be split into pieces, the result was checked directly
against the live database rather than assumed. Splitting SQL is exactly how a
keyword like `as restrictive` gets lost, so this mattered.

**Content matches your code exactly.** The 47 permissions, the 9 roles with their
default scopes, and all 240 role-permission grants were hashed on both sides and
compared:

| | MD5 |
|---|---|
| 240 grants | `9ec4c6fdd98c0b108d81cec2a8c99c8e` — identical |
| 47 permissions | `b5961e92e2a2c143cdaf42730fbc41f5` — identical |
| 9 roles + scopes | `94c7c2bc5980536eb13de4bf73afcdfe` — identical |

Nothing was dropped or duplicated by running the script in stages.

**Structure is correct:**

- all three new view-permission policies are **RESTRICTIVE**, not permissive —
  this is the one that would have silently widened access if it had gone wrong
- the AAL2 policies and original scope policies are all still in place
- `can_access_project` is the new four-scope version, not the old two-scope one
- all four helper functions exist with EXECUTE granted to `authenticated`
- `authenticated` **cannot** read `private.permissions`, `private.roles` or
  `private.role_permissions`
- `anon` has no access to any table
- `authenticated` still has **SELECT only** on all four tables — INSERT, UPDATE
  and DELETE remain revoked

**Behaviour, tested while impersonating your real signed-in account:**

| Test | Result |
|---|---|
| AAL2: projects visible | 3 ✓ |
| AAL2: programmes visible | 5 ✓ |
| AAL2: portfolios visible | 1 ✓ |
| AAL2: own people row visible (login works) | 1 ✓ |
| effective permissions | 47 ✓ |
| `has_permission('users.manage')` | true ✓ |
| `can_access_project('PRJ-00001')` | true ✓ |
| **AAL1: projects / programmes / portfolios / people** | **0, 0, 0, 0 ✓** |

---

## Also fixed: a pre-existing security warning

Supabase's security advisor flagged something that predates Stage 3F.

`public.rls_auto_enable()` is your safety net — an event trigger function that
automatically switches RLS on for any new table created in `public`. Useful, and
worth keeping. But it sat in the exposed `public` schema with EXECUTE granted to
`authenticated`, which made it callable over the REST API at
`/rest/v1/rpc/rls_auto_enable`.

EXECUTE was revoked from `public`, `anon` and `authenticated`.

Event triggers fire as the trigger owner and do not consult EXECUTE grants, so the
safety net is unaffected — and this was **proved, not assumed**: a throwaway table
was created afterwards, RLS was confirmed to have been switched on automatically,
and the table was dropped again.

The advisor now reports this issue as resolved.

### One advisor warning that cannot be actioned — and does not need to be

**Leaked password protection is disabled**, and the advisor will keep saying so.
It checks new passwords against HaveIBeenPwned, and Supabase's own documentation
states it is **available on the Pro Plan and above**. On the Free plan the toggle
is not available, so this warning cannot be cleared. It should be treated as
noise rather than an outstanding action.

The compensating control is stronger than the warning anyway: this application
requires a verified TOTP factor and refuses to complete a sign-in below AAL2, and
the database refuses to return a single row — or accept a single write — without
it. A leaked password on its own does not get anyone in.

Worth revisiting only if the project moves to a paid plan.

---

## Housekeeping spotted in your people data

Not errors, but worth knowing before Stage 5:

- **Liz Michel (RES-0002)** has the *Executive / Steering User* role and
  Portfolio-wide scope, but is **not linked to a Supabase Auth user**, so she
  cannot sign in yet. Note this is the exact role that does not hold
  `resources.view` — the reason `public.people` was deliberately left ungated.
  Had it been gated, she would have been locked out the moment she was linked.
- **Peter Rhodes (RES-0003), Titan Livery (RES-0004), Steve A (RES-0005)** have no
  access role and no account status. They are directory-only resources and cannot
  sign in. That is correct if they are not meant to have logins.
- Only **RES-0001 (you)** is currently linked to an auth user.

---

## Suggested next step

Stage 4 in your handoff: introduce `ppm-database.js`, an async adapter, before any
module reads move. That is application work rather than SQL.

The Supabase connector is now attached, so future migrations can be applied and
verified directly against the database rather than pasted in by hand — which also
avoids the size limit that forced this one to be split.
