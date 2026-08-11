/*
  The shared half of the two specification documents. This file writes nothing; it is
  imported by the two builders, which do:

    node BUILD-SPEC-USER.mjs         writes USER-SPECIFICATION.html
    node BUILD-SPEC-DEVELOPER.mjs    writes DEVELOPER-SPECIFICATION.html

  (Its header used to say `node BUILD-SPECIFICATIONS.mjs` writes both documents. That
  was true before the split, and afterwards the command ran, exited 0 and produced
  nothing, which is a confusing way to find out.)

  Why a generator rather than two hand-written HTML files: the permission matrix
  (47 permissions across 9 roles) and the collection registry (32 collections) are
  read out of ppm-auth-utils.js and ppm-child-database.js at build time. Those are
  exactly the tables that rot fastest when maintained by hand, and a specification
  that misstates who can approve a budget is worse than one that omits it.

  Prose is written here as template strings. Regenerate after changing either
  source file, or the documents will describe a system that no longer exists.
*/

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/*
  Read, not written down. VERIFY-STATIC requires one cache-bust version across every .html in
  the folder, and these two documents are .html - so a hardcoded constant here had to be edited
  by hand on every release, in step with a bump that happens in a different script. It drifted,
  and the gate then failed on the documents rather than on anything a user could see, which is
  a confusing way to be told to run one more command.
*/
const VERSION = readFileSync(join(HERE, "VERSION"), "utf8").trim();
const BUILT = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/* ------------------------------------------------------ read the real sources */

function literalAfter(source, marker, open) {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`marker not found: ${marker}`);
  const from = source.indexOf(open, start);
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  throw new Error(`unbalanced literal after ${marker}`);
}

const authSrc = readFileSync(join(HERE, "ppm-auth-utils.js"), "utf8");
// eslint-disable-next-line no-eval
const ALL_PERMISSIONS = eval(`(${literalAfter(authSrc, "const ALL_PERMISSIONS", "[")})`);
// eslint-disable-next-line no-eval
const ROLES = eval(`(${literalAfter(authSrc, "const ROLE", "{")})`);

const childSrc = readFileSync(join(HERE, "ppm-child-database.js"), "utf8");
// eslint-disable-next-line no-eval
const MODULES = eval(`(${literalAfter(childSrc, "const MODULES = {", "{")})`);

const ROLE_NAMES = Object.keys(ROLES);

function permsOf(role) {
  const p = ROLES[role].permissions;
  return Array.isArray(p) ? p : [];
}

/* --------------------------------------------------------------- HTML helpers */

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/* Short role labels, so a 9-column matrix fits on a screen. */
const ROLE_ABBR = {
  "System Administrator": "Admin",
  "Portfolio Manager / PMO Manager": "PfM",
  "Project Manager": "PM",
  "PMO Analyst": "PMO",
  "Project Sponsor / Project Lead": "Spon",
  "Resource Manager / Team Manager": "ResM",
  "Project Team Member": "Team",
  "Executive / Steering User": "Exec",
  "Read-only / Auditor": "Audit"
};

/* Plain-language explanation of each permission, for the user document. Written
   out rather than derived, because "projects.status" does not explain itself. */
