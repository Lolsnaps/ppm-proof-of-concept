# Stage 12A — Resource Directory writes

**Build:** `2026.08.08.9` (previous `2026.08.08.8`, Stage 11F)
**Files added:** `STAGE-12A-PEOPLE-WRITES-MIGRATION.sql`, `STAGE-12A-VERIFY.sql`, this document
**Files changed:** `ppm-database.js`, `VERSION`, all 19 pages (cache-bust)

> **Already applied to your database.** Migration and verification run against `qmfigesgkoirirgpgmse` — all 12 checks PASS, and the guard itself was probe-tested (section 4). **The cutover is not done and is deliberately left to you** — see section 2, because this is the one collection where your local edits might be newer than the database.

---

## 1. Two decisions I made without you

The question dialog dropped out, so I took the options I was recommending. Both are reversible; say the word.

**Directory visibility:** anyone with portfolio-wide access sees every person, using the existing `private.has_portfolio_wide_access()`. Scoped roles — Project Manager, Resource Manager, team members — keep exactly the team-and-project visibility they have today.

**Self-edit:** the server refuses any change to your *own* access-control fields. Another administrator must do it. Your own profile fields stay editable. This matches the segregation-of-duties rule the app already applies to stage gates, baselines and budgets. Escape hatch if you are the only administrator: section 6.

---

## 2. Finishing it — you drive this bit

Unlike Stage 12, your local resource data may be **newer** than the database. `public.people` was imported at Stage 2 and you have been editing the directory locally ever since, so the database copy could be stale. Cutting over replaces local with database, so the direction matters.

Load this build, sign in with TOTP, then in the console (`F12`):

```javascript
await PPMDatabase.compare("people")
```

Read the verdict:

- **`IDENTICAL`** — go straight to the cutover below.
- **Field differences, or records only in localStorage** — the local copy is ahead. Push it first:

```javascript
await PPMDatabase.saveRecords("people", PPMAuth.getResources())
await PPMDatabase.compare("people")          // expect IDENTICAL now
```

Then cut over and reload:

```javascript
await PPMDatabase.cutOver("people")
```

`cutOver` refuses on a mismatch rather than warning, so it cannot quietly overwrite you. It only proceeds on `IDENTICAL` unless you explicitly pass `{ force: true }`, which you should not need.

**One thing that may bite during the push.** If your own row's access fields differ between local and database — role, scope, account status, permission overrides — `saveRecords` will refuse that single row, because of the self-edit rule. That is the rule working, not a bug. Either accept the database value for your own row, or use the SQL in section 6.

Then confirm:

```javascript
await PPMDatabase.compare("people")     // IDENTICAL
PPMDatabase.pendingWrites()             // empty
await PPMDatabase.auditReport()          // people changes now appear here
```

Open the **Resource Directory**, check all five people are listed, edit a job title, reload, and confirm it persisted.

---

## 3. Four things the live database revealed that the files could not

### 3.1 Three of your five people would have vanished on cutover

`private.can_access_person()` granted visibility if the target was you, shared your team, or led a project you can access. **There was no portfolio-wide branch** — so not even a System Administrator saw the whole directory.

Evaluated against your actual data, from your own account (Alex Kain, team PMO, portfolio-wide):

| Resource | Name | Team | Under the old rule |
| --- | --- | --- | --- |
| RES-0001 | Alex Kain | PMO | visible — is you |
| RES-0002 | Liz Michel | Executive Committee | visible — leads a project |
| RES-0003 | Peter Rhodes | *(none)* | **would have vanished** |
| RES-0004 | Titan Livery | Business Solutions | **would have vanished** |
| RES-0005 | Steve A | *(none)* | **would have vanished** |

That is 60% of the directory. And the damage would not have stopped at display: hydration replaces the whole local array with what the reader can see, so the next save would write back a two-person directory. Worse, `nextResourceId()` takes `max(RES-nnn)` of the *visible* list, so the next person created would have been issued `RES-0003` again — colliding with the unique constraint at best, and at worst attaching a new person to an existing one's history.

This is exactly why this collection was never a candidate for fast cutover.

### 3.2 `public.people` had no `version` column

No optimistic locking. Two administrators editing the directory would have overwritten each other silently, with no conflict raised — on the table that holds roles and permissions. Added, with the same trigger every other table uses.

### 3.3 `public.people` had no audit trigger, and `audit_log` held zero entries for it

Role changes, scope changes and account suspensions — the most security-significant edits in the whole application — **were not being recorded at all**.

