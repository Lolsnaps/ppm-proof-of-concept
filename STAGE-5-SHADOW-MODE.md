# Stage 5 — Shadow mode and wider people visibility

**Completed:** 7 August 2026
**Rollback copy:** `PPM Tool 28 - pre-5-backup`

---

## Why Stage 5 is not what the plan said

The handoff says Stage 5 moves reads to the database, module by module, with
writes following in Stage 6. Checking the code before starting showed that split
cannot be done safely.

Projects are read in about 30 places across 25 files — but they are also
**written** in six places, all still saving to localStorage:
`index-page.js`, `add-project-page.js`, `programme-page.js`,
`resource-directory-page.js` and `ppm-admin-utils.js` (twice).

The database is still read-only. So pointing reads at it now would mean:

- you edit a project, the write lands in localStorage, the page re-reads from the
  database, and **your edit vanishes from view**;
- and anything that refreshed localStorage from the database would **overwrite
  that edit permanently**.

There is a second problem. Several reads are synchronous at module top level —
`home-page.js` line 16 is a top-level `const` — and the handoff explicitly warns
against making the page bootstrap async without auditing every page.

**Reads and writes for a collection have to move together.** So Stage 5 does the
part that carries no risk: prove the database matches reality under real use, and
remove the blocker that would otherwise stall Resources.

---

## What shadow mode is

A third setting per collection, alongside `local` and `database`.

In shadow mode the page reads localStorage and renders **exactly as it does
today**. In the background, the same collection is fetched from the database and
compared, and any divergence is recorded.

It is a measurement, not a switch. Nothing it does can change what you see, and
no failure inside it can reach page code.

The value is that it runs during **real use, on real pages, over time**. A one-off
`compare()` tells you the database matches right now. Shadow mode catches the
case that actually matters: a collection that agrees on Monday and quietly drifts
on Tuesday because somebody edited something.

### Using it

```javascript
// Watch one collection, or all of them
PPMDatabase.useShadowFor("projects")
PPMDatabase.shadowEverything()

// Then just use the tool normally for a few days.

// See what it found — across every page and visit
PPMDatabase.divergenceReport()

// Stop watching / start again
PPMDatabase.useLocalForEverything()
PPMDatabase.clearDivergenceLog()
```

Two things are recorded, for two different questions:

- **`lastCheck`** — one row per collection, overwritten each time.
  *Does the database agree right now?*
- **`issues`** — an append-only trail capped at the 50 most recent entries,
  stamped with the page and time.
  *Has it ever disagreed, and where?*

Both are excluded from backups: they describe one browser's state and would be
meaningless restored elsewhere.

### What to expect

If everything is healthy you will see one line per page load:

```
PPMDatabase shadow [projects] on index.html: database and localStorage agree (3 record(s)).
```

If something drifts you get a grouped, expandable report naming the records and
fields — and it is written to the log so you do not have to be watching.

---

## The other half: people visibility widened

Until now the browser could read exactly one `people` row — its own. That was
right while only login needed it, but it blocked the Resources module and stopped
the adapter turning a project's `project_manager_id` into a name.

A **second permissive policy** was added. Permissive policies are ORed, so the
existing own-record read still stands on its own and signing in cannot break —
which matters because **Executive / Steering User does not hold `resources.view`**
and must still read itself.

A user holding `resources.view` may now additionally read a person who is:

- on the same team, or
- named on a project that user can already access.

Because it reuses `can_access_project`, people visibility can never exceed project
visibility.

### A pre-existing hole closed at the same time

Testing turned up something Stage 3C left behind: the own-record policy checked
only `auth_user_id`, so a **suspended or deactivated account could still read its
own row** through the API. It now also requires the account to be usable.

Login refused a suspended account either way. The difference is that the refusal
no longer confirms the account exists in a particular state — the message changes
from "This PPM account is not currently enabled for access" to "This login is not
linked to an authorised PPM Resource account".

### Live result on your database

Signed in as your administrator, `people` now returns **2 rows** instead of 1:
yourself, and Liz Michel — who is the sponsor on PRJ-00001, so you share a
project. Peter Rhodes, Titan Livery and Steve A stay hidden: not on your team,
not named on any project. Exactly the intended behaviour.

---

## Verification

**Shadow mode: 25 of 25 tests passed.** The ones that matter most:

- shadow returns the localStorage records **byte-identical** to what is stored —
  no database marker, no injected `databaseId`
- when the database and localStorage disagree, the page still renders the
  **local** value
- a missing record and a changed field are both detected and logged
- the trail accumulates across pages and visits, stamped with the page name
- a **broken database does not disturb the page** — the failure is recorded, not
  thrown
- the check runs **once per page load** however many times a page reads
- `local` mode runs no check at all, and defaults are untouched

**People RLS: 15 of 15 tests passed** against a local PostgreSQL with all nine
roles, before anything was applied to your database:

- Executive without `resources.view` can still read its own row — **login works**
- a team manager sees their own team and no other
- an auditor scoped to one project with no named people sees only themselves
- a suspended account now sees nothing at all
- AAL1 still reveals nothing
- writes to `people` still refused
- projects and programmes unaffected
- applying the migration twice changes nothing

**Regressions all still green:** all 19 pages load clean, the Stage 4 adapter
suite is 45/45, the backup suite is 21/21, every JS file parses.

**Security advisor:** only the Auth "leaked password protection" notice remains.
That feature is Pro Plan and above, so it cannot be enabled on this project and is
not an outstanding action. MFA is required for every sign-in, read and write,
which covers the same risk more strongly.

---

## What to do now

1. Hard-refresh (**Ctrl+F5**) and sign in.
2. In the console (**F12**), run:

   ```javascript
   PPMDatabase.shadowEverything()
   ```

3. **Use the tool normally for a few days.** Open projects, edit something,
   run a report, add a resource.
4. Then run:

   ```javascript
   PPMDatabase.divergenceReport()
   ```

What you find decides Stage 6:

- **Everything agrees** — the database is a faithful mirror, and the cutover can
  be planned with confidence.
- **Projects drift after you edit them** — expected, and it is the proof that
  reads and writes must move together. It also measures exactly how far apart
  they get.
- **Something diverges you cannot explain** — worth investigating before any
  cutover.

---

## What Stage 6 will need

Now clearly scoped by what this stage found:

1. **Write policies and grants** for `projects` — INSERT/UPDATE/DELETE gated on
   `projects.edit` / `projects.create` / `projects.archive` via
   `private.has_permission`, which already exists and is tested.
2. **Optimistic locking** on `projects.version`, which the adapter already
   carries on every record.
3. **A write path in the adapter**, mirroring the read mapper in reverse.
4. **Hydrate-before-boot**: one async step at page start that loads database
   records into the existing store, so all ~30 synchronous read sites keep
   working untouched. Only safe once writes also go to the database — which is
   why it belongs in Stage 6, not here.
5. **Then** flip projects to `database` mode and retire the localStorage copy.

Resources is no longer blocked, but should follow projects rather than lead it.

---

## Not in this stage

- No module was switched to database reads. That is the Stage 6 cutover.
- No writes were granted. The browser still has SELECT only.
- No page behaviour changed. Shadow mode is off by default; every collection
  still starts on `local`.