const PERMISSION_MEANING = {
  "home.view": "See the Home dashboard.",
  "projects.view": "Open projects and read their details.",
  "projects.create": "Create a new project.",
  "projects.edit": "Change project details, scope, dates and people.",
  "projects.status": "Update a project's RAG status, position and next steps.",
  "projects.archive": "Archive a project, and restore it.",
  "administration.view": "Open the Administration page and read the configuration.",
  "administration.edit": "Change lifecycle templates, reference data, reporting calendars and rules.",
  "portfolios.view": "See portfolios.",
  "portfolios.edit": "Change portfolio details, budget and financial year.",
  "programmes.view": "See programmes.",
  "programmes.edit": "Change programme details, dates, budget and commentary.",
  "programmes.approve": "Approve programme-level submissions.",
  "milestones.view": "See milestones.",
  "milestones.edit": "Add, change and complete milestones.",
  "stageGates.view": "See stage gates and their history.",
  "stageGates.submit": "Submit a stage gate for approval.",
  "stageGates.approve": "Approve, reject or defer a stage gate.",
  "stageGates.override": "Move a project's stage without a gate, recording a reason.",
  "plan.view": "See the project plan.",
  "plan.edit": "Add and change plan tasks, owners, dates and progress.",
  "plan.requestBaseline": "Request a new plan baseline.",
  "plan.approveBaseline": "Approve or reject a rebaseline request.",
  "raid.view": "See the RAID log.",
  "raid.edit": "Add and change risks, assumptions, issues and dependencies.",
  "registers.view": "See the action, decision, document and status report registers.",
  "registers.edit": "Add and change register entries.",
  "benefits.view": "See benefits.",
  "benefits.edit": "Add and change benefits and their measurement.",
  "resources.view": "See the resource directory.",
  "resources.viewContact": "See resource email addresses and contact details.",
  "resources.edit": "Change resource profiles, teams and capacity.",
  "resources.manageTeam": "Manage the people in your own team.",
  "users.manage": "Set someone's access role, scope and account status.",
  "resourceManagement.view": "See demand, capacity and utilisation.",
  "resourceManagement.edit": "Create and change resource demand.",
  "resourceManagement.publishScenario": "Publish a resource scenario so it becomes live demand.",
  "financials.viewRag": "See the financial RAG status only, not the numbers.",
  "financials.viewDetail": "See budgets, forecasts, actuals and variance.",
  "financials.edit": "Change financial records and cost lines.",
  "financials.configure": "Change the cost category configuration.",
  "financials.approve": "Approve or reject a budget request.",
  "audit.view": "Open Audit History and read the change record.",
  "reports.view": "See reports and dashboards.",
  "reports.export": "Export report data to CSV.",
  "views.publish": "Publish a saved view so the whole team can use it.",
  "search.use": "Use global search."
};

/* Grouping for the matrix, so it reads as an outline rather than 47 flat rows. */
const PERMISSION_GROUPS = [
  ["Getting around", ["home.view", "search.use"]],
  ["Projects", ["projects.view", "projects.create", "projects.edit", "projects.status", "projects.archive"]],
  ["Portfolios and programmes", ["portfolios.view", "portfolios.edit", "programmes.view", "programmes.edit", "programmes.approve"]],
  ["Plan and milestones", ["plan.view", "plan.edit", "plan.requestBaseline", "plan.approveBaseline", "milestones.view", "milestones.edit"]],
  ["Governance", ["stageGates.view", "stageGates.submit", "stageGates.approve", "stageGates.override"]],
  ["Delivery records", ["raid.view", "raid.edit", "registers.view", "registers.edit", "benefits.view", "benefits.edit"]],
  ["Money", ["financials.viewRag", "financials.viewDetail", "financials.edit", "financials.configure", "financials.approve"]],
  ["People and resourcing", ["resources.view", "resources.viewContact", "resources.edit", "resources.manageTeam", "users.manage", "resourceManagement.view", "resourceManagement.edit", "resourceManagement.publishScenario"]],
  ["Reporting and assurance", ["reports.view", "reports.export", "views.publish", "audit.view", "administration.view", "administration.edit"]]
];

