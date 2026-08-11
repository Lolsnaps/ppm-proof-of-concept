/*
  Works out exactly which files the hosted site needs, and syncs them into the public
  repository's working folder.

    node BUILD-DEPLOY-SET.mjs                              list the files, change nothing
    node BUILD-DEPLOY-SET.mjs --sync ../ppm-proof-of-concept   make that folder contain
                                                           exactly those files

  WHY THE TARGET IS OUTSIDE THIS FOLDER

  It used to be deploy\ inside this folder, and that could not work: this folder is itself a
  git repository, and GitHub Desktop will not add or create a repository inside another one -
  it refuses to select the folder at all. The public working copy has to be a sibling, so the
  two repositories never overlap.

  WHY THIS EXISTS

  The hosted site needs well under half the files in this folder. The rest are documentation,
  migrations, the test harness and the build tooling - all of which describe how the tool works
  and how its security is put together, and none of which the browser ever asks for. Keeping
  them out of the public repository is the point of the split.

  Run this with no arguments for the current count; it is deliberately not written down here,
  because a number in a comment is wrong the first time anybody adds a page.

  WHY IT IS DERIVED RATHER THAN LISTED

  A hand-written list goes wrong in one of two ways, and they are not equally bad.
  Listing something unnecessary leaks a file. Forgetting something necessary takes the live site
  down for every tester, and the failure appears only on the page nobody opened.

  So the list is computed the way a browser would: start at each page, follow every local
  src and href, and follow every entry in the page loader's data-ppm-scripts list. Anything
  reachable that way ships. Anything not reachable does not.

  WHAT IT REFUSES TO DO

  If a page references a file that is not on disk, this exits non-zero rather than syncing a
  broken site. That is the same check VERIFY-STATIC.mjs makes, repeated here because this is
  the last thing to run before anything reaches the public repository.
*/

import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/*
  HTML that lives in the source folder but is not part of the running tool.

  Excluding a page here also excludes everything only that page references, because the file
  list is a crawl. That is how ppm-controls.css and ppm-picklist.js stay out of the public
  repository while they are being reviewed: PREVIEW-CONTROLS.html is the only thing that links
  them, and it does not ship. Deleting this line would publish an unfinished feature.
*/
const NOT_THE_APP = new Set([
  "USER-SPECIFICATION.html",
  "DEVELOPER-SPECIFICATION.html",
  "TECHNICAL-SPECIFICATION.html",
  "PREVIEW-CONTROLS.html"
]);

/*
  Files the site needs that no page references, so no crawl can find them.
  Each one is here for a stated reason; nothing goes in this list to be tidy.
*/
const ALWAYS = [
  [".nojekyll", "GitHub Pages runs Jekyll without it, which discards files beginning with an underscore"],
  ["README-PUBLIC.md", "a public repository with no README reads as abandoned"],
  ["DEPLOY-GITATTRIBUTES", "without a line-ending policy the public repo shows identical files as wholly changed"]
];

/*
  Files that ship under a different name.

  README.md in this folder is the developer's own: it names the file map, the release gates and
  where the specifications are. Publishing that would undo the whole point of the split, so the
  public repository gets README-PUBLIC.md instead - what the tool is, how to get an account, how
  to report a fault, and nothing else.
*/
const RENAME = { "README-PUBLIC.md": "README.md", "DEPLOY-GITATTRIBUTES": ".gitattributes" };

function pages() {
  return readdirSync(HERE).filter((file) => file.endsWith(".html") && !NOT_THE_APP.has(file));
}

/* Every local file a page asks the browser to fetch. */
function referencedBy(file) {
  const html = readFileSync(join(HERE, file), "utf8");
  const found = new Set();

  [...html.matchAll(/(?:src|href)="(?!https?:|#|mailto:|data:)([^"]+)"/g)].forEach((match) => {
    found.add(match[1].split("?")[0].split("#")[0]);
  });

  /* The page loader carries its script list in an attribute, pipe separated. Missing this is
     how reports.html came to load none of its own code. */
  [...html.matchAll(/data-ppm-scripts="([^"]*)"/g)].forEach((match) => {
    match[1]
      .split("|")
      .map((entry) => entry.split("?")[0].trim())
      .filter(Boolean)
      .forEach((entry) => found.add(entry));
  });

  return [...found].filter(Boolean);
}

export function deploySet() {
  const needed = new Map();
  const missing = [];

  const note = (file, why) => {
    if (!needed.has(file)) needed.set(file, why);
  };

  ALWAYS.forEach(([file, why]) => {
    if (existsSync(join(HERE, file))) note(file, why);
    else missing.push({ file, from: "the always-ship list" });
  });

  pages().forEach((page) => {
    note(page, "an application page");
    referencedBy(page).forEach((target) => {
      if (!existsSync(join(HERE, target))) {
        missing.push({ file: target, from: page });
        return;
      }
      note(target, `referenced by ${page}`);
    });
  });

  return { files: [...needed.keys()].sort(), why: needed, missing };
}

/* ------------------------------------------------------------------- syncing */

