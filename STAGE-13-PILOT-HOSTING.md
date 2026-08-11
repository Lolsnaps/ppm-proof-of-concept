# Stage 13 — Pilot hosting on GitHub Pages

**Build:** `2026.08.08.13` (previous `2026.08.08.12`, Stage 12F)
**Files added:** `.nojekyll`, `.gitignore`, `404.html`, `README.md`, this document
**Files changed:** all 19 application pages (CSP + referrer meta, cache-bust), `VERSION`

> **No database changes and no SQL to run.**

---

## Why Stage 13 changed shape

The original plan was Entra integration plus production hosting. Entra is a production identity story and you need colleagues clicking around a working tool. Email + password + TOTP already gives you server-enforced multi-factor authentication, so it is sufficient for a pilot — Entra is deferred, not skipped.

---

## What I checked before recommending this

GitHub Pages differs from your local `py -m http.server` in two ways that break applications, so I checked both against the actual files rather than assuming:

| Risk | Finding |
| --- | --- |
| Project sites serve from a **sub-path** (`user.github.io/repo/`), so any absolute path like `/login.html` 404s | **No absolute paths anywhere.** Every `href`, `src` and redirect is relative |
| Pages is **case-sensitive**; Windows is not, so `Index.html` works locally and fails live | **No case mismatches.** Every reference matches its file exactly |
| The sub-path root has no filename, so page-name logic can break | `currentPage()` already falls back to `index.html` |
| Real portfolio data committed by accident | No backup or dump files present; `.gitignore` now blocks them |
| A server secret in a public repo | Publishable key only, confirmed across every source file |

So this was a packaging job rather than a rewrite. That is a good sign about the architecture, not luck: keeping everything relative is what made it portable.

### Is a public repo safe?

Yes, and this is worth being precise about rather than reassuring. Verified against the live database:

- **37 of 37** public tables have RLS enabled
- **37** have a restrictive policy requiring AAL2
- **`anon` can reach 0 tables and call 0 functions**

So a stranger who finds the URL can read your HTML, your JavaScript and your publishable key — which is what a publishable key is for — and get **no data**. They cannot sign in without an account, a password, a TOTP secret, and a `people` row linked to that account.

---

## Publishing it — do this once

### 1. Create the repository

On GitHub: **New repository**, public, no README (there is one here already).

### 2. Push this folder

From `PPM Tool 33`:

```
git init
git add .
git commit -m "Portfolio Manager pilot"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

`.gitignore` keeps backups, dumps and the build ZIPs out. Check the file list before pushing if you want to be sure:

```
git status --short
```

### 3. Turn on Pages

Repository **Settings → Pages**. Source: **Deploy from a branch**, branch `main`, folder `/ (root)`. Save. It takes a minute or two, then your URL is:

```
https://<your-username>.github.io/<repo-name>/login.html
```

### 4. Point Supabase at it

**Supabase dashboard → Authentication → URL Configuration:**

- **Site URL:** `https://<your-username>.github.io/<repo-name>`
- **Redirect URLs:** add the same, plus `https://<your-username>.github.io/<repo-name>/**`

This matters for password-reset and email-confirmation links. Sign-in itself does not redirect, so it will appear to work without this — until the first person forgets their password. Do it now.

Nothing else needs changing. Supabase's REST API allows browser origins by default, so there is no CORS step.

### 5. Smoke test, in this order

1. Open the URL in a **private/incognito window** — this proves you are testing the deployed copy, not your cache
2. Sign in with password + TOTP
3. Open every page from the navigation
4. Edit something, reload, confirm it persisted
5. **Reports → export a PDF** (see the note below)
6. `F12` → Console → confirm nothing red

---

## The one thing I expect might break: PDF export

The new Content-Security-Policy blocks `eval`. `pdfmake.min.js` bundles core-js polyfills that call `Function("return this")` and a `Function.prototype.bind` shim — all guarded, and all skipped by browsers that have the native features, which every current browser does. So it should be fine.

But "should" is not "is", and PDF export is a real feature. If it fails with a CSP error in the console, the fix is one word. In `reports.html`, change:

```
script-src 'self' https://cdn.jsdelivr.net;
```

to:

```
script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net;
```

Only that page loads pdfmake, so the loosening stays contained. Tell me and I will do it.

### What the CSP does and does not do

```
default-src 'self'; script-src 'self' https://cdn.jsdelivr.net;
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self' data:; connect-src 'self' https://qmfigesgkoirirgpgmse.supabase.co;
object-src 'none'; base-uri 'self'; form-action 'self'
```

