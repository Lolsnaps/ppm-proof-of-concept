# Publishing to GitHub — detailed walkthrough

Written for someone who has not used GitHub before. Roughly 20 minutes, most of it waiting.

**I have already done the fiddly part.** The folder is now a prepared Git repository with all 141 files staged on a branch called `main`, and the 14 build ZIPs correctly excluded. You do not need to type any commands.

I stopped short of making the first commit on purpose: a commit records an author, and that should be you, not me. GitHub Desktop will do it in your name in step 4.

---

## Why you are doing this by hand and not me

I have a Supabase connector, which is why I can run your migrations directly. **There is no GitHub connector available** — I checked the registry. So I cannot create a repository or push to it on your behalf.

My sandbox *can* reach github.com, so the only missing piece is a credential of yours. If you created a Personal Access Token and pasted it here I could push directly — but that puts a working credential into a chat transcript, and I would rather not encourage that. GitHub Desktop is about the same amount of effort and nothing leaves your machine. If you would still prefer the token route, see the appendix.

---

## Step 1 — Install GitHub Desktop

1. Go to **https://desktop.github.com** and download it.
2. Install and open it.
3. It will ask you to sign in to GitHub. If you do not have an account, click the sign-up link and make one — free is fine.
4. When it asks about your name and email for commits, accept what it suggests.

> **Why this and not the command line?** It handles 141 files in one go, it obeys the exclusion rules I set up, and there is nothing to type. The web upload page is capped at 100 files per drag, so this folder would need splitting.

---

## Step 2 — Add the folder

1. In GitHub Desktop: **File → Add local repository**.
2. **Choose…** and select this exact folder:

   ```
   C:\Users\AlexT\Downloads\PPM\PPM Tool 33
   ```

3. Click **Add repository**.

GitHub Desktop will recognise it as a Git repository — because I already initialised it — rather than offering to create one.

**What you should see:** a list of about 141 changed files down the left. If it says "this directory does not appear to be a Git repository", stop and tell me.

---

## Step 3 — Check what is going out

Worth thirty seconds, because this repository will be public.

Scroll the file list. You should see `.html`, `.js`, `.css`, `.sql` and `.md` files.

You should **not** see:

- anything named `portfolio-manager-backup-….json` — that is real project and people data
- any `PPM-Tool-33-….zip`

If you see a ZIP or a backup file, stop and tell me before continuing.

---

## Step 4 — Make the first commit

Bottom left of GitHub Desktop:

1. In the **Summary** box type: `Portfolio Manager pilot`
2. Click **Commit 141 files to main**.

That is now saved to your machine's history. Nothing is online yet.

---

## Step 5 — Publish it to GitHub

1. Click **Publish repository** at the top.
2. **Name:** something URL-friendly with no spaces — `portfolio-manager` works well. Remember exactly what you type; you need it in step 7.
3. **Description:** optional.
4. **Uncheck "Keep this code private."**

   This is the one counter-intuitive step. GitHub Pages will not serve a site from a private repository unless you are on GitHub Enterprise, so private here means no website. It is safe to be public: your database refuses everything to an unauthenticated visitor, and the only key in the code is the publishable one, which is designed to be public.

5. Click **Publish repository**. It uploads 4.8 MB — a few seconds.

---

## Step 6 — Turn the website on

1. Go to **https://github.com** and open your new repository.
2. Click **Settings** (top right of the repository, in the row starting with Code, Issues, Pull requests).
3. In the left sidebar, scroll down and click **Pages**.
4. Under **Build and deployment → Source**, choose **Deploy from a branch**.
5. Two dropdowns appear. Set them to **`main`** and **`/ (root)`**.
6. Click **Save**.

Now wait. First publish takes one to three minutes. Refresh the Pages settings page until a green banner appears with your address.

---

## Step 7 — Your address

```
https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/login.html
```

So if your username is `alexthorne` and you named the repository `portfolio-manager`:

```
https://alexthorne.github.io/portfolio-manager/login.html
```

**Open it in a private/incognito window** — that guarantees you are seeing the published site and not a cached local copy.

If you get a 404, wait another minute and refresh; Pages is often still building.

---

## Step 8 — Tell Supabase about the new address

Skip this and sign-in will still work — right up until the first person forgets their password and the reset email sends them somewhere useless.

1. Supabase dashboard → your project → **Authentication** in the left sidebar.
2. **URL Configuration**.
3. **Site URL:** `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME`
4. **Redirect URLs → Add URL:** `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/**`

   The `/**` matters — it is a wildcard covering every page.
5. Save.

Send me your URL and I will confirm this is right from my side.

---

## Step 9 — Check it works

In the incognito window:

1. Sign in — password, then the 6-digit code from your authenticator.
2. Click through every item in the top navigation.
3. Change a job title somewhere, reload, confirm it stuck.
4. **Reports → export a PDF.** This is the one I expect might fail — see below.
5. Press `F12`, click **Console**, look for anything red.

Paste me anything red and I will fix it.

### The PDF caveat

The security policy I added blocks a JavaScript feature called `eval`. The PDF library bundles compatibility code that uses it, but only on old browsers, so it should be fine. If PDF export fails with a message mentioning Content Security Policy, tell me — it is a one-word fix to a single file and I will make it.

---

## Making changes later

Once set up, updating the live site is three clicks:

1. I change files in the folder as usual.
2. GitHub Desktop shows what changed. Type a short summary, click **Commit to main**.
3. Click **Push origin**.

Pages rebuilds in about a minute. Hard-refresh with `Ctrl+F5` if you do not see the change — though the `?v=` stamps on every file mean you usually will.

---

## If something goes wrong

| What you see | What it means |
| --- | --- |
| "This directory does not appear to be a Git repository" | Wrong folder. It must be `PPM Tool 33` itself, not `PPM` above it |
| 404 at your Pages URL after 5 minutes | Check Settings → Pages says branch `main`, folder `/ (root)`. Also confirm the repository is public |
| Site loads but no styling | A file failed to upload. Console (`F12`) will show which |
| "Invalid login credentials" | Supabase account issue, not hosting. Tell me the email and I will check the database |
| Sign-in works but every page is empty | Your `people` row may not be linked. I can check and fix that directly |
| Anything red in the console | Paste it to me |

---

## Appendix — if you would rather I pushed it

I can, but you would need to give me a credential, so read this first.

1. GitHub → your avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Restrict it to **only** the new repository.
3. Permissions: **Contents → Read and write**. Nothing else.
4. Expiry: **7 days**, the shortest offered.
5. Paste it here.

**The honest trade-off:** that token would then exist in this conversation's history. It is scoped to one repository, expires in a week, and you can revoke it in two clicks the moment I am done — so the risk is small and bounded. But it is not zero, and GitHub Desktop avoids it entirely for about the same effort. I would still create the repository and enable Pages yourself either way, because those are settings changes rather than pushes.

My recommendation is GitHub Desktop. The appendix exists because it is your decision, not mine.
