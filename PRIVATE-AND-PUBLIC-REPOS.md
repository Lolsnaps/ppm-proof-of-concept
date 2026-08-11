# The two repositories — where you are, and the last four steps

Written for GitHub Desktop and the GitHub website. **There is nothing to type into a terminal.**

---

## Where you are now — checked, not assumed

The hard part is done. All of this was verified on 9 August 2026:

| | State |
| --- | --- |
| **Private** — `ppm-tool-source` | Holds everything. This folder points at it, working tree clean. |
| **Public** — `ppm-proof-of-concept` | Public, same name and URL as before, serving the site. |
| **The live site** | Up, and serving the application. |
| **Are the documents public?** | **No.** `HANDOVER.md`, `DEVELOPER-SPECIFICATION.html` and `VERSION` all return "not found" on the live site, and the `README.md` being served is the short public one, not the developer's. |

So the split worked. What is left is only the local plumbing: giving the public repository a
working folder that GitHub Desktop can actually manage.

---

## What went wrong, and why it was my fault

I told you to put the public copy in `PPM Tool 33\deploy` — a folder *inside* the private
repository. GitHub Desktop will not add or create a repository inside another one. It doesn't
explain itself; it just refuses to accept the folder. There was no way to follow that step.

Two repositories cannot be nested. The public copy has to sit **beside** `PPM Tool 33`:

```
C:\Users\AlexT\Downloads\PPM\
├── PPM Tool 33\              <- private source (everything)
└── ppm-proof-of-concept\     <- public copy (the 88 files the site needs)
```

`deploy-public.cmd` now writes to that sibling folder, and refuses to touch anything that does
not look like a copy of the site.

I have also deleted the old `PPM Tool 33\deploy` folder, including the half-made repository
inside it. Nothing was lost: its 88 files are rebuilt from this folder on demand, and its one
commit ("Initial commit", the `.gitattributes` GitHub Desktop writes for itself) is already on
GitHub as the first commit of the public repository. It had to go, because the next refresh
would have deleted files from inside it.

---

# The last four steps

### Step 1 — Tell GitHub Desktop to forget the half-made repository

Its folder no longer exists, so Desktop will show it as missing.

1. Open **GitHub Desktop**.
2. Click the repository selector at the top left. You should see three entries:
   **PPM Tool 33**, **deploy** or **ppm-proof-of-concept**, and possibly both.
3. Right-click anything that is **not** `PPM Tool 33` and choose **Remove…**
4. If it offers a tickbox about the Recycle Bin, leave it as it comes — the folder is gone
   already.
5. Confirm.

You should be left with just **PPM Tool 33** in the list.

### Step 2 — Clone the public repository beside this folder

This is the step that replaces the one that could not work.

1. **File → Clone repository…**
2. Choose the **GitHub.com** tab and pick **Lolsnaps/ppm-proof-of-concept**.
   (If it isn't listed, use the **URL** tab and paste
   `https://github.com/Lolsnaps/ppm-proof-of-concept`.)
3. **Local path** — this is the part that matters. Set it to:

   ```
   C:\Users\AlexT\Downloads\PPM
   ```

   **Not** `...\PPM\PPM Tool 33`. Desktop appends the repository name itself, so you will end
   up with `C:\Users\AlexT\Downloads\PPM\ppm-proof-of-concept`, beside `PPM Tool 33`.
4. Click **Clone**.

### Step 3 — Run the refresh

1. In File Explorer, open `C:\Users\AlexT\Downloads\PPM\PPM Tool 33`
2. Double-click **`deploy-public.cmd`**
3. It runs the five gates (five **PASS** lines), then refreshes
   `..\ppm-proof-of-concept`, then tells you what changed.
4. Press Enter to close.

**Do not be alarmed if it reports a lot of changed files.** The copy on GitHub was uploaded
through the website, so its line endings may differ from this folder's. This first refresh
settles that once. Every refresh after it will report only what you actually changed.

If it says the public folder does not exist, the local path in step 2 was wrong — it will
print the path it expected.

### Step 4 — Publish

1. In GitHub Desktop, change the repository at the top left to **ppm-proof-of-concept**.
2. Look at the list of changes. There should be no `.md` guides, no `.sql`, nothing beginning
   `STAGE-`. If you see any of those, stop and tell me.
3. **Summary:** `Build 2026.08.09.11`
4. **Commit to main**, then **Push origin**.
5. Wait two minutes, open the live site, press **Ctrl+Shift+R**, and check the console (**F12**)
   for anything red.

That is the split finished.

---

# From now on

Two repositories, and the only new habit is the selector at the top left of GitHub Desktop.

**When you change something:**

1. Work in `PPM Tool 33` as you always have.
2. Double-click **`bump-version.cmd`** so browsers pick up the new files.
3. GitHub Desktop, repository = **PPM Tool 33**: commit and **Push origin**.
   → the private repository, which gets everything.
4. Double-click **`deploy-public.cmd`**. It runs the gates and refreshes
   `..\ppm-proof-of-concept`.
5. GitHub Desktop, repository = **ppm-proof-of-concept**: commit and **Push origin**.
   → the public repository, which serves the site.

Steps 3 and 5 are the same two clicks with a different repository selected. If a gate fails at
step 4, nothing is copied and nothing can be published — that is the point of it.

Never edit anything inside `ppm-proof-of-concept` by hand. It is a copy; the next refresh
overwrites it.

---

# Questions you might have

**Which folder do I open to work on the tool?**
Always `PPM Tool 33`. The other one is output.

**What happens if I forget step 4 and 5?**
The private repository moves ahead and the live site stays where it was. Nothing breaks; the
site is just older than your folder. Run `deploy-public.cmd` whenever you want it caught up —
if there is nothing to do, it says so.

**What happens if I forget step 3?**
The site updates but the documentation, migrations and history do not get backed up anywhere.
This is the more expensive one to forget.

**Can the public repository ever get a document by accident?**
Only if a page links to it. The file list is derived by following every `src`, `href` and page
loader entry from each of the 20 pages, so the test for "does this ship" is "does the browser
ask for it". Anything unreachable stays here.

**What is still public that I might not expect?**
The 42 JavaScript files, which have to be public for the site to run. They are heavily
commented, and those comments explain how the tool is put together. Somebody determined could
work out most of the design from them. What actually protects your data is not secret and has
not changed: row-level security on all 37 tables, mandatory two-step sign-in, and only a
publishable key ever reaching the browser.

**Why is the public repository's history only a few commits?**
Because it was made fresh. That is the whole point — the old public history contained every
document and every migration, and no amount of deleting files from the newest commit would have
hidden them. The full history is in the private repository, where it is worth having.