Being straight about the weak spot: **`style-src` needs `'unsafe-inline'`**. The application uses 113 inline `style=` attributes and three modules inject `<style>` blocks at runtime. Removing that would be a real refactor for a modest gain, since style injection is a much weaker attack vector than script injection. `script-src` has **no** `unsafe-inline` and no `unsafe-eval`, which is the part that matters.

Two limits of doing this in a `<meta>` tag rather than an HTTP header — Pages cannot set headers:

- `frame-ancestors` and `report-uri` are ignored in meta, so there is no clickjacking protection and no violation reporting
- `Content-Security-Policy-Report-Only` is not permitted in meta at all, which is why this policy is enforcing from the start rather than being trialled

`TECHNICAL-SPECIFICATION.html` is deliberately excluded — it contains an inline `<script>` that a strict `script-src` would break, and it is reference documentation rather than part of the running tool.

---

## Adding a tester — the actual bottleneck

Hosting is the easy part. Every tester needs **three** things, and Stage 12A deliberately made the third impossible from the browser:

1. a Supabase Auth user
2. TOTP enrolled on that user
3. a `people` row whose `auth_user_id` points at it

That third step is the one that makes them a real identity with a role and a scope. `auth_user_id` is not writable from the application at any permission level — it decides who someone *is* — so it is a deliberate administrative act.

### Steps

**a. Create the Auth user.** Supabase dashboard → Authentication → Users → **Add user**. Set email and a temporary password. Tick **Auto Confirm User** so they are not waiting on an email.

**b. Create the person in the tool.** Sign in yourself, open **Resources**, add them: name, email (must match exactly), team, job title. Give them an access role and scope — this is where you decide what they can see. Save.

**c. Link the two.** This is the step the application cannot do. Either send me the email address and I will do it, or run this in the Supabase SQL editor:

```sql
update public.people p
   set auth_user_id = u.id
  from auth.users u
 where u.email = 'tester@example.com'
   and p.legacy_resource_id = 'RES-0006';   -- the row you just created
```

It must run in the SQL editor as the table owner — the guard trigger blocks this from the application, which is the whole point.

**d. They enrol TOTP.** On first sign-in, after the password, the tool takes them through scanning a QR code. Nothing for you to do.

**e. Confirm it worked:**

```sql
select legacy_resource_id, full_name, email, access_role, access_scope,
       case when auth_user_id is not null then 'LINKED' else 'NOT LINKED' end as login
from public.people order by legacy_resource_id;
```

### Testing the permission model properly

Worth doing deliberately, because it is the part with the most to get wrong and it has never been tested with more than one account. Give testers **different** roles — one Project Manager, one Sponsor, one Read-only — and check that a Project Manager assigned to one project genuinely cannot see another. That exercises RLS rather than the UI hiding buttons.

---

## Recommendations I did not act on

**Pin the Supabase library.** Every page loads:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

`@2` means "latest v2.x", so jsDelivr can serve a different build tomorrow than today. For a public pilot that is a supply-chain surface and a reproducibility problem — a bug report could arrive against a version you never tested. Pinning to an exact version (`@2.45.4`, say) and adding an `integrity` hash would fix both. I have not changed it because picking a version blind risks breaking a working tool. Say the word and I will pin it to whatever is live now, test, and confirm.

**`TECHNICAL-SPECIFICATION.html` is now public and its architecture section is wrong.** It describes the original browser-only design: localStorage as the database, browser password hashing, no server authorisation. A tester or colleague reading it would draw exactly the wrong conclusions about the security model. The README says so, but rewriting it is Stage 14 work.

---

## Tests

**Static:** all 40 JS files parse; all 19 pages carry the CSP and the `2026.08.08.13` cache-bust; `TECHNICAL-SPECIFICATION.html` correctly excluded from CSP; no absolute paths; no case mismatches between references and files on disk; no server secret in any browser source; all 25 migrations pass `STAGE-SQL-LINT.py`.

**Harness:** 97 assertions passing — this stage touched no application logic.

**Live database:** 37/37 tables with RLS and AAL2; zero anon reach.

---

## What's left after this

**Stage 14 — cleanup and documentation.** Now the most valuable remaining work, and more so with outsiders reading the repository:

- rewrite `TECHNICAL-SPECIFICATION.html` to describe the actual architecture
- retire the local `PPMAudit.record()` write path now that verified server audit covers all 37 tables
- retire shadow mode and the source switches once you are confident in the cutovers
- refresh the handover document, which is now many stages out of date

**Stage 15 — production identity**, when the tool is ready for your employer: Entra, custom domain with TLS, proper HTTP security headers (which needs a host that can set them — Cloudflare Pages or similar), and error monitoring.

Carried-over items: tighten `resource_absence` to person/team scope, close the dormant foundation `writeGlobal` seam gap, and the optimistic-lock message reads "This people was changed by someone else" — a shared string wanting a per-table label.
