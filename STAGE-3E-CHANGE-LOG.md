# Stage 3E — Legacy credential removal

**Completed:** 7 August 2026
**Version stamp:** `2026.08.07.8`
**Rollback copy:** `PPM Tool 28 - pre-3E-backup` (sibling folder — delete once you are happy)

Stage 3E removed the browser's own password system. Sign-in is now Supabase Auth
password check → TOTP factor → AAL2 session, and nothing in the browser verifies,
stores or hashes a password.

Scope was kept deliberately narrow. No framework, bundler or build step was added,
no business module was migrated to the database, the compatibility session was kept,
and the 9 roles / 47 permission strings are untouched.

---

## 1. Caller inventory (found before editing)

The whole folder was searched for every legacy credential symbol and for
human-facing password wording. Everything found:

| File | What it was doing |
|---|---|
| `ppm-auth-utils.js` | The credential subsystem itself: `CREDENTIAL_KEY`, `getCredentials`, `saveCredentials`, `passwordHash` (PBKDF2), `passwordProblems`, `setPassword`, `hasCredential`, the old `login()`, lockout constants, `mustChangePassword` |
| `resource-directory-page.js` | Called `hasCredential`, `passwordProblems`, `setPassword`; read the temporary-password fields |
| `resource-directory.html` | "Set or reset temporary password" form block |
| `resource-directory-page.css` | `.password-grid` layout for that block |
| `ppm-data-safety.js` | `SENSITIVE_KEYS` put `ppmAuthCredentials` into every backup |
| `administration-page.js` | Backup summary label "Passwords (hashed)" |
| `administration.html` | Backup warning claiming the file contains password hashes |
| `README-ACCESS.txt` | Getting-started steps about temporary passwords |
| `TECHNICAL-SPECIFICATION.html` | Historic architecture document — **left unchanged on purpose**, it describes the original design |

Nothing referenced `PPMAuth.login` — the Stage 3D login page had already stopped
calling it, which is why removal was safe.

---

## 2. Security fix found during the scan

Four protected pages did **not** load the Supabase scripts:

`home.html`, `administration.html`, `audit-history.html`, `project-details.html`

`PPMAuth.logout()` only signs out of Supabase if `window.PPMSupabase` exists. From
any of those four pages, the header Sign out button would have cleared the
compatibility session while leaving the real Supabase session alive in
`sessionStorage` — the exact gap flagged in Appendix C of the handoff.

Both scripts were added to all four, in the same synchronous position the working
pages already use (immediately before `ppm-core.js`). No `defer`, `async` or
`type="module"` was introduced, so the load-order guarantee that `requireAuth()`
runs before page scripts is unchanged.

All 19 application pages now load the Supabase client.

---

## 3. Changes by file

### `ppm-auth-utils.js`

Removed: `CREDENTIAL_KEY`, `getCredentials()`, `saveCredentials()`, `passwordHash()`
(PBKDF2), `passwordProblems()`, `setPassword()`, `hasCredential()`, the old
`login(email, password)`, `base64ToBytes()`, and the `LOCK_MINUTES`,
`MAX_FAILURES`, `HASH_ITERATIONS` constants.

Kept: `randomToken()` and `bytesToBase64()` — still used for the compatibility
session ID. `SESSION_HOURS` and `IDLE_MINUTES` — these govern compatibility session
lifetime, not passwords.

Added: `removeRetiredCredentialStore()`, an idempotent one-time cleanup that deletes
`localStorage.ppmAuthCredentials` on load. It runs before `requireAuth()` and does
nothing once the key is gone.

`window.PPMAuth` no longer exports `passwordProblems`, `setPassword`,
`hasCredential` or `login`. No compatibility stubs were left — they are gone
entirely, so any missed caller fails loudly rather than silently.

### `resource-directory.html` / `resource-directory-page.js` / `.css`

The temporary-password inputs, their validation, the `setPassword` call and its
rollback path were removed, along with the now-unused `.password-grid` styles.

In their place the access section carries a short read-only note explaining that
sign-in accounts are provisioned in Supabase Auth and linked to the Resource
record, and that MFA is required.

The "Active user accounts" tile no longer checks for a local credential — it counts
Resources that are active, have an access role and have login status Active.

Role, scope, project access and permission override editing are unchanged.