function permissionMatrix() {
  const covered = new Set(PERMISSION_GROUPS.flatMap(([, list]) => list));
  const missing = ALL_PERMISSIONS.filter((p) => !covered.has(p));
  if (missing.length) throw new Error(`permission group coverage is incomplete: ${missing.join(", ")}`);

  const head = ROLE_NAMES.map((r) => `<th class="rot"><span>${esc(ROLE_ABBR[r] || r)}</span></th>`).join("");
  const body = PERMISSION_GROUPS.map(([group, list]) => {
    const rows = list
      .map((perm) => {
        const cells = ROLE_NAMES.map((role) => {
          const yes = permsOf(role).includes(perm);
          return `<td class="${yes ? "y" : "n"}">${yes ? "&#10003;" : "&middot;"}</td>`;
        }).join("");
        return `<tr><th class="perm"><code>${esc(perm)}</code><span class="meaning">${esc(PERMISSION_MEANING[perm] || "")}</span></th>${cells}</tr>`;
      })
      .join("\n");
    return `<tr class="group"><th colspan="${ROLE_NAMES.length + 1}">${esc(group)}</th></tr>\n${rows}`;
  }).join("\n");

  return `<div class="scroll"><table class="matrix">
<thead><tr><th class="perm">Permission</th>${head}</tr></thead>
<tbody>
${body}
</tbody></table></div>`;
}

function roleCards() {
  return ROLE_NAMES.map((role) => {
    const def = ROLES[role];
    const count = permsOf(role).length;
    const all = count === ALL_PERMISSIONS.length;
    return `<div class="role">
  <h4>${esc(role)}</h4>
  <p class="role-meta"><b>Default scope:</b> ${esc(def.defaultScope)} &nbsp;&middot;&nbsp; <b>Permissions:</b> ${all ? `all ${count}` : `${count} of ${ALL_PERMISSIONS.length}`}</p>
  <p>${esc(def.description)}</p>
</div>`;
  }).join("\n");
}

function collectionTable() {
  const rows = Object.entries(MODULES)
    .map(([name, def]) => {
      const scope = def.scopeKind || "project";
      const key = def.scopeColumn === "scope_key" ? "scope_key + record_key" : "project_code + record_key";
      const notes = [];
      if (def.readOnly) notes.push("read-only history");
      if (def.appendOnly || name === "ragHistory") notes.push("append-only");
      if (def.shape === "singleton") notes.push("single configuration record");
      return `<tr>
  <td><code>${esc(name)}</code></td>
  <td><code>${esc(def.table)}</code></td>
  <td><code>${esc(def.localKey)}</code></td>
  <td>${esc(def.shape)}</td>
  <td>${esc(scope)}</td>
  <td><code>${esc(def.idField || "-")}</code></td>
  <td>${esc(key)}</td>
  <td>${(def.fields || []).length}</td>
  <td>${esc(notes.join("; "))}</td>
</tr>`;
    })
    .join("\n");
  return `<div class="scroll"><table>
<thead><tr>
<th>Collection</th><th>Table</th><th>Browser mirror key</th><th>Shape</th><th>Scope</th>
<th>Identifier field</th><th>Unique on</th><th>Typed columns</th><th>Notes</th>
</tr></thead>
<tbody>
${rows}
</tbody></table></div>`;
}

/* --------------------------------------------------------------- page shell */