function everyFileUnder(root, base = root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = join(root, entry.name);
    /* The target is a git working tree of its own; never touch its .git. */
    if (entry.name === ".git") return [];
    return entry.isDirectory() ? everyFileUnder(full, base) : [relative(base, full).split("\\").join("/")];
  });
}

/*
  This function deletes files, so it has to be certain it is pointed at the public working
  copy and not at, say, a documents folder or the parent directory. A previous version would
  have cheerfully emptied whatever it was given.

  Three things make a folder safe to manage: it does not exist, it is empty, or it already
  contains index.html - which is the site's entry point and therefore in every deploy set
  ever produced. A nested repository is refused outright: that is what a stray "create a
  repository here" leaves behind, and pruning around it damages the very thing somebody was
  in the middle of setting up.
*/
function refuseUnlessSafe(root, shown) {
  if (!existsSync(root)) return;
  if (!statSync(root).isDirectory()) throw new Error(`refusing to sync: ${shown} is a file, not a folder`);

  const entries = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.name !== ".git");
  if (!entries.length) return;

  const nested = entries
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, ".git")))
    .map((entry) => entry.name);
  if (nested.length) {
    throw new Error(
      `refusing to sync: ${shown} contains a git repository of its own (${nested.join(", ")}).\n` +
        "  Sync into that folder directly, or move it somewhere else first. Pruning around a\n" +
        "  nested repository would delete files it is tracking."
    );
  }

  if (!existsSync(join(root, "index.html"))) {
    throw new Error(
      `refusing to sync: ${shown} is not empty and has no index.html, so it does not look like\n` +
        "  a copy of the site. Nothing has been changed. Check the folder name."
    );
  }
}

function sync(target) {
  const { files, missing } = deploySet();
  if (missing.length) throw new Error("refusing to sync: files are missing");

  const root = join(HERE, target);
  refuseUnlessSafe(root, target);
  mkdirSync(root, { recursive: true });

  const wanted = new Set(files.map((file) => RENAME[file] || file));
  let copied = 0;
  let unchanged = 0;

  files.forEach((file) => {
    const from = join(HERE, file);
    const to = join(root, RENAME[file] || file);
    mkdirSync(dirname(to), { recursive: true });
    /* Copy only when the content differs, so git sees a change only where there is one. */
    const same =
      existsSync(to) &&
      statSync(to).size === statSync(from).size &&
      readFileSync(to).equals(readFileSync(from));
    if (same) {
      unchanged += 1;
      return;
    }
    copyFileSync(from, to);
    copied += 1;
  });

  /*
    Anything in the target that is no longer wanted is removed, so a file deleted here is
    deleted there. Without this, a renamed script would leave its old copy on the live site
    for ever - stale, public, and served to anyone who asked for it by name.
  */
  const removed = everyFileUnder(root).filter((file) => !wanted.has(file));
  removed.forEach((file) => rmSync(join(root, file)));

  return { copied, unchanged, removed };
}

/* --------------------------------------------------------------------- entry */

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { files, why, missing } = deploySet();

  if (missing.length) {
    console.error(`\nRefusing to continue: ${missing.length} referenced file(s) are not on disk.\n`);
    missing.forEach((entry) => console.error(`  ${entry.file}  (needed by ${entry.from})`));
    console.error("\nFix those before deploying. A missing file is a page that breaks for every tester.\n");
    process.exit(1);
  }

  const syncAt = process.argv.indexOf("--sync");
  if (syncAt === -1) {
    const counted = {};
    files.forEach((file) => {
      const ext = file.includes(".") ? file.slice(file.lastIndexOf(".")) : file;
      counted[ext] = (counted[ext] || 0) + 1;
    });
    console.log(`\nThe hosted site needs ${files.length} file(s):\n`);
    Object.entries(counted)
      .sort((a, b) => b[1] - a[1])
      .forEach(([ext, n]) => console.log(`  ${String(n).padStart(3)}  ${ext}`));
    console.log("\nFiles no page reaches, and their reason for shipping anyway:");
    ALWAYS.forEach(([file, reason]) => {
      const shipped = RENAME[file] ? ` (shipped as ${RENAME[file]})` : "";
      console.log(`  ${file.padEnd(22)}${reason}${shipped}`);
    });
    console.log(`\nRun with --sync <folder> to update the public copy. Nothing has been changed.\n`);
    void why;
  } else {
    const target = process.argv[syncAt + 1];
    if (!target) {
      console.error("--sync needs a folder, for example: node BUILD-DEPLOY-SET.mjs --sync ../ppm-proof-of-concept");
      process.exit(1);
    }

    let synced;
    try {
      synced = sync(target);
    } catch (error) {
      /* The guards in refuseUnlessSafe explain themselves; print the explanation rather
         than a stack trace, because the person reading it is publishing, not debugging. */
      console.error(`\n${error.message}\n`);
      process.exit(1);
    }
    const { copied, unchanged, removed } = synced;
    console.log(`\n${target}/ now contains exactly the ${files.length} file(s) the site needs.`);
    console.log(`  ${copied} copied or updated`);
    console.log(`  ${unchanged} already identical`);
    if (removed.length) {
      console.log(`  ${removed.length} removed because nothing references them any more:`);
      removed.forEach((file) => console.log(`      ${file}`));
    }
    console.log("");
  }
}