### `ppm-data-safety.js`

`SENSITIVE_KEYS` became `RETIRED_CREDENTIAL_KEYS`, and it now filters rather than
includes:

- new backups exclude `ppmAuthCredentials` entirely;
- `containsCredentials` is always `false`, kept only for format-1 reader compatibility;
- restore drops the key from old backups instead of writing it, and deletes any
  local copy afterwards;
- the restore preview hides the key so it cannot look like it will be restored;
- the restored-count now reflects what was actually written.

Backup format stays at **1**, so existing backup files still validate and restore.

Historic audit entries mentioning password changes or lockouts are preserved —
they are evidence, not active credentials.

### `administration.html`, `administration-page.js`, `README-ACCESS.txt`

User-facing copy that implied the PPM manages passwords was replaced with wording
about Supabase Auth and required MFA.

`TECHNICAL-SPECIFICATION.html` was deliberately not edited.

---

## 4. Verification performed

**Static scan** — the whole folder was re-searched for every symbol in the Stage 3E
list. Zero live-code references remain. The only surviving mentions are explanatory
comments and the retired-key constant used by the cleanup.

**Syntax** — every JavaScript file in the folder parses.

**Secret key** — no `service_role` / `sb_secret` value anywhere in browser code.
`ppm-supabase.js` still holds only the publishable key.

**Headless page load** — all 19 pages were loaded in a simulated browser, pre-seeded
with a signed-in System Administrator compatibility session *and* a leftover
`ppmAuthCredentials` store. Every page loaded without console errors, the credential
store was removed on every page, and the four removed APIs were absent everywhere.

**Functional tests — 21/21 passed:**

- credential store removed from localStorage on load
- new backup contains no `ppmAuthCredentials` key
- new backup reports `containsCredentials: false`
- backup format still 1
- no salt / hash / iterations / failedAttempts / lockedUntil / mustChangePassword
  material anywhere in a new backup file
- business data still backed up correctly
- historic password/lockout audit entries preserved
- a pre-3E backup still validates (backward compatible)
- restore preview hides the credential key
- restoring a pre-3E backup does **not** recreate credentials
- restore still brings back business data
- exactly 47 permissions and exactly 9 roles
- `can("projects.edit")` and `can("users.manage")` still true for an administrator
- compatibility session preserved
- `PPMAuth.setPassword` / `hasCredential` / `passwordProblems` / `login` all undefined

---

## 5. What you still need to test in a real browser

The headless tests cannot verify Supabase itself. Run through the handoff's
acceptance tests at `http://localhost:8000`, and in particular:

1. **Sign out from `home.html`** — this is the page that was broken. After clicking
   Sign out, run `(await PPMSupabase.auth.getSession()).data.session` in the console.
   It must be `null`. Then repeat from `administration.html`, `audit-history.html`
   and `project-details.html`.
2. **Login regression** — wrong password stays on login; wrong TOTP stays on MFA;
   correct both reaches Home.
3. **RLS unchanged** — at AAL1 a `projects` select returns nothing; at AAL2 the
   portfolio-wide admin sees all three projects; a browser `update` still returns 403.
4. **Resource Directory** — open a Resource, confirm the password fields are gone,
   change a role or scope and confirm it still saves and still writes an audit entry.
5. **Backup** — download a fresh backup and search the file for `ppmAuthCredentials`,
   `salt` and `hash`. All three should be absent.

Hard-refresh once with **Ctrl+F5** first — the version stamp was bumped to
`2026.08.07.8`, but a stale cached file would confuse the results.

---

## 6. Deliberately left for later stages

Unchanged, as the handoff requires:

- the compatibility `ppmAuthSession` / `ppmCurrentUser` session
- `requireAuth()` remaining synchronous
- browser writes to the database still denied wholesale
- the full 47-permission server-side RBAC
- database-backed Resources CRUD and secure in-app user provisioning
  (needs a server/Edge Function — no admin secret was put in the client)
- MFA enrolment and password-reset UX
- migration of remaining localStorage business modules

### Known limitation still true after Stage 3E

Editing a Resource in the Resource Directory writes to local `ppmResources` only.
It does **not** update `public.people`, which is what the new login and RLS actually
read. During this stage, access-role and scope changes that need to affect real
sign-in must be made in Supabase directly.