const CSS = `
:root{
  --ink:#172033; --muted:#5c6470; --line:#d8dbe0; --soft:#eef0f3;
  --bg:#ffffff; --panel:#f8fafc; --accent:#3f1937; --accent-soft:#9ddcf9;
  --ok:#166534; --ok-bg:#f0fdf4; --warn:#92400e; --warn-bg:#fffbeb;
  --bad:#991b1b; --bad-bg:#fef2f2; --code:#f1f5f9;
}
*{box-sizing:border-box}
body{margin:0;font-family:Arial,Helvetica,sans-serif;color:var(--ink);background:var(--bg);line-height:1.65;font-size:15px}
.layout{display:flex;align-items:flex-start;gap:0;max-width:1500px;margin:0 auto}
nav.toc{position:sticky;top:0;flex:0 0 288px;height:100vh;overflow-y:auto;padding:22px 18px 60px;border-right:1px solid var(--line);background:var(--panel);font-size:13px}
nav.toc h2{margin:0 0 4px;font-size:15px}
nav.toc .sub{margin:0 0 16px;color:var(--muted);font-size:12px}
nav.toc ol{margin:0;padding:0;list-style:none;counter-reset:s}
nav.toc ol>li{counter-increment:s;margin:0 0 3px}
nav.toc a{display:block;padding:5px 8px;border-radius:6px;color:var(--ink);text-decoration:none}
nav.toc a:hover{background:#e6ebf1}
nav.toc ol>li>a::before{content:counter(s) ". ";color:var(--muted)}
nav.toc ul{margin:2px 0 8px 14px;padding:0;list-style:none}
nav.toc ul a{padding:3px 8px;color:var(--muted);font-size:12px}
main{flex:1 1 auto;min-width:0;padding:30px 42px 120px}
header.doc{margin:0 0 34px;padding:0 0 20px;border-bottom:3px solid var(--accent-soft)}
header.doc .kicker{margin:0 0 6px;color:var(--muted);font-size:12px;letter-spacing:.10em;text-transform:uppercase}
header.doc h1{margin:0 0 10px;font-size:31px;line-height:1.2}
header.doc p.lede{margin:0;max-width:76ch;font-size:16px;color:#333c4d}
header.doc .meta{margin:14px 0 0;color:var(--muted);font-size:12px}
h2{margin:44px 0 12px;padding-top:10px;font-size:23px;border-top:1px solid var(--soft)}
h3{margin:28px 0 8px;font-size:18px}
h4{margin:20px 0 6px;font-size:15px}
p,li{max-width:82ch}
code{padding:1px 5px;border-radius:4px;background:var(--code);font-family:Consolas,Monaco,monospace;font-size:12.5px}
pre{margin:12px 0;padding:14px 16px;border:1px solid var(--line);border-left:4px solid var(--accent-soft);border-radius:8px;background:#fbfcfd;overflow-x:auto}
pre code{padding:0;background:none;font-size:12.5px;line-height:1.6}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
th,td{padding:7px 10px;border:1px solid var(--line);text-align:left;vertical-align:top}
thead th{background:var(--soft);font-size:12px}
tbody tr:nth-child(even){background:#fcfdfe}
.scroll{overflow-x:auto;margin:12px 0}
.note,.warn,.bad,.ok{margin:16px 0;padding:13px 16px;border-radius:8px;border-left:5px solid;font-size:14px}
.note{border-color:#60a5fa;background:#eff6ff}
.ok{border-color:#16a34a;background:var(--ok-bg)}
.warn{border-color:#d97706;background:var(--warn-bg);color:var(--warn)}
.bad{border-color:#dc2626;background:var(--bad-bg);color:var(--bad)}
.note b,.warn b,.bad b,.ok b{display:block;margin-bottom:3px}
.role{margin:12px 0;padding:13px 16px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
.role h4{margin:0 0 4px}
.role-meta{margin:0 0 6px;color:var(--muted);font-size:12.5px}
.role p{margin:0;font-size:14px}
table.matrix th.perm{width:330px;font-weight:400}
table.matrix th.perm code{display:block;font-size:12px}
table.matrix th.perm .meaning{display:block;margin-top:2px;color:var(--muted);font-size:11.5px;line-height:1.45}
table.matrix td{width:44px;text-align:center;font-size:14px}
table.matrix td.y{color:var(--ok);background:var(--ok-bg);font-weight:700}
table.matrix td.n{color:#c3c8ce}
table.matrix tr.group th{background:var(--accent);color:#fff;font-size:12px;letter-spacing:.05em;text-transform:uppercase}
table.matrix th.rot{height:96px;width:44px;padding:4px;vertical-align:bottom;text-align:center}
table.matrix th.rot span{display:block;writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;font-size:12px}
dl.fields{margin:10px 0}
dl.fields dt{margin:10px 0 2px;font-weight:700;font-size:14px}
dl.fields dt code{font-size:12.5px}
dl.fields dd{margin:0 0 6px 18px;color:#333c4d;font-size:14px}
.steps{counter-reset:step;list-style:none;padding:0}
.steps>li{counter-increment:step;position:relative;margin:0 0 10px;padding-left:34px}
.steps>li::before{content:counter(step);position:absolute;left:0;top:1px;width:23px;height:23px;border-radius:50%;background:var(--accent);color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:23px}
.pill{display:inline-block;padding:1px 8px;border-radius:11px;background:var(--soft);font-size:11.5px;color:var(--muted)}
.pill.g{background:var(--ok-bg);color:var(--ok)}
.pill.a{background:var(--warn-bg);color:var(--warn)}
.pill.r{background:var(--bad-bg);color:var(--bad)}
/* module reference: one block per file, dense enough to scan */
.module{margin:0 0 14px;padding:13px 15px;border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;background:#fcfdff}
.module h4{margin:0 0 5px;font-size:14.5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.module h4 code{font-size:14.5px;background:none;padding:0}
.module-size{float:right;color:var(--muted);font-size:11.5px;font-weight:400;font-family:inherit}
.module-owns{margin:0 0 8px;font-size:14px}
.module-owns.undocumented{color:var(--bad);font-weight:700}
.module-api{margin:0 0 8px;padding:7px 9px;border-radius:6px;background:var(--soft);font-size:12px;line-height:1.7}
.module-api code{font-size:11.5px}
dl.module-detail{margin:0}
dl.module-detail dt{margin:7px 0 1px;color:var(--muted);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
dl.module-detail dd{margin:0;font-size:13.5px;line-height:1.55}
/* change map: a recipe is a numbered list of file-then-what */
.recipe{margin:0 0 18px;padding:14px 16px;border:1px solid var(--line);border-radius:9px;background:#fcfdff}
.recipe h4{margin:0 0 9px;font-size:15.5px}
ol.recipe-steps{counter-reset:rstep;list-style:none;margin:0;padding:0}
ol.recipe-steps>li{counter-increment:rstep;display:grid;grid-template-columns:minmax(140px,auto) 1fr;gap:4px 14px;margin:0 0 7px;padding:0 0 7px 30px;border-bottom:1px dotted var(--line);position:relative;font-size:13.5px}
ol.recipe-steps>li:last-child{border-bottom:0}
ol.recipe-steps>li::before{content:counter(rstep);position:absolute;left:0;top:1px;width:20px;height:20px;border-radius:50%;background:var(--soft);color:var(--muted);font-size:11px;font-weight:700;text-align:center;line-height:20px}
ol.recipe-steps>li>code{font-size:12px;white-space:nowrap}
.recipe-note{margin:9px 0 0;padding:8px 10px;border-left:3px solid var(--accent);background:var(--soft);font-size:13px;line-height:1.55}
@media (max-width:700px){ol.recipe-steps>li{grid-template-columns:1fr}}
/* diagrams: generated SVG, styled here because style-src forbids style attributes.
   Every colour is a variable so a diagram cannot drift from the document around it. */
figure.diagram{margin:18px 0 22px;padding:16px 16px 12px;border:1px solid var(--line);border-radius:9px;background:#fcfdff}
figure.diagram svg{display:block;width:100%;height:auto;max-width:940px;margin:0 auto}
figure.diagram figcaption{margin:10px 0 0;color:var(--muted);font-size:12.5px;line-height:1.55;text-align:left}
figure.diagram figcaption b{color:var(--ink)}
svg .d-box{fill:#fff;stroke:var(--line);stroke-width:1.5}
svg .d-box.accent{fill:#f6eef4;stroke:var(--accent)}
svg .d-box.db{fill:#eef6ff;stroke:#60a5fa}
svg .d-box.store{fill:var(--ok-bg);stroke:#16a34a}
svg .d-box.gone{fill:#fbfbfc;stroke:#c3c8ce;stroke-dasharray:5 4}
svg .d-box.bad{fill:var(--bad-bg);stroke:#dc2626}
svg .d-box.warn{fill:var(--warn-bg);stroke:#d97706}
svg .d-title{fill:var(--ink);font:700 13px Arial,Helvetica,sans-serif}
svg .d-text{fill:var(--ink);font:12px Arial,Helvetica,sans-serif}
svg .d-small{fill:var(--muted);font:11px Arial,Helvetica,sans-serif}
svg .d-mono{fill:var(--ink);font:11.5px Consolas,Monaco,monospace}
svg .d-mono.muted{fill:var(--muted)}
svg .d-line{stroke:var(--muted);stroke-width:1.5;fill:none}
svg .d-line.strong{stroke:var(--accent);stroke-width:2}
svg .d-line.gone{stroke:#c3c8ce;stroke-dasharray:5 4}
svg .d-line.ok{stroke:#16a34a;stroke-width:2}
svg .d-line.bad{stroke:#dc2626;stroke-width:2}
svg .d-fill-muted{fill:var(--soft)}
svg .d-strike{stroke:#c3c8ce;stroke-width:2}
/* column widths, as classes: style-src forbids style attributes even in generated documents */
th.w-reason{width:110px}
th.w-queued{width:90px}
th.w-call{width:200px}
th.w-layer{width:190px}
footer.doc{margin:60px 0 0;padding:18px 0 0;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media print{nav.toc{display:none}main{padding:0}}
`;