`private.record_audit()` could not simply be pointed at the table: it resolved the business key with an `if/elsif` chain whose `else` branch assumed `portfolio_code`, so it would have errored on people. Rewritten with an explicit branch per table and a safe fallback; projects, programmes and portfolios behave exactly as before.

### 3.4 `supabaseUserId` would have been written into `legacy_payload`

`mapPerson` derives it from `auth_user_id`. It was excluded from the parity comparison but not from `payloadOf`, so the moment people became writable, a copy of the identity link would have been persisted inside a JSON blob — right next to the one column the database guards most carefully. Now stripped; it is re-derived on every read, so nothing needed it stored.

---

## 4. The guard, and proof it works

`private.guard_person_identity()` enforces three separate rules. The application already hides these fields unless `PPMAuth.can("users.manage")`, but that is a UX control — this is the boundary.

| Rule | Why |
| --- | --- |
| `auth_user_id` is **never** writable from the browser, at any permission level | It decides which login a person *is*. Linking an account stays an administrative act performed outside the application. |
| `legacy_resource_id` is immutable once set | Every denormalised owner name and email in projects, plans and RAID is joined on it. Changing it would orphan that data silently. |
| Access-control fields need `users.manage`, and cannot be changed on your own row | Granting yourself permissions is the same shape of problem as approving your own budget, which the app already refuses. |

`active` counts as access-significant only when the person actually has a login or an access role — deactivating a generic placeholder is ordinary directory maintenance, deactivating a user account is not.

**Probed against the live database, not assumed.** Seven attempts, all behaving correctly:

| Attempt | Result |
| --- | --- |
| Attach a login (`auth_user_id`) from the app | refused |
| Change `legacy_resource_id` | refused, naming both values |
| Grant `access_role` without `users.manage` | refused |
| Set `permission_overrides` without `users.manage` | refused |
| Unlink the one live login | refused |
| Update with a stale version | refused as a conflict |
| Ordinary profile edit | allowed, version 1 → 2, audit entry written |

The probe edited one job title and put it back, so `RES-0002` now sits at version 3 with two audit entries. That is real history of a real change and I have left it rather than tidying it away.

The self-edit rule is the one thing I could not probe from a SQL connection, because it needs an authenticated session. Worth confirming in the UI: try changing your own access role and expect a refusal.

---

## 5. What this migration deliberately does not do

**It does not create or manage Supabase Auth users.** Provisioning a login needs the Admin API and a server-held secret, and no secret goes near the browser. Creating a person row and linking it to a login are now two separate acts: the app does the first, and the second happens in the Supabase dashboard, or through Entra later. This is the constraint your handover set and it still holds.

**It does not grant DELETE.** Removal is `active` / `account_status`, consistent with every other table.

**It does not tighten `resource_absence`.** That was left permission-scoped in Stage 12 pending a server-side person link. The link exists now, so absence can move to person-and-team scope — a small follow-up rather than part of this.

---

## 6. If you lock yourself out

The self-edit rule means you cannot restore your own access from the tool. As the only administrator, use the Supabase SQL editor:

```sql
update public.people
   set account_status = 'Active', active = true
 where auth_user_id = '<your auth.users id>';
```

That runs as the table owner and bypasses both the policy and the guard, which is precisely why it is the documented escape hatch rather than something the application can do. Or ask me — I have direct access to the project.

---

## 7. Tests

**Live database:** 12 verification checks PASS, including three explicitly covering the login path (linked account readable, own-record policy intact, `auth_user_id` still unique and FK-bound). Plus the 7 guard probes above.

**Static:** all 40 JS files parse; all 19 pages stamped `2026.08.08.9`; no server secret in any browser source; both SQL files parse; all 24 migrations pass `STAGE-SQL-LINT.py`.

**Harness:** 79 assertions still passing — the foundation-writer change did not disturb the child adapter.

---

## 8. What's left

With people writable, **every business store is database-backed.** The remaining work is no longer migration:

1. **Stage 12F — backup/restore.** `ppm-data-safety.js` was written when localStorage *was* the database. A restored old browser backup must not be able to overwrite newer database state through write-through. This is now the largest remaining risk.
2. **Stage 13 — production.** Entra, hosting/TLS, CSP, monitoring. Also worth revisiting leaked-password protection in Auth settings.
3. **Stage 14 — cleanup.** Retire the local `PPMAudit.record()` write path, the shadow-mode machinery and the source switches; update `TECHNICAL-SPECIFICATION.html`, which still documents the original localStorage architecture.

Smaller carried-over items: tighten `resource_absence` to person/team scope (now unblocked), close the dormant foundation `writeGlobal` seam gap, and the optimistic-lock conflict message reads "This people was changed by someone else" — a shared string that could use a per-table label.