function shell({ file, title, kicker, lede, audience, sections, maintenance }) {
  const toc = sections
    .map(
      (s) =>
        `<li><a href="#${s.id}">${esc(s.title)}</a>${
          s.subs && s.subs.length
            ? `<ul>${s.subs.map((x) => `<li><a href="#${x.id}">${esc(x.title)}</a></li>`).join("")}</ul>`
            : ""
        }</li>`
    )
    .join("\n");

  const body = sections.map((s) => `<section id="${s.id}">\n<h2>${esc(s.title)}</h2>\n${s.html}\n</section>`).join("\n");

  /*
    These documents are deliberately single-file, so they stay readable when emailed
    or archived. That means one inline <style> element, which style-src covers.

    Rather than allow 'unsafe-inline' - which would permit any inline style, not just
    this one - the exact stylesheet is hashed and named in the policy. The browser
    then accepts precisely this block and nothing else. The hash is computed from the
    same string that gets written, so it cannot fall out of step: change the CSS and
    the next build produces a matching hash automatically.
  */
  const styleHash = createHash("sha256").update(CSS, "utf8").digest("base64");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'none'; style-src 'self' 'sha256-${styleHash}'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'" />
<meta name="referrer" content="strict-origin-when-cross-origin" />
<title>${esc(title)} | Portfolio Manager</title>
<style>${CSS}</style>
</head>
<body>
<div class="layout">
<nav class="toc">
  <h2>${esc(title)}</h2>
  <p class="sub">${esc(audience)}</p>
  <ol>
${toc}
  </ol>
</nav>
<main>
<header class="doc">
  <p class="kicker">${esc(kicker)}</p>
  <h1>${esc(title)}</h1>
  <p class="lede">${lede}</p>
  <p class="meta">Written by Alex Kain &nbsp;&middot;&nbsp; build ${esc(VERSION)} &nbsp;&middot;&nbsp; ${esc(BUILT)}</p>
</header>
${body}
<footer class="doc">
  Portfolio Manager &middot; ${esc(title)} &middot; build ${esc(VERSION)} &middot; written by Alex Kain.${
    maintenance ? ` ${maintenance}` : ""
  }
</footer>
</main>
</div>
</body>
</html>
`;
}

export {
  ALL_PERMISSIONS,
  ROLES,
  ROLE_NAMES,
  MODULES,
  permsOf,
  permissionMatrix,
  roleCards,
  collectionTable,
  shell,
  esc,
  VERSION,
  HERE,
  join,
  writeFileSync
};
