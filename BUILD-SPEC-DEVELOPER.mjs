/*
  Content for DEVELOPER-SPECIFICATION.html.

  The audience is whoever has to change this next, possibly without the person who
  built it. So it favours "why it is like this" over restating what the code says,
  and it is explicit about the mistakes that have already been made, because those
  are the ones most likely to be repeated.
*/

import { collectionTable, MODULES, ALL_PERMISSIONS, ROLE_NAMES, shell, HERE, join, writeFileSync, VERSION } from "./BUILD-SPECIFICATIONS.mjs";
import { moduleReference, changeMap, describeScripts } from "./BUILD-SPEC-MODULES.mjs";

import { readFileSync, readdirSync } from "node:fs";

/*
  Counts, measured at build time instead of typed.

  Every one of these was wrong at least once, because a number in prose has no reason to change
  when the thing it describes does. The harness said 128 assertions for a long time after it
  passed 400. So they are counted from the files themselves and interpolated, which means a stale
  figure is now impossible rather than merely unlikely.

  The database figures cannot be counted here, since there is no connection at build time. Those
  stay as literals and are checked instead by VERIFY-STATIC gate 6j against SCHEMA-MANIFEST.json
  and the migration set.
*/
const read = (f) => readFileSync(join(HERE, f), "utf8");
const countIn = (file, pattern) => (read(file).match(pattern) || []).length;

/*
  The harness total comes from an actual run, not from counting check( calls in the source.
  Counting statically undercounts by nearly two hundred, because many assertions are issued
  inside loops over lists of retired names, collections and CSS classes.
*/
const harnessRun = JSON.parse(read("HARNESS-COUNT.json"));

const COUNTS = {
  assertions: harnessRun.assertions,
  harnessSections: harnessRun.sections,
  staticGateIds: countIn("VERIFY-STATIC.mjs", /^\/\* -+ \d+[a-z]?\./gm),
  releaseGates: countIn("VERIFY-ALL.mjs", /name:\s*"/g),
  browserScripts: readdirSync(HERE).filter(
    (f) => f.endsWith(".js") && !/pdfmake|vfs_fonts/.test(f)
  ).length,
  pages: readdirSync(HERE).filter(
    (f) => f.endsWith(".html") && !/SPECIFICATION|PREVIEW/.test(f)
  ).length,
  projectFields: countIn("ppm-project-fields.js", /\{"id":"/g),
  childCollections: countIn("ppm-child-database.js", /\n {2}"\w+":\s*\{/g),
  parentCollections: 4,
  tables: JSON.parse(read("SCHEMA-MANIFEST.json")).tableCount,
  migrations: readdirSync(HERE).filter((f) => f.endsWith(".sql")).length
};
COUNTS.collections = COUNTS.childCollections + COUNTS.parentCollections;

const sections = [];
const add = (id, title, html) => sections.push({ id, title, html });

/*
  A diagram, drawn rather than described.

  Everything visual in this document is generated SVG for three reasons. It renders with no
  network and no images, which matters because the document is one file that gets emailed and
  archived. It uses the same CSS variables as the prose around it, so a diagram cannot end up a
  different colour from the section it illustrates. And it lives in this generator next to the
  words it supports, so changing one without the other is a visible edit rather than a screenshot
  quietly going stale.

  One constraint to be aware of: the document's Content-Security-Policy allows exactly one
  stylesheet, by hash, and no style attributes at all. So every shape here is styled by class -
  see the svg rules in BUILD-SPECIFICATIONS.mjs - and a style="" attribute anywhere in a diagram
  is silently dropped by the browser rather than rejected loudly.
*/
function diagram(id, width, height, body, caption) {
  return `
<figure class="diagram">
<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="fig-${id}" xmlns="http://www.w3.org/2000/svg">
  <title id="fig-${id}">${caption.replace(/<[^>]*>/g, "")}</title>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#5c6470" />
    </marker>
    <marker id="arrow-ok" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#16a34a" />
    </marker>
    <marker id="arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#dc2626" />
    </marker>
  </defs>
  ${body}
</svg>
<figcaption>${caption}</figcaption>
</figure>`;
}

/* ------------------------------------------------------------------------- */

add("orientation", "Read this first", `
<p>
  Portfolio Manager is a portfolio and project management tool. It is a set of
  static HTML pages with classic JavaScript, talking to a Supabase PostgreSQL
  database. There is no framework, no build step for the application itself, no
  bundler and no package manager at runtime.
</p>

<div class="ok">
  <b>Where to start, depending on what you came for</b>
  <a href="#walkthrough">Worked example: a new page</a>. You want to see a whole change, end to
  end, before touching anything.<br />
  <a href="#editing-a-page">Worked example: changing an existing page</a>. The more common job,
  and the one where the mistake is usually changing one of two places that had to move
  together.<br />
  <a href="#change-map">Change map</a>. You have a change to make and want the files in order.<br />
  <a href="#modules">Module reference</a>. You have a file open and want to know what it is
  responsible for.<br />
  <a href="#resource-management">Resource management</a>. The largest and least obvious feature,
  documented in its own section.<br />
  <a href="#debugging">Debugging playbook</a>. Something is wrong and you want the console
  command that narrows it down.
</div>

<div class="bad">
  <b>Two things that will cost you if you skip them</b>
  <a href="#seams">One write seam</a>. Every change to portfolio data goes through one module and
  returns an answer you have to look at. Code that ignores the answer will report success for
  writes the database actually refused.<br />
  <a href="#traps">Traps</a>. Every entry in that section is a real bug that has already happened
  in this codebase.
</div>

<h3>The architecture in one page</h3>

${diagram(
  "arch",
  940,
  330,
  `
  <rect x="20" y="16" width="250" height="66" rx="8" class="d-box accent" />
  <text x="145" y="42" text-anchor="middle" class="d-title">A page</text>
  <text x="145" y="60" text-anchor="middle" class="d-mono">project-plan.html</text>
  <text x="145" y="74" text-anchor="middle" class="d-small">+ its page script</text>

  <rect x="345" y="16" width="250" height="66" rx="8" class="d-box store" />
  <text x="470" y="42" text-anchor="middle" class="d-title">PPMStore</text>
  <text x="470" y="60" text-anchor="middle" class="d-mono">ppm-data.js</text>
  <text x="470" y="74" text-anchor="middle" class="d-small">the whole portfolio, in memory</text>

  <rect x="670" y="16" width="250" height="66" rx="8" class="d-box gone" />
  <text x="795" y="40" text-anchor="middle" class="d-title">localStorage</text>
  <text x="795" y="58" text-anchor="middle" class="d-small">8 keys of browser settings.</text>
  <text x="795" y="73" text-anchor="middle" class="d-small">No portfolio data at all.</text>

  <path d="M270 40 L338 40" class="d-line strong" marker-end="url(#arrow)" />
  <text x="304" y="32" text-anchor="middle" class="d-small">read</text>
  <path d="M338 66 L270 66" class="d-line strong" marker-end="url(#arrow)" />
  <text x="304" y="80" text-anchor="middle" class="d-small">save()</text>

  <line x1="600" y1="30" x2="668" y2="68" class="d-strike" />
  <line x1="668" y1="30" x2="600" y2="68" class="d-strike" />

  <rect x="345" y="132" width="250" height="72" rx="8" class="d-box" />
  <text x="470" y="156" text-anchor="middle" class="d-title">The two adapters</text>
  <text x="470" y="173" text-anchor="middle" class="d-mono">ppm-database.js</text>
  <text x="470" y="188" text-anchor="middle" class="d-mono">ppm-child-database.js</text>

  <path d="M440 82 L440 128" class="d-line strong" marker-end="url(#arrow)" />
  <text x="432" y="108" text-anchor="end" class="d-small">one row</text>
  <path d="M510 128 L510 82" class="d-line ok" marker-end="url(#arrow)" />
  <text x="518" y="108" class="d-small">adopt() on load</text>

  <rect x="345" y="248" width="250" height="66" rx="8" class="d-box db" />
  <text x="470" y="272" text-anchor="middle" class="d-title">PostgreSQL</text>
  <text x="470" y="290" text-anchor="middle" class="d-small">37 tables, RLS, AAL2, triggers,</text>
  <text x="470" y="305" text-anchor="middle" class="d-small">workflow functions</text>

  <path d="M470 204 L470 244" class="d-line strong" marker-end="url(#arrow)" />
  <text x="480" y="228" class="d-small">supabase-js</text>

  <rect x="20" y="132" width="250" height="182" rx="8" class="d-box" />
  <text x="145" y="156" text-anchor="middle" class="d-title">What the database enforces</text>
  <text x="36" y="180" class="d-small">Row-level security on every table</text>
  <text x="36" y="200" class="d-small">AAL2 required for every read</text>
  <text x="36" y="220" class="d-small">Optimistic locking on every row</text>
  <text x="36" y="240" class="d-small">Audit written by trigger</text>
  <text x="36" y="260" class="d-small">Guards on workflow columns</text>
  <text x="36" y="280" class="d-small">Append-only history</text>
  <text x="36" y="300" class="d-small">SECURITY DEFINER workflows</text>

  <rect x="670" y="132" width="250" height="182" rx="8" class="d-box" />
  <text x="795" y="156" text-anchor="middle" class="d-title">What the browser enforces</text>
  <text x="686" y="180" class="d-small">Nothing.</text>
  <text x="686" y="206" class="d-small">Permission checks here decide</text>
  <text x="686" y="222" class="d-small">what is shown, not what is</text>
  <text x="686" y="238" class="d-small">allowed. Assume anyone can</text>
  <text x="686" y="254" class="d-small">edit this code and call any</text>
  <text x="686" y="270" class="d-small">function with any argument.</text>
  <text x="686" y="296" class="d-small">Design accordingly.</text>
  `,
  "<b>One copy of the data in the page, one copy in the database, nothing in between.</b> " +
    "A page reads synchronously from PPMStore and saves through it; the adapters hydrate the store " +
    "from PostgreSQL on load and write single rows on save. The crossed-out box is where a " +
    `compatibility mirror of all ${COUNTS.collections} collections used to live, in localStorage, see ` +
    "<a href='#seams'>one write seam</a> for why it went."
)}

<h3>How it got here, and why that still matters</h3>

<p>
  The pages were written when localStorage <i>was</i> the database. Rather than rewrite
  nineteen pages at once, the adapters kept localStorage as a compatibility mirror: on load
  they read PostgreSQL and wrote the rows into localStorage in the legacy shapes the pages
  expected, and a patched <code>Storage.prototype.setItem</code> intercepted writes and pushed
  them back. It let the database become authoritative one collection at a time.
</p>

<p>
  It also meant an ordinary-looking browser API call performed a network write, returned before
  the database had been asked anything, and had no way to report a refusal. That produced real
  bugs for months at a time, configuration that saved locally and never reached
  PostgreSQL, four governance workflows that silently did nothing, a page that said "saved"
  while the database rejected the row. Stage 16 replaced all of it with one module that answers.
</p>

<div class="note">
  <b>Why the history is in here at all</b>
  Because the shapes of those bugs recur. Every one of them was invisible: no error, no failed
  request, a screen that looked right. When you add something, the question worth asking is not
  "does this work" but "if this failed, how would anyone find out". The
  <a href="#traps">traps</a> section is that question answered nineteen times.
</div>

<h3>Security posture, stated plainly</h3>
<ul>
  <li><b>Row-level security is the only security boundary.</b> Permission checks in
      JavaScript and hidden buttons are user experience. Assume any browser code can
      be modified by the person running it.</li>
  <li><b>The repository is public.</b> The browser holds only the Supabase
      publishable key. No service-role key, no secret, ever appears in application
      code, HTML, backups, logs or documentation.</li>
  <li><b>AAL2 is mandatory.</b> A restrictive policy on all 37 tables requires the
      session to have completed TOTP. Below AAL2 every table returns zero rows.</li>
  <li><b><code>anon</code> reaches nothing.</b> No tables, no functions.</li>
</ul>
`);

/* ------------------------------------------------------------------------- */

add("stack", "Stack, constraints and conventions", `
<h3>Runtime</h3>
<div class="scroll"><table>
<thead><tr><th>Thing</th><th>Detail</th></tr></thead>
<tbody>
<tr><td>Pages</td><td>19 static HTML files, one per screen, plus <code>login.html</code> and <code>404.html</code></td></tr>
<tr><td>JavaScript</td><td>Classic scripts, IIFE modules attaching to <code>window</code>. No ES modules in the application.</td></tr>
<tr><td>External runtime dependency</td><td><code>supabase-js</code> pinned to <code>2.112.2</code> from <code>cdn.jsdelivr.net</code>, with a Subresource Integrity hash. The only one.</td></tr>
<tr><td>Database</td><td>PostgreSQL 17.6 on Supabase, project <code>qmfigesgkoirirgpgmse</code>, eu-west-1</td></tr>
<tr><td>Hosting</td><td>GitHub Pages from a public repository</td></tr>
<tr><td>Offline tooling</td><td>Node scripts (<code>.mjs</code>) for tests, linting, demo data and these documents. Never served to the browser.</td></tr>
</tbody></table></div>

<div class="warn">
  <b>Do not introduce a build step casually</b>
  The absence of one is why a tester can open the site and it just works, and why
  there is no toolchain to maintain or supply chain to audit. If you need a build
  step, that is an architectural decision and not a convenience.
</div>

<h3>Conventions that matter</h3>
<ul>
  <li><b>Every delivery bumps <code>VERSION</code> and every cache-bust.</b> Each page
      loads scripts as <code>file.js?v=${VERSION}</code>. Miss one and a browser
      runs a mix of old and new code, which produces bugs that cannot be reproduced.</li>
  <li><b>Comments carry the reasoning the code cannot.</b> The codebase is intentionally
      heavy on rationale, especially where something looks wrong but is not. That is a
      convention about <i>comments</i>, not about this document: knowing why there is one
      write seam is no use if you cannot find which of ${COUNTS.browserScripts} files to open, so
      <a href="#modules">Module reference</a> says what each file owns and where to change it,
      and <a href="#change-map">Change map</a> gives the order of files for the changes people
      actually make.</li>
  <li><b>Errors are honest.</b> Prefer a message that names the real cause over one
      that reassures. Several existing messages were rewritten because they blamed
      the wrong thing.</li>
  <li><b>Nothing is hard-deleted.</b> Soft delete via <code>deleted_at</code>, or an
      active flag. There is no DELETE grant on child tables.</li>
</ul>

<h3>Naming</h3>
<div class="scroll"><table>
<thead><tr><th>Layer</th><th>Convention</th><th>Example</th></tr></thead>
<tbody>
<tr><td>Browser record fields</td><td>camelCase</td><td><code>baselineStartDate</code></td></tr>
<tr><td>Database columns</td><td>snake_case</td><td><code>baseline_start_date</code></td></tr>
<tr><td>Collections (adapter)</td><td>camelCase short name</td><td><code>planBaselines</code></td></tr>
<tr><td>Tables</td><td>snake_case plural</td><td><code>plan_baselines</code></td></tr>
<tr><td>Browser mirror keys</td><td><code>ppm</code> + PascalCase</td><td><code>ppmPlanBaselines</code></td></tr>
<tr><td>Public functions</td><td><code>ppm_</code> prefix</td><td><code>ppm_commit_financial_workflow</code></td></tr>
<tr><td>Internal functions</td><td><code>private</code> schema</td><td><code>private.can_access_project</code></td></tr>
</tbody></table></div>
`);

/* ------------------------------------------------------------------------- */

add("files", "File map", `
<h3>Core plumbing, loaded by every page in this order</h3>
<div class="scroll"><table>
<thead><tr><th>File</th><th>Provides</th><th>Why the order matters</th></tr></thead>
<tbody>
<tr><td><code>supabase-js@2</code> (CDN)</td><td>The client library</td><td>Everything else needs it</td></tr>
<tr><td><code>ppm-supabase.js</code></td><td><code>PPMSupabase</code>, the configured client and project URL</td><td>Holds the publishable key and URL</td></tr>
<tr><td><code>ppm-core.js</code></td><td><code>PPMCore</code> &mdash; JSON parsing, dates, numbers, shared helpers</td><td>Used by all modules below</td></tr>
<tr><td><code>ppm-data-safety.js</code></td><td><code>PPMData</code>, snapshots, restore, quota guard</td><td>Wraps <code>setItem</code> to notice a quota failure. The last prototype patch in the application.</td></tr>
<tr><td><code>ppm-auth-utils.js</code></td><td><code>PPMAuth</code>, identity, roles, permissions, project scoping for the interface</td><td>Its permission answers are read by everything below</td></tr>
<tr><td><code>ppm-database.js</code></td><td><code>PPMDatabase</code>, the foundation adapter (projects, programmes, portfolios, people)</td><td>Starts hydrating immediately; nothing is installed</td></tr>
<tr><td><code>ppm-child-database.js</code></td><td><code>PPMChildDatabase</code>, the child adapter (the other ${COUNTS.childCollections} collections)</td><td>Same</td></tr>
<tr><td><code>ppm-data.js</code></td><td><code>PPMStore</code>, the one read and write seam</td><td><b>Must load after both adapters.</b> It builds its collection list from their <code>MODULES</code> registries, and they hand it their rows through <code>adopt()</code>.</td></tr>
<tr><td><code>ppm-unsaved.js</code></td><td>The amber banner for work that has not reached the database</td><td>Subscribes to <code>PPMStore.onChange</code></td></tr>
<tr><td><code>ppm-page-loader.js</code></td><td>Awaits both adapters, then loads the page's own scripts</td><td>This is what guarantees a page never renders before hydration</td></tr>
</tbody></table></div>

<div class="note">
  <b>Why ppm-data.js can load last and still be filled first</b>
  The adapters are defined before <code>PPMStore</code> exists, and they call
  <code>PPMStore.adopt()</code> during hydration. That works because hydration is asynchronous
  and yields at its first <code>await</code> before fetching anything, by the time there
  is a row to hand over, the third script has run. Make hydration synchronous and every
  collection lands nowhere. Section 36 of <code>STAGE-14-HARNESS.mjs</code> fails if it does.
</div>

<div class="bad">
  <b>Load order used to be far more dangerous than it is</b>
  <code>ppm-data-safety.js</code> had to load before <code>ppm-auth-utils.js</code> so that it
  captured the real native <code>getItem</code> before the project-scoping filter replaced
  it. Loading it second meant a user with limited project access took a snapshot containing only
  their projects, which a full restore then wrote over everything. That bug existed and destroyed
  data in testing. The filter is gone, so the hazard is gone with it, but the load order
  is still checked by <code>VERIFY-STATIC.mjs</code> §1, because the next patch somebody adds
  will have the same problem.
</div>

<h3>Domain modules</h3>
<div class="scroll"><table>
<thead><tr><th>File</th><th>Responsibility</th></tr></thead>
<tbody>
<tr><td><code>ppm-admin-utils.js</code></td><td>Lifecycle templates, reference data, reporting calendars and periods, mandatory rules</td></tr>
<tr><td><code>ppm-governance-utils.js</code></td><td>Programmes and portfolios</td></tr>
<tr><td><code>ppm-stage-gate-utils.js</code></td><td>Stage gate model, validation, readiness and the transactional transition</td></tr>
<tr><td><code>ppm-planning-utils.js</code></td><td>Plan mechanics, slippage, RAG calculation, recorded status history</td></tr>
<tr><td><code>ppm-register-utils.js</code></td><td>Schemas for actions, decisions, financials, benefits, documents, status reports</td></tr>
<tr><td><code>ppm-financial-utils.js</code></td><td>Cost categories, money maths, financial roll-ups</td></tr>
<tr><td><code>ppm-resource-utils.js</code></td><td>Resource directory, capacity, working patterns</td></tr>
<tr><td><code>ppm-resource-management-features.js</code></td><td>Demand, utilisation, conflicts, scenarios</td></tr>
<tr><td><code>ppm-audit-utils.js</code></td><td><code>PPMAudit</code>, reads the audit trail. Read-only since Stage 14.</td></tr>
<tr><td><code>ppm-change-log.js</code></td><td>Change notifications between pages</td></tr>
<tr><td><code>ppm-notifications.js</code></td><td>On-screen notification surface</td></tr>
<tr><td><code>ppm-nav.css</code>, <code>ppm-auth.css</code></td><td>Shared styling</td></tr>
</tbody></table></div>

<h3>Offline tooling, never served</h3>
<div class="scroll"><table>
<thead><tr><th>File</th><th>Purpose</th><th>Run</th></tr></thead>
<tbody>
<tr><td><code>STAGE-14-HARNESS.mjs</code></td><td>Behavioural tests against the real adapters in a sandbox with mocked storage and Supabase. ${COUNTS.assertions} assertions across ${COUNTS.harnessSections} sections.</td><td><code>node STAGE-14-HARNESS.mjs</code></td></tr>
<tr><td><code>STAGE-SQL-LINT.mjs</code></td><td>Catches SQL mistakes a parser accepts: <code>&lt;&gt; any</code> misuse, uncast <code>name[]</code> comparisons, unclosed plpgsql blocks. Was a Python script until 9 August 2026; ported so that every gate needs only node.</td><td><code>node STAGE-SQL-LINT.mjs</code></td></tr>
<tr><td><code>VERIFY-STATIC.mjs</code></td><td>1,900+ assertions on page and script structure: script load order, CSP and style hashes, cache-busts, dependency pinning and integrity, missing files, retired identifiers, secrets</td><td><code>node VERIFY-STATIC.mjs</code></td></tr>
<tr><td><code>SCHEMA-DRIFT-CHECK.mjs</code></td><td>Cross-checks three descriptions of the schema: the live manifest, what the adapters map, and what the migration files declare</td><td><code>node SCHEMA-DRIFT-CHECK.mjs</code></td></tr>
<tr><td><code>SCHEMA-MANIFEST.json</code></td><td>The live column list, committed. Regenerate after every migration and commit the diff.</td><td>&mdash;</td></tr>
<tr><td><code>VERIFY-INVARIANTS.sql</code></td><td>Database security and structure: RLS, policies, AAL2, <code>anon</code> reach, grants, append-only enforcement, <code>search_path</code>, trigger coverage</td><td>Supabase SQL editor</td></tr>
<tr><td><code>STAGE-14A-DEMO-BUILD.mjs</code></td><td>Generates the demo portfolio SQL from the adapter's own field map</td><td><code>node STAGE-14A-DEMO-BUILD.mjs</code></td></tr>
<tr><td><code>STAGE-14A-DEMO-VERIFY.mjs</code></td><td>81,000+ checks on the generated demo data</td><td><code>node STAGE-14A-DEMO-VERIFY.mjs</code></td></tr>
<tr><td><code>BUILD-SPECIFICATIONS.mjs</code> + <code>BUILD-SPEC-*.mjs</code></td><td>Generates these two documents</td><td><code>node BUILD-SPEC-USER.mjs &amp;&amp; node BUILD-SPEC-DEVELOPER.mjs</code></td></tr>
<tr><td><code>STAGE-*-MIGRATION.sql</code>, <code>STAGE-*-VERIFY.sql</code></td><td>The applied migration history and its verification scripts</td><td>Supabase SQL editor</td></tr>
</tbody></table></div>
`);

/* ------------------------------------------------------------------------- */

add("modules", "Module reference: what each file owns", `
${moduleReference()}
`);

/* ------------------------------------------------------------------------- */

add("seams", "One write seam", `
<div class="bad">
  <b>This is the single most important section in this document</b>
  Every change to portfolio data goes through one module, one row at a time, and returns an
  answer. A caller that does not look at the answer reports success for writes the database
  refused, which is the hardest class of bug in this system to diagnose, because nothing
  errors and nothing appears in the network tab that looks wrong.
</div>

<h3>The whole API, in one example</h3>
<pre><code>const saved = await PPMStore.milestones.save(milestone);
if (!saved.ok) {
  showMessage(saved.message, saved.queued ? "warning" : "error");
  return;                      // do not re-render as though it worked
}</code></pre>

<h3>What comes back</h3>
<div class="scroll"><table>
<thead><tr><th class="w-reason">reason</th><th>What happened</th><th class="w-queued">Queued?</th><th>What the caller should do</th></tr></thead>
<tbody>
<tr><td><code>offline</code></td><td>The request could not be made, no connection, no session, fetch failed</td><td><b>Yes</b></td><td>Tell the person it is saved on this computer and will be retried. The amber banner is already saying so.</td></tr>
<tr><td><code>conflict</code></td><td>Somebody else changed the record since this browser loaded it</td><td>No</td><td>Tell them to reload. Do not merge, do not retry: their edit was made against a version that no longer exists.</td></tr>
<tr><td><code>denied</code></td><td>Row-level security or a workflow guard refused it</td><td>No</td><td>Show the message. Retrying will never work.</td></tr>
<tr><td><code>invalid</code></td><td>The record cannot be saved as asked, no identifier, wrong shape, an unknown collection</td><td>No</td><td>A programming error. Fix the call site.</td></tr>
<tr><td><code>failed</code></td><td>Anything else</td><td>No</td><td>Show the message and log it.</td></tr>
</tbody></table></div>

${diagram(
  "write-path",
  940,
  392,
  `
  <rect x="20" y="16" width="200" height="52" rx="8" class="d-box accent" />
  <text x="120" y="38" text-anchor="middle" class="d-title">Page handler</text>
  <text x="120" y="56" text-anchor="middle" class="d-small">await ...save(record)</text>

  <rect x="20" y="104" width="200" height="66" rx="8" class="d-box store" />
  <text x="120" y="127" text-anchor="middle" class="d-title">PPMStore.save()</text>
  <text x="120" y="145" text-anchor="middle" class="d-small">validates, picks the adapter</text>
  <text x="120" y="161" text-anchor="middle" class="d-small">ppm-data.js</text>

  <rect x="20" y="206" width="200" height="66" rx="8" class="d-box" />
  <text x="120" y="229" text-anchor="middle" class="d-title">Adapter</text>
  <text x="120" y="247" text-anchor="middle" class="d-small">saveOne / saveRecord</text>
  <text x="120" y="263" text-anchor="middle" class="d-small">sends the loaded version</text>

  <rect x="20" y="308" width="200" height="58" rx="8" class="d-box db" />
  <text x="120" y="332" text-anchor="middle" class="d-title">PostgreSQL</text>
  <text x="120" y="350" text-anchor="middle" class="d-small">RLS, guards, version check</text>

  <path d="M120 68 L120 100" class="d-line strong" marker-end="url(#arrow)" />
  <path d="M120 170 L120 202" class="d-line strong" marker-end="url(#arrow)" />
  <path d="M120 272 L120 304" class="d-line strong" marker-end="url(#arrow)" />

  <path d="M220 337 L300 337 L300 60 L228 60" class="d-line" marker-end="url(#arrow)" />
  <text x="308" y="200" class="d-small">the answer, all the way back up</text>

  <rect x="470" y="16" width="450" height="52" rx="8" class="d-box store" />
  <text x="486" y="38" class="d-title">ok: true</text>
  <text x="486" y="56" class="d-small">The store is updated. Only now may the screen show it.</text>

  <rect x="470" y="82" width="450" height="52" rx="8" class="d-box warn" />
  <text x="486" y="104" class="d-title">offline</text>
  <text x="486" y="122" class="d-small">Queued in memory, shown in the amber banner, retried when the connection returns.</text>

  <rect x="470" y="148" width="450" height="52" rx="8" class="d-box bad" />
  <text x="486" y="170" class="d-title">conflict</text>
  <text x="486" y="188" class="d-small">Somebody else won. The store is untouched. Reload.</text>

  <rect x="470" y="214" width="450" height="52" rx="8" class="d-box bad" />
  <text x="486" y="236" class="d-title">denied</text>
  <text x="486" y="254" class="d-small">RLS or a guard said no. Never retried. Recorded in the pending ledger.</text>

  <rect x="470" y="280" width="450" height="52" rx="8" class="d-box bad" />
  <text x="486" y="302" class="d-title">invalid</text>
  <text x="486" y="320" class="d-small">The call was wrong. Nothing was sent.</text>

  <rect x="470" y="346" width="450" height="40" rx="8" class="d-box gone" />
  <text x="695" y="371" text-anchor="middle" class="d-small">In every failing case the in-memory store is left exactly as it was.</text>

  <path d="M340 200 L466 42" class="d-line ok" marker-end="url(#arrow-ok)" />
  <path d="M340 200 L466 300" class="d-line bad" marker-end="url(#arrow-bad)" />
  `,
  "<b>The rule the whole design rests on: the store is updated only after PostgreSQL confirms.</b> " +
    "It is what stops the screen showing a state the database refused, and why every " +
    "caller has to look at the result \u2014 the store not changing is the only thing that " +
    "happens automatically, and a page that re-renders regardless will show its own optimistic " +
    "guess instead."
)}

<h3>The five functions</h3>
<dl class="fields">
<dt><code>PPMStore.&lt;collection&gt;.save(record, options?)</code></dt>
<dd>One record. Inserts or updates, decided by whether the identifier is already known. Returns
    a result. If the record is byte-for-byte what the database already holds, it is not written
    at all, re-saving an untouched row would bump its version and give somebody else a
    conflict caused by a change that never happened.</dd>

<dt><code>PPMStore.&lt;collection&gt;.remove(record, options?)</code></dt>
<dd>Soft delete: sets <code>deleted_at</code>. Foundation records (projects, programmes,
    portfolios, people) refuse this and say so, they are archived by setting a field, which
    is an ordinary save.</dd>

<dt><code>PPMStore.&lt;collection&gt;.replaceAll(collection, options?)</code></dt>
<dd><b>"This is now the whole collection."</b> Diffs against what is held: writes only what
    changed, removes what has disappeared, leaves the rest alone. It exists because most of this
    application's helpers think in whole collections &mdash; <code>saveMilestones()</code> builds
    the entire store with one project's rows replaced, and rewriting them all into
    single-record saves is how deletes get lost.
    <div class="bad">
      <b>Never hand it a filtered subset</b>
      Everything absent is removed. Passing "the rows currently on screen" deletes every row that
      is not. Passing a shape it does not recognise returns <code>invalid</code> and writes
      nothing, on purpose, because treating "I did not understand you" as "the collection
      is empty" once soft-deleted six stage gates in production.
    </div></dd>

<dt><code>PPMStore.&lt;collection&gt;.saveMany(records, options?)</code></dt>
<dd>Several records, one summary result. Does not remove anything. Use it when you have a list of
    changes rather than a whole collection.</dd>

<dt><code>PPMStore.adopt(collection, value)</code></dt>
<dd>Hydration's way in, and the adapters are its only intended caller. It sets a collection
    without asking the database anything, which is what every other function here exists to
    prevent.</dd>
</dl>

<h3>Reading</h3>
<div class="scroll"><table>
<thead><tr><th class="w-call">Call</th><th>Returns</th><th>Use it when</th></tr></thead>
<tbody>
<tr><td><code>.all()</code></td><td>A flat array of every record</td><td>You want the records and do not care how they are filed</td></tr>
<tr><td><code>.forProject(code)</code></td><td>A flat array for one project</td><td>Almost every page. Cheaper than <code>all().filter()</code>.</td></tr>
<tr><td><code>.byId(id)</code></td><td>One record or <code>null</code></td><td>You have an identifier</td></tr>
<tr><td><code>.read()</code></td><td>The collection in its stored shape, an array, or an object keyed by project</td><td>You are about to hand it back to <code>replaceAll()</code></td></tr>
<tr><td><code>.get()</code></td><td>The object, for singleton collections</td><td><code>ragConfig</code>, <code>resourceConfig</code></td></tr>
</tbody></table></div>

<div class="note">
  <b>Reads are synchronous, and they are copies</b>
  Nothing crosses the boundary by reference. Sort the result, splice it, edit a row and throw it
  away, the store is unaffected. That is intended. The store holds what the database
  confirmed, and a caller able to change it in place could make the screen disagree with
  PostgreSQL with one ordinary line of code, silently, which is the defect this whole design
  removes.
</div>

<h3>Where the project code comes from</h3>
<p>
  Eighteen collections are stored as an object keyed by project code. <code>all()</code> flattens
  that and fills in a row's project field from the key it is filed under, so a legacy row that
  never carried its own <code>projectCode</code> is still found by
  <code>forProject()</code>. Two collections, programme milestones and programme RAID
 , are keyed by programme id instead, and the adapters' registry says so with
  <code>scopeKind: "programme"</code>; the flattener reads that rather than guessing from the
  shape of the key, because guessing would invent a project that does not exist.
</p>

<h3>What this replaced, and why</h3>
<p>
  Four ways to write, three of which looked like ordinary browser code:
</p>
<div class="scroll"><table>
<thead><tr><th>Old path</th><th>What it actually did</th></tr></thead>
<tbody>
<tr><td><code>localStorage.setItem()</code></td><td>Reached PostgreSQL, because both adapters had replaced <code>Storage.prototype.setItem</code></td></tr>
<tr><td><code>PPMAuth.writeScoped()</code></td><td>The same, through a wrapper</td></tr>
<tr><td><code>PPMAuth.writeGlobal()</code></td><td>Reached PostgreSQL through a <i>second</i>, separate patch</td></tr>
<tr><td><code>PPMAuth.rawSet()</code></td><td>Bypassed everything. Hydration only.</td></tr>
</tbody></table></div>
<p>
  All four returned before the database had been asked anything. Two production bugs came
  directly from that: configuration that saved locally and never reached PostgreSQL for an entire
  stage, and a scoped user's backup that would have destroyed every record they could not see on
  restore. The four governance workflows were unreachable for months for the same reason.
</p>
<p>
  All of it is deleted, and named on the retired-identifier list so it cannot be typed back in.
  The only <code>Storage.prototype</code> assignment left in the application is the quota warning
  in <code>ppm-data-safety.js</code>.
</p>

<h3>What the gates enforce, so you do not have to remember</h3>
<ol class="steps">
  <li><b>No business key in localStorage.</b> The 36 keys come from the adapters' own
      <code>MODULES</code> registries, so the list cannot drift. Reads are checked as well as
      writes, and through <code>PPMCore.readJson</code> as well as directly.</li>
  <li><b>Every localStorage key must resolve to a literal.</b> A dynamic key fails the build:
      the gate has to be able to decide, and "I could not tell" must not read as "fine".</li>
  <li><b>No assignment to <code>Storage.prototype</code></b> outside the one allowed file.</li>
  <li><b>No discarded <code>PPMStore</code> write result.</b> <code>PPMStore.x.save(...)</code>
      on a line by itself fails.</li>
  <li><b>No unknown collection name.</b> <code>PPMStore.financialEntrys</code> fails the build
      rather than becoming <code>undefined</code> at run time on one page.</li>
</ol>

<h3>Checklist before you add any write path</h3>
<ol class="steps">
  <li>Is the collection registered in an adapter's <code>MODULES</code>? If not,
      <code>PPMStore</code> has no namespace for it and the gate will catch the name.</li>
  <li>Does the record carry its identifier field? Without one the write is
      <code>invalid</code>, on purpose, because a row keyed <code>"PRJ-001|"</code> can
      never be found or updated again.</li>
  <li>Is the caller <code>await</code>ing and reading <code>.ok</code>? If the answer is thrown
      away the build fails.</li>
  <li>Does the change need to be atomic with another collection? Then it is a workflow RPC, not a
      save. See <a href="#workflows">transactional workflows</a>.</li>
</ol>
`);

/* ------------------------------------------------------------------------- */

add("data-model", "Data model: payload plus typed columns", `
<p>Every table stores the same two things:</p>
<ol>
  <li><code>legacy_payload jsonb</code>, the complete browser record.</li>
  <li>A set of <b>typed columns</b> for the fields worth querying, indexing or
      constraining.</li>
</ol>

<h3>The mapping rule</h3>
<pre><code>browser record  =  { ...legacy_payload, ...non_null_typed_columns }</code></pre>
<p>Reading back, a typed column wins when it is not null; otherwise the payload value stands.</p>

<div class="warn">
  <b>Null and empty string mean different things</b>
  <code>null</code> in a typed column means &ldquo;no value here, use the
  payload&rdquo;. An empty string is a real value that overrides the payload. The
  conversion in <code>typedValue()</code> maps both <code>undefined</code> and
  <code>""</code> to <code>null</code> on purpose. Get this wrong and
  clearing a field silently restores its old value from the payload.
</div>

<h3>Why both</h3>
<ul>
  <li>The payload means a page can read a record whose shape predates any column
      that now exists, and a field nobody normalised is never lost.</li>
  <li>The typed columns mean row-level security, indexes, constraints and reporting
      can work on real values instead of JSON traversal.</li>
</ul>

<h3>Comparison is content-based, not textual</h3>
<p>
  <code>stableStringify()</code> sorts keys and drops <code>undefined</code>, because
  <code>JSON.stringify</code> preserves insertion order and the reconciliation
  cascade routinely rebuilds records with keys in a different order. Without it,
  identical records compared as different, every hydrated record looked modified, and
  the row version churned on every page load, which is what causes
  false conflicts once two people edit.
</p>

<h3>The three key shapes</h3>
<div class="scroll"><table>
<thead><tr><th>Shape</th><th>Unique on</th><th>Browser store shape</th><th>Used by</th></tr></thead>
<tbody>
<tr>
  <td><b>Project-scoped</b></td>
  <td><code>(project_code, record_key)</code></td>
  <td><code>{ "PRJ-00006": [ record, ... ] }</code></td>
  <td>The 18 project child tables</td>
</tr>
<tr>
  <td><b>Scope-keyed</b></td>
  <td><code>(scope_key, record_key)</code></td>
  <td>Object keyed by scope, or a flat array</td>
  <td>The 14 programme, configuration and saved-view tables</td>
</tr>
<tr>
  <td><b>Singleton</b></td>
  <td><code>scope_key = record_key = 'GLOBAL'</code></td>
  <td>The configuration object itself</td>
  <td><code>rag_config</code>, <code>resource_config</code></td>
</tr>
</tbody></table></div>
<p>
  <code>record_key</code> is always the record's own identifier field, and
  <code>scope_key</code> means whatever that table's policy says it means, a
  programme code, a configuration category, or the literal <code>GLOBAL</code>.
</p>

<h3>The collection registry</h3>
<p>Generated from <code>ppm-child-database.js</code>, so it cannot drift:</p>
${collectionTable()}
<p>
  Plus four in the foundation adapter: <code>projects</code>,
  <code>programmes</code>, <code>portfolios</code> and <code>people</code>.
</p>
`);

/* ------------------------------------------------------------------------- */

add("lifecycle-code", "Page load, hydration and writes", `
<h3>What happens between the URL and the first render</h3>

${diagram(
  "boot",
  940,
  436,
  `
  <line x1="120" y1="34" x2="120" y2="418" class="d-line gone" />
  <line x1="360" y1="34" x2="360" y2="418" class="d-line gone" />
  <line x1="600" y1="34" x2="600" y2="418" class="d-line gone" />
  <line x1="840" y1="34" x2="840" y2="418" class="d-line gone" />

  <rect x="40" y="12" width="160" height="26" rx="6" class="d-box accent" />
  <text x="120" y="30" text-anchor="middle" class="d-title">The page</text>
  <rect x="280" y="12" width="160" height="26" rx="6" class="d-box" />
  <text x="360" y="30" text-anchor="middle" class="d-title">Adapters</text>
  <rect x="520" y="12" width="160" height="26" rx="6" class="d-box store" />
  <text x="600" y="30" text-anchor="middle" class="d-title">PPMStore</text>
  <rect x="760" y="12" width="160" height="26" rx="6" class="d-box db" />
  <text x="840" y="30" text-anchor="middle" class="d-title">PostgreSQL</text>

  <text x="20" y="70" class="d-mono muted">1</text>
  <text x="40" y="70" class="d-text">Shell HTML renders. &lt;html class="ppm-loading"&gt; is already in the markup,</text>
  <text x="40" y="86" class="d-text">so the skeleton is up before a single script has run.</text>

  <text x="20" y="122" class="d-mono muted">2</text>
  <path d="M124 116 L356 116" class="d-line strong" marker-end="url(#arrow)" />
  <text x="240" y="110" text-anchor="middle" class="d-small">both adapters call boot()</text>

  <text x="20" y="158" class="d-mono muted">3</text>
  <path d="M364 152 L836 152" class="d-line strong" marker-end="url(#arrow)" />
  <text x="600" y="146" text-anchor="middle" class="d-small">select every collection this person may see</text>

  <text x="20" y="194" class="d-mono muted">4</text>
  <path d="M836 188 L364 188" class="d-line" marker-end="url(#arrow)" />
  <text x="600" y="182" text-anchor="middle" class="d-small">rows, filtered by row-level security at AAL2</text>

  <text x="20" y="230" class="d-mono muted">5</text>
  <path d="M364 224 L596 224" class="d-line ok" marker-end="url(#arrow-ok)" />
  <text x="480" y="218" text-anchor="middle" class="d-small">PPMStore.adopt(name, rows)</text>

  <text x="20" y="266" class="d-mono muted">6</text>
  <path d="M356 260 L124 260" class="d-line strong" marker-end="url(#arrow)" />
  <text x="240" y="254" text-anchor="middle" class="d-small">ready promises resolve</text>

  <text x="20" y="302" class="d-mono muted">7</text>
  <text x="40" y="302" class="d-text">ppm-page-loader.js injects the page's own scripts, in order, one at a time.</text>

  <text x="20" y="338" class="d-mono muted">8</text>
  <path d="M124 332 L596 332" class="d-line strong" marker-end="url(#arrow)" />
  <text x="360" y="326" text-anchor="middle" class="d-small">page script reads synchronously: PPMStore.projects.all()</text>

  <text x="20" y="374" class="d-mono muted">9</text>
  <text x="40" y="374" class="d-text">The page renders. ppm-loading comes off, the skeleton is removed.</text>

  <rect x="40" y="392" width="880" height="34" rx="6" class="d-box warn" />
  <text x="56" y="414" class="d-small">If a script fails twice it is skipped, the rest still load, and the class still comes off \u2014 a page you can read and reload beats an endless skeleton.</text>
  `,
  "<b>Step 7 is the load-bearing one.</b> Page scripts are injected only after both adapters' " +
    "<code>ready</code> promises resolve, which is why a page script can read " +
    "<code>PPMStore</code> synchronously at its top level and find the portfolio there. Add a " +
    "<code>&lt;script&gt;</code> tag to a page by hand and you have skipped that guarantee: it " +
    "will run before hydration and find every collection empty."
)}

<div class="warn">
  <b>Never add a page script with a plain &lt;script src&gt; tag</b>
  Put it in the page's <code>data-ppm-scripts</code> list, which is the thing that waits for hydration.
  <code>VERIFY-STATIC.mjs</code> §6e checks every page loads its own page script that way.
</div>

<h3>What hydration does, and what it does not do</h3>
<ol class="steps">
  <li>Checks there is a session and that it has reached AAL2. Below AAL2 every table returns
      zero rows through a perfectly successful query, so the check is what stops "no
      authenticator yet" being read as "this account has no data".</li>
  <li>Queries each collection, mapping typed columns over the legacy payload.</li>
  <li>Filters out rows with <code>deleted_at</code> set.</li>
  <li>Regroups child collections into the shape they are stored in, usually an object
      keyed by project code.</li>
  <li>Hands the result to <code>PPMStore.adopt()</code>. Replaces, never merges.</li>
</ol>

<div class="note">
  <b>Hydration always refreshes, even when a change has not saved</b>
  It used to skip a collection with unsaved changes, so a pending edit was not overwritten. That
  made sense while a browser mirror held the edit. Nothing holds it now, a failed save
  updates nothing, because the store only changes once PostgreSQL confirms, so refusing
  to refresh would leave the collection empty rather than stale. The database copy is the only
  copy, and it always wins. The pending ledger is still written, for reporting.
</div>

<h3>Writing</h3>
<ol class="steps">
  <li>A page calls <code>PPMStore.&lt;collection&gt;.save()</code> or
      <code>replaceAll()</code> and awaits it.</li>
  <li><code>ppm-data.js</code> resolves the collection, validates the shape, and asks the
      owning adapter to write one row.</li>
  <li>The adapter sends the record with the <code>version</code> this browser loaded.</li>
  <li>PostgreSQL applies row-level security, the guard triggers, and the optimistic lock.</li>
  <li><b>Only if that succeeds</b> is the in-memory store updated.</li>
  <li>The answer travels back to the caller, who must look at it.</li>
</ol>

<h3>Optimistic locking</h3>
<pre><code>update ... set ... where id = $1 and version = $2</code></pre>
<p>
  A <code>BEFORE UPDATE</code> trigger increments <code>version</code>. If the row
  has moved on, zero rows match and the write is refused as a conflict.
</p>
<div class="bad">
  <b>Always send the version the browser loaded, never re-fetch it</b>
  Re-reading the current version immediately before writing defeats the entire
  mechanism: it would always match, and one user would silently overwrite another.
  The whole value of the lock is that the version is stale when someone else has
  edited.
</div>

<h3>The pending ledger</h3>
<p>
  Every row-level write that does not succeed is recorded, in
  <code>ppmDatabasePending</code> for foundation collections and
  <code>ppmChildDatabasePending</code> for the rest, capped at 100 entries each. A later
  success for the same record takes its entry out again, so the ledger means "what is
  outstanding" rather than "what has ever gone wrong". Both are excluded from snapshots:
  restoring somebody else's unsaved changes would be actively harmful.
</p>
<pre><code>PPMChildDatabase.pendingWrites()             // everything outstanding
PPMChildDatabase.pendingWrites("plans")      // one collection
PPMChildDatabase.clearPending("plans")       // discard, once you have read them
PPMDatabase.pendingWrites()                  // the foundation four
PPMDatabase.clearPendingFor("projects")      // same, by collection</code></pre>
<div class="note">
  <b>The ledger is a report, not a gate</b>
  Nothing acts on it. It used to block hydration, which meant one permanently refused write
  froze a collection for as long as the entry sat there, a plan baseline refused on
  9 August was still blocking every refresh two days later. Read it, then clear it.
</div>

<h3>Work that has not reached the database yet</h3>
<p>
  An <code>offline</code> result is queued in memory and shown in an amber bar at the top of the
  page: <i>"3 changes are saved on this computer but not yet in the database."</i> The bar lists
  them, offers a retry, and removes itself when the queue drains. <code>PPMStore</code> also
  retries by itself when the browser reports the connection has returned.
</p>
<div class="bad">
  <b>The queue does not survive a reload</b>
  It is in memory. Closing the tab with work queued loses it, the pending ledger records
  that it happened, but not the content. This is a known gap, not a design decision; see
  <a href="#backlog">known gaps</a>.
</div>

<h3>Editing a project: three forms, on the details page</h3>
<p>
  <code>project-details.html</code> edits a project in place. Three buttons &mdash; <b>Edit
  project details</b>, <b>Update project status</b> and <b>Edit assurance evidence</b> &mdash;
  each render one form into a panel on that page. None of them navigates anywhere, and none
  of them involves <code>add-project.html</code>, which exists to create a project and
  nothing else.
</p>
<p>
  It was not always so. Editing used to open <code>add-project.html?mode=details|status</code>,
  which answered "change this project's status" with a page headed <b>Add project</b> and all
  113 fields behind it. An intermediate attempt hosted that same form inside the details page
  at runtime; it kept one copy of the form, but it kept the coupling too, and any failure fell
  back to navigating to the creation page, so the symptom the change existed to remove
  came back whenever anything went wrong. Both are gone.
</p>
<div class="scroll"><table>
<thead><tr><th>Form</th><th>Fields</th><th>What it is for</th></tr></thead>
<tbody>
<tr><td><b>details</b></td><td>43</td>
  <td>What the project <i>is</i>: identity, where it sits, the people accountable, what it
      delivers, strategic context. Changes rarely once a project exists.</td></tr>
<tr><td><b>status</b></td><td>32</td>
  <td>What it is <i>doing</i>: stage, dates, progress, the nine RAG dimensions, commentary.
      This is the weekly job, and it is intentionally the smallest form.</td></tr>
<tr><td><b>assurance</b></td><td>38</td>
  <td>The evidence each stage gate expects, grouped by stage. Answered as each stage arrives,
      usually by someone other than whoever writes the status.</td></tr>
</tbody>
</table></div>

<h3>How the forms are built</h3>
<p>
  <code>BUILD-PROJECT-FIELDS.mjs</code> reads the field markup in
  <code>add-project.html</code> and writes <code>ppm-project-fields.js</code>: every field
  with its label, control, options, help text and constraints, grouped, and assigned to one of
  the three forms. <code>ppm-project-forms.js</code> renders, populates, reads and validates
  from that registry.
</p>
<p>
  Generated rather than typed, because there are 113 fields and a missed one is invisible: it
  would exist on every new project and simply stop being editable. The generator refuses to
  write when a field belongs to no group, when a group names a field the markup does not have,
  or when two groups claim the same field, and both gates check coverage against the
  markup rather than against a number someone wrote down.
</p>
<p><b>What the gates hold:</b></p>
<div class="scroll"><table>
<thead><tr><th>Risk</th><th>What holds it</th></tr></thead>
<tbody>
<tr>
  <td>A new field nobody can edit</td>
  <td>The harness compares the registry against the markup and names any field no form
      claims. <code>VERIFY-STATIC.mjs</code> regenerates the registry in memory and fails if
      the file on disk differs, so a label or option change cannot be half-applied.</td>
</tr>
<tr>
  <td>One field in two forms</td>
  <td>Saved twice, and the second save overwrites the first with whatever that form happened
      to hold. Asserted to be impossible.</td>
</tr>
<tr>
  <td>The status form quietly rewriting the description</td>
  <td>A form's patch contains only its own fields, merged over the record the page loaded.
      The harness asserts the status form does not carry <code>projectName</code>,
      <code>description</code>, <code>sponsor</code> or <code>businessProblem</code>.</td>
</tr>
<tr>
  <td>A rendered field id colliding with the page</td>
  <td>Every rendered control is <code>ppmField-&lt;id&gt;</code> and is found by
      <code>[data-field]</code> within its own form, never by a bare id. A control called
      <code>projectName</code> would collide with an element of that name on the page, and
      <code>getElementById</code> returns whichever comes first.</td>
</tr>
<tr>
  <td>Editing drifting back to the creation page</td>
  <td>The gate requires all four editor triggers to be <code>&lt;button&gt;</code> elements
      and fails on any <code>href="add-project.html"</code> anywhere on the details page.</td>
</tr>
<tr>
  <td>A read-only role with an enabled Save</td>
  <td>The forms render after <code>PPMAuth</code>'s startup pass, so
      <code>applyControlPermissions()</code> is re-run after each render.</td>
</tr>
</tbody>
</table></div>

<h3>Saving from the editors</h3>
<p>
  The patch is merged over the record the page already loaded, which is what preserves
  <code>databaseVersion</code> and with it optimistic locking, re-reading the record at
  save time would defeat the protection it exists to give. The audit trail is written by database
  triggers from the authenticated identity, so there is nothing to record from the page. The write
  goes through <code>PPMStore</code> like every other save, and the result decides whether the
  panel closes: a refused save leaves the form open with
  the message on it, rather than closing and letting the next page load undo the change. A status
  save also appends a RAG history snapshot, because that table is append-only and the correction
  for a wrong status is another snapshot.
</p>
<p>
  A reported RAG that differs from the calculated one is allowed, the rules cannot know
  everything, but the save refuses until the difference is explained. An unexplained
  override is indistinguishable from a mistake when someone reads it back in three months.
</p>
`);

/* ------------------------------------------------------------------------- */

add("resource-management", "Resource management, in detail", `
<p>
  This is the largest feature in the application and the least self-evident, because almost
  nothing it shows is stored anywhere. It is documented at length here because a change made
  without understanding where a number comes from will either fix a symptom in the wrong place or
  quietly change every other number on the screen.
</p>

<h3>The four files, and what each one owns</h3>
<div class="scroll"><table>
<thead><tr><th>File</th><th>Owns</th><th>Does <i>not</i> own</th></tr></thead>
<tbody>
<tr>
  <td><code>resource-management-page.js</code><br /><span class="pill">the Gantt</span></td>
  <td>The allocation timeline: buckets, zoom, bar geometry, per-bucket allocation percentages,
      absence bands, the resource picker, saved views.</td>
  <td>Anything about demand records, capacity in hours, or scenarios. It never writes portfolio
      data at all, only its saved views.</td>
</tr>
<tr>
  <td><code>ppm-resource-management-features.js</code><br /><span class="pill">the eight panels</span></td>
  <td>Everything below the Gantt: the heatmap, capacity, utilisation, skills, runway, demand
      records, availability and absence, and the scenario workflow. Injects its own markup and
      modals into the page.</td>
  <td>The Gantt. The two share the page and share nothing else.</td>
</tr>
<tr>
  <td><code>ppm-planning-utils.js</code><br /><span class="pill">the arithmetic</span></td>
  <td><code>availableCapacity()</code>, <code>workingDaysBetween()</code>,
      <code>normalisedDemandHours()</code>, <code>overlap()</code>, and the demand, absence,
      scenario and resource-config collections.</td>
  <td>Any rendering. This is where a formula lives; put one anywhere else and two screens will
      disagree.</td>
</tr>
<tr>
  <td><code>ppm-resource-utils.js</code><br /><span class="pill">people</span></td>
  <td>The people directory, name and identifier resolution, person pickers, the quick-add flow.</td>
  <td>Anything about time, capacity or allocation.</td>
</tr>
</tbody></table></div>

<div class="bad">
  <b>The single most important thing to understand</b>
  An <b>assignment</b> is not a record. There is no assignments table and no assignments
  collection. Every bar on the Gantt is derived, on each render, from a <b>project plan task</b>
  that has an owner and dates. Change a plan task and the Gantt changes; there is nothing to keep
  in step, and nothing to migrate. Look for an assignment to edit and you will not find one.
</div>

<h3>Where each number on the screen comes from</h3>
<div class="scroll"><table>
<thead><tr><th>What you see</th><th>Derived from</th><th>Function</th></tr></thead>
<tbody>
<tr><td>A bar on the timeline</td><td>One plan task with an owner and a forecast or baseline date range</td><td><code>loadData()</code> in the page script</td></tr>
<tr><td>Its horizontal position</td><td>Bucket index plus the fraction through that bucket</td><td><code>positionForDate()</code></td></tr>
<tr><td><b>Current</b> column</td><td>Sum of <code>allocationPercentage</code> across every task whose range contains today</td><td><code>currentAllocation()</code></td></tr>
<tr><td><b>Peak</b> column and the cell shading</td><td>For each bucket, the highest simultaneous total across the task start boundaries inside it</td><td><code>allocationsForResource()</code></td></tr>
<tr><td>Amber or red shading</td><td>Thresholds from the <code>resourceConfig</code> singleton, not constants</td><td><code>allocationClass()</code></td></tr>
<tr><td>A grey absence band</td><td>An approved <code>resourceAbsence</code> row</td><td><code>absenceBand()</code></td></tr>
<tr><td>A hatched conflict segment</td><td>The intersection of a task and an approved absence</td><td><code>absenceConflictSegment()</code></td></tr>
<tr><td>Capacity in hours</td><td>Contracted hours, minus absence, non-working, fixed operational and other unavailable</td><td><code>PPMPlanning.availableCapacity()</code></td></tr>
<tr><td>Utilisation percentage</td><td>Demand hours over available hours, both prorated to the period</td><td><code>periodStats()</code> and <code>proratedDemandHours()</code></td></tr>
</tbody></table></div>

<h3>The Gantt, anatomically</h3>

${diagram(
  "gantt",
  940,
  470,
  `
  <rect x="16" y="14" width="908" height="442" rx="8" class="d-box" />
  <rect x="28" y="26" width="234" height="30" class="d-fill-muted" />
  <rect x="262" y="26" width="82" height="30" class="d-fill-muted" />
  <rect x="344" y="26" width="82" height="30" class="d-fill-muted" />
  <rect x="426" y="26" width="82" height="30" class="d-fill-muted" />
  <rect x="508" y="26" width="82" height="30" class="d-box" />
  <rect x="590" y="26" width="82" height="30" class="d-box" />
  <rect x="672" y="26" width="82" height="30" class="d-box gone" />
  <rect x="754" y="26" width="82" height="30" class="d-box gone" />
  <rect x="836" y="26" width="80" height="30" class="d-box" />
  <rect x="28" y="136" width="480" height="208" class="d-box" />
  <rect x="262" y="190" width="82" height="22" rx="4" class="d-box warn" />
  <rect x="344" y="190" width="82" height="22" rx="4" class="d-box bad" />
  <rect x="592" y="140" width="78" height="11" rx="5" class="d-box bad" />
  <rect x="508" y="158" width="82" height="24" class="d-box store" />
  <rect x="590" y="158" width="82" height="24" class="d-box bad" />
  <rect x="672" y="158" width="82" height="24" class="d-box gone" />
  <rect x="754" y="158" width="82" height="24" class="d-box gone" />
  <rect x="836" y="158" width="80" height="24" class="d-box store" />
  <rect x="512" y="224" width="300" height="20" rx="4" class="d-box accent" />
  <rect x="512" y="252" width="312" height="20" rx="4" class="d-box accent" />
  <rect x="838" y="224" width="76" height="48" rx="3" class="d-box gone" />
  <rect x="590" y="330" width="246" height="18" rx="4" class="d-box" />
  <rect x="28" y="380" width="548" height="76" rx="6" class="d-box gone" />
  <rect x="596" y="380" width="318" height="76" rx="6" class="d-box store" />
  <line x1="508" y1="26" x2="508" y2="436" class="d-line strong" />
  <text x="40" y="46" class="d-title">Resource / assignment</text>
  <text x="303" y="46" text-anchor="middle" class="d-small">Current</text>
  <text x="385" y="46" text-anchor="middle" class="d-small">Peak</text>
  <text x="467" y="46" text-anchor="middle" class="d-small">Over</text>
  <text x="549" y="46" text-anchor="middle" class="d-small">Thu 13 Aug</text>
  <text x="631" y="46" text-anchor="middle" class="d-small">Fri 14 Aug</text>
  <text x="713" y="46" text-anchor="middle" class="d-small">Sat 15 Aug</text>
  <text x="795" y="46" text-anchor="middle" class="d-small">Sun 16 Aug</text>
  <text x="876" y="46" text-anchor="middle" class="d-small">Mon 17 Aug</text>
  <text x="516" y="72" class="d-small">detailWidth() = 234 + one column per visible metric</text>
  <text x="516" y="86" class="d-small">bucketLabel(): dates at every zoom, never week numbers.</text>
  <text x="516" y="100" class="d-small">isWeekend() shades the weekend; work can still be placed there.</text>
  <text x="40" y="124" class="d-title">Delivery team</text>
  <text x="196" y="124" class="d-small">groupRow()</text>
  <text x="40" y="160" class="d-title">A Tester</text>
  <text x="40" y="178" class="d-small">Delivery / Engineer</text>
  <text x="303" y="206" text-anchor="middle" class="d-small">120%</text>
  <text x="385" y="206" text-anchor="middle" class="d-small">180%</text>
  <text x="467" y="206" text-anchor="middle" class="d-small">80</text>
  <text x="40" y="244" class="d-mono">resourceBlock()</text>
  <text x="40" y="262" class="d-small">ONE details cell for the person,</text>
  <text x="40" y="278" class="d-small">however many assignments they</text>
  <text x="40" y="294" class="d-small">have. Task names live on the bars.</text>
  <text x="676" y="149" class="d-small">overAllocationBar()</text>
  <text x="549" y="174" text-anchor="middle" class="d-small">100%</text>
  <text x="631" y="174" text-anchor="middle" class="d-small">180%</text>
  <text x="876" y="174" text-anchor="middle" class="d-small">80%</text>
  <text x="516" y="198" class="d-small">summary line: one cell per bucket, allocationsForResource()</text>
  <text x="516" y="212" class="d-small">shaded by allocationClass()</text>
  <text x="520" y="238" class="d-small">Atlas | Data cutover &ndash; 80% for 12 work days</text>
  <text x="520" y="266" class="d-small">Harbour | Integration test &ndash; 100% for 18 work days</text>
  <text x="844" y="244" class="d-small">absence</text>
  <text x="844" y="260" class="d-small">Band()</text>
  <text x="516" y="290" class="d-small">taskLine(), one per assignment. The label carries project, task,</text>
  <text x="516" y="304" class="d-small">allocation, working days and progress, and travels along the bar</text>
  <text x="516" y="318" class="d-small">as you scroll: labelWindow().</text>
  <text x="600" y="343" class="d-small">Available: 6.4h/d for 5 work days</text>
  <text x="516" y="366" class="d-small">availabilityBar(): spare capacity, in hours per day</text>
  <text x="44" y="400" class="d-small">Below all this, ppm-resource-management-features.js injects eight</text>
  <text x="44" y="416" class="d-small">panels: heatmap, capacity, utilisation, skills, runway, demand,</text>
  <text x="44" y="432" class="d-small">availability, scenarios. Separate module, separate markup and</text>
  <text x="44" y="448" class="d-small">separate arithmetic. It does not know the Gantt exists.</text>
  <text x="612" y="400" class="d-small">Hover card, placed at the pointer:</text>
  <text x="612" y="416" class="d-small">person, project, task, status, full</text>
  <text x="612" y="432" class="d-small">dates, allocation, progress, clashes.</text>
  <text x="612" y="448" class="d-small">Click a bar to edit its allocation.</text>
  `,
  "<b>Nothing in the timeline is stored.</b> Every bar is a plan task read through " +
    "<code>PPMStore</code>; every shaded cell is a recomputed peak. The frozen left pane is " +
    "<code>detailWidth()</code>, which is why toggling a metric column moves the timeline's " +
    "start and has to be accounted for in <code>buildTimeline()</code> and in " +
    "<code>labelWindow()</code>'s viewport width."
)}

<p>
  Two things in that picture are recent and easy to get wrong if you are working from an older
  mental model. The left pane is one cell per <i>person</i>, not one per assignment:
  <code>taskRow()</code> is gone and <code>taskLine()</code> replaced it, which is what gave the
  timeline back the widest column on the page. And the column headers are dates at every zoom,
  including a day zoom that did not exist before. Section 45 of the harness asserts both, so an
  attempt to reinstate either fails the build rather than quietly disagreeing with this diagram.
</p>

<h3>What the timeline draws, line by line</h3>
<div class="scroll"><table>
<thead><tr><th class="w-layer">Layer</th><th>What it is</th><th>Built by</th></tr></thead>
<tbody>
<tr><td><b>Column headers</b></td><td>Dates only, at every zoom. Day zoom reads "Mon 10 Aug". Week columns used to lead with a week number, which is a calendar fact almost nobody holds in their head, ahead of the date people navigate by.</td><td><code>bucketLabel()</code></td></tr>
<tr><td><b>Weekend columns</b></td><td>Hatched grey. Excluded from every duration and from allocation, availability and over-allocation - but still real columns, because release weekends happen and a view that hid them could not show that work.</td><td><code>isWeekend()</code>, <code>timelineCells()</code></td></tr>
<tr><td><b>Red over-allocation bars</b></td><td>One per run of consecutive days at the same over-allocation, labelled once. Drawn on the resource row, because over-allocation belongs to the person on that day rather than to any one task.</td><td><code>overAllocationRuns()</code>, <code>overAllocationBar()</code></td></tr>
<tr><td><b>The left pane</b></td><td><b>One cell per person</b>, spanning their whole block. Every line used to carry its own, so somebody on eight assignments produced eight cells - the name once, then the task name repeated beside a bar that already said it.</td><td><code>resourceBlock()</code></td></tr>
<tr><td><b>Assignment bars</b></td><td>One line each, carrying the whole sentence: plan, task, allocation, work days and progress. All of it moved onto the bar, which is where somebody reading along a row is already looking.</td><td><code>taskLine()</code></td></tr>
<tr><td><b>Unscheduled work</b></td><td>An assignment with an owner and no dates cannot be placed on a timeline. It is drawn hatched at the left of its line and counted in the left pane, rather than vanishing.</td><td><code>taskLine()</code></td></tr>
<tr><td><b>Spare capacity</b></td><td>Grey bars in the gaps - "Available: 6.4h/d for 5 work days". The half of the picture the coloured bars do not show: without it the view answers "who is busy" rather than "who can take this".</td><td><code>availabilityRuns()</code>, <code>availabilityBar()</code></td></tr>
<tr><td><b>Hover card</b></td><td>Person, plan, task, status, from, to, allocation, project. One element for the page, moved and repopulated - at day zoom there can be several hundred bars.</td><td><code>showAssignmentCard()</code></td></tr>
</tbody></table></div>

<div class="bad">
  <b>Durations are working days, and only one function decides that</b>
  <code>PPMPlanning.workingDaysBetween()</code>. A local copy of it was written in
  <code>resource-management-page.js</code> while building the timeline and deleted before it
  shipped, the capacity tab, the heatmap, the runway projection and the demand form all
  call the shared one, and two implementations of "how long is this in working days" is exactly
  how a Gantt starts disagreeing with a report built from the same data.
</div>

<h3>The guard scans this application only</h3>
<p>
  <code>applyControlPermissions()</code> finds every interactive control, works out which
  permission it needs from its <code>data-permission</code> attribute, and disables it if the
  signed-in person does not hold that permission. A control that looks like it changes data and
  carries no attribute is disabled too, and reported to the console, failing closed, so
  forgetting to tag a new button is loud rather than silent.
</p>
<p>
  It used to query <code>document</code>. A browser extension that injects interactive UI into the
  page, a sidebar, a recorder, a toolbar, therefore had its buttons scanned as
  though they were ours, and any whose label contained <i>edit</i>, <i>delete</i>, <i>save</i> and
  so on was disabled. The user's extension stopped working, on this site alone, with no visible
  cause. The console warning named controls that exist nowhere in this codebase, which is worse
  than noise: it is a false report of a defect, and it hides the real ones underneath it.
</p>
<p>
  The scan is scoped to <code>APP_REGIONS</code> now &mdash; <code>header</code>,
  <code>nav</code>, <code>main</code>, the dialogue containers and the session bar. Everything
  inside those is either shipped markup or injected by this application. Nothing else on the page
  is any of our business.
</p>

<div class="warn">
  <b>Scoping trades one failure for another, so it needs a gate</b>
  A control outside every listed region is now not guarded at all, and nothing about the page
  would look wrong. Gate 6h walks the tag stream of every shipped page keeping the open-element
  stack, and fails if any control has no listed ancestor. Add a new kind of top-level dialogue
  without listing its class and the build stops. It also asserts the guard still calls
  <code>ownControls()</code>, because reverting to <code>document.querySelectorAll</code> would
  otherwise pass every other check in the suite.
</div>

<div class="note">
  <b>None of this is the security boundary</b>
  Worth restating wherever permission code appears. Disabling a control is user experience: it
  stops the tool inviting somebody to attempt what the database will refuse. If the guard misses
  a control entirely, the button stays enabled, the request goes to PostgreSQL, and RLS or the
  workflow function declines it. The user sees an error instead of a greyed-out button. That is a
  worse experience and not a breach.
</div>

<h3>Labels that follow the viewport</h3>
<p>
  A bar is absolutely positioned inside <code>.timeline-row</code> at the offset its dates give
  it, and its label sits at its start. Once a bar is longer than the window, scrolling into it
  leaves a rectangle with no text on it, the label has gone off to the left with the part
  of the bar nobody is looking at.
</p>
<p>
  <code>labelWindow(barLeft, barWidth, viewLeft, viewWidth)</code> answers where the label should
  sit and how much room it has. Everything is in the timeline's own coordinate space, the
  one <code>spanGeometry()</code> writes bars in, so the function never has to know a
  scroller exists. It is what makes it testable, because the page script binds to a dozen DOM elements
  at load and cannot run in the harness, but this function can, and section 46 exercises it
  against the boundary cases directly rather than pattern-matching the source.
</p>

<h4>Why <code>viewLeft</code> is simply <code>scrollLeft</code></h4>
<p>
  Worth deriving once, because it looks as though the detail pane's width ought to be subtracted
  somewhere and it is not. <code>.row-details</code> is <code>position: sticky; left: 0</code>, so
  it occupies viewport x from 0 to <code>detailWidth</code> at every scroll position.
  <code>.timeline-row</code> begins at content x = <code>detailWidth</code>, so a bar at
  <code>left: barLeft</code> sits at viewport x =
  <code>detailWidth &minus; scrollLeft + barLeft</code>. It clears the sticky pane when that is at
  least <code>detailWidth</code>, which reduces to <code>barLeft &ge; scrollLeft</code>. The
  detail width cancels. It does <i>not</i> cancel at the right-hand edge, which is why
  <code>viewWidth</code> is <code>clientWidth &minus; detailWidth()</code>.
</p>

<h4>The three things that keep it cheap</h4>
<dl class="fields">
  <dt>Geometry is read once per render, not per scroll</dt>
  <dd>Bar positions cannot change without a re-render, so <code>collectBarLabels()</code> reads
      <code>offsetLeft</code> and <code>offsetWidth</code> in a single pass at render time.
      Reading them during a scroll would force layout on every bar sixty times a second, which
      would cost considerably more than the feature is worth.</dd>
  <dt>Scroll events are coalesced to one frame</dt>
  <dd>A scroll fires many times between two painted frames. The handler schedules one
      <code>requestAnimationFrame</code> and ignores the rest until it has run.</dd>
  <dt>Only changed labels are written</dt>
  <dd>Each entry remembers the offset last applied. A bar fully visible or fully off screen gives
      the same answer every frame and is skipped, so only the handful crossing the left edge at
      any moment are touched. This is what makes it viable on a chart with several hundred bars.</dd>
</dl>

<div class="note">
  <b><code>transform</code>, not <code>left</code> or <code>margin</code></b>
  It is the one property here that moves something without asking the browser to lay the row out
  again. The stacking context it creates is inert, the label carries no z-index and nothing
  is positioned against it. <code>will-change</code> is not set, on purpose, because it would promote
  every bar in the chart to its own compositor layer for a transform that changes on a few of them
  at a time, and layer count is what makes a long timeline scroll badly to begin with.
</div>

<div class="warn">
  <b>An assertion here passed for the wrong reason</b>
  The first version of the check for the scroll binding looked for
  <code>addEventListener("scroll" &hellip; passive: true)</code> anywhere in the file. It passed
  with the entire feature deleted, because it was matching the card-hiding listener bound two
  hundred lines earlier. It names the handler now. The general rule, of which this is the third
  instance recorded in this document: a check written against a <i>pattern</i> that also appears
  elsewhere in the same file is not a check. Break the thing on purpose and watch the assertion
  fail before believing it.
</div>

<h3>Peak allocation, and why it is not an average</h3>
<p>
  A bucket is a week, month, quarter or year. Two tasks at 80% and 100% that overlap for one day
  inside a week produce a peak of 180% for that week, not a prorated 96%. That is intended, because the
  question the Gantt answers is "is this person over-committed at any point", and an average
  hides exactly the days that matter.
</p>
<p>
  <code>allocationsForResource()</code> computes it by taking the boundaries where the total can
  change, the bucket start, and each task start inside the bucket, summing the
  allocation of every task live at each boundary, and keeping the largest. It is O(tasks per
  bucket squared) and that is fine at this scale; if it ever is not, the fix is a sweep line over
  sorted boundaries, not caching.
</p>
<div class="warn">
  <b>A task with no dates contributes nothing, silently</b>
  <code>buildTimeline()</code> filters to tasks with both a start and a finish, so a plan task
  with an owner and no dates never appears and never counts towards allocation. It is a real
  situation, a task can be owned before it is scheduled, and there is currently no
  indication on this page that it happened. See <a href="#backlog">known gaps</a>.
</div>

<h3>Capacity, which is a different question entirely</h3>
<p>
  The Gantt deals in <b>percentages of a person</b>. The capacity and utilisation tabs deal in
  <b>hours</b>, and the two never mix. Hours come from one function:
</p>
<pre><code>PPMPlanning.availableCapacity(resource, startIso, endIso)
// -> { contracted, absence, nonWorking, operational, other, available }
//
// available = contracted
//           - approved absence in the period
//           - nonWorkingHoursPerWeek           x weeks
//           - fixedOperationalHoursPerWeek     x weeks
//           - otherUnavailableHoursPerWeek     x weeks
// floored at zero</code></pre>
<p>
  Weeks are working days divided by five, floored at one fifth so that a single-day period does
  not divide by zero. Every deduction is per-week and prorated; only absence is looked up as
  actual dated rows.
</p>
<div class="bad">
  <b>Put a capacity formula anywhere but ppm-planning-utils.js and two screens will disagree</b>
  This has happened. The heatmap, the capacity tab, the utilisation tab, the runway projection
  and the demand form all call the same function so that a person's available hours is
  one number. A local copy "just for this panel" is how a report starts contradicting the screen
  it was built from.
</div>

<h3>Demand records, which <i>are</i> stored</h3>
<p>
  A <code>resourceDemand</code> row is an explicit request for somebody's time, independent of
  any plan task, though it may name one through <code>linkedTaskId</code>. Two
  allocation methods:
</p>
<ul>
  <li><b>Percentage</b>, hours are derived from available capacity over the period.</li>
  <li><b>Hours</b>, the number is taken as given and prorated by working days when a
      period is narrower than the demand.</li>
</ul>
<p>
  <code>taskAssignments()</code> in the features module <b>excludes</b> a plan task
  that an assigned demand row already links to, keyed
  <code>projectCode|taskId|resourceId</code>. Without that, a task with a matching demand record
  would be counted twice, once as a plan task and once as demand, and every
  utilisation figure for that person would be roughly double.
</p>

<h3>Scenarios, and the one place this feature is transactional</h3>
<p>
  A scenario is a working copy of demand: change dates, people or allocation without touching
  live demand. Publishing replaces live demand with the scenario's, and it is the only part of
  resource management that goes through a transactional workflow rather than ordinary saves.
</p>
<pre><code>await PPMChildDatabase.commitResourceScenarioWorkflow({ operation: "publish", scenario });</code></pre>
<p>
  It has to be atomic because publishing writes two collections &mdash;
  <code>resourceDemand</code> and <code>resourceScenarios</code>, and a half-published
  scenario is worse than an unpublished one. The workflow function throws on every failure it can
  detect, so the caller has a <code>try/catch</code> and no result to check.
  <code>private.guard_resource_scenario_workflow_write</code> refuses any attempt to change those
  columns outside the workflow, which is why there is no local fallback: the database rejects it,
  and for months that rejection was invisible.
</p>

<h3>How to change it</h3>

<div class="recipe">
<h4>Change what counts as over-allocated</h4>
<ol class="recipe-steps">
<li><code>administration.html</code><span>Nothing to change. The thresholds are configuration, in the <code>resourceConfig</code> singleton, editable in the interface.</span></li>
<li><code>allocationClass()</code><span>Only if you need a new band rather than a new number. Add the class here and to <code>ppm-resource-management.css</code>.</span></li>
</ol>
<p class="recipe-note">Resist adding a constant. Two of these were constants once and the request to change them was a code change.</p>
</div>

<div class="recipe">
<h4>Add a metric column to the left pane</h4>
<ol class="recipe-steps">
<li><code>resource-management-page.js</code><span><code>renderColumnOptions()</code>, add the key and label to the definitions list.</span></li>
<li>same file<span><code>resourceBlock()</code>, compute the value and emit it with <code>metricMarkup(key, value, tone)</code>. Use a tone class, never a colour: style attributes are blocked.</span></li>
<li>same file<span>Check <code>RESOURCE_METRIC_WIDTH</code> still suits the widest value. <code>detailWidth()</code> and <code>detailGridColumns()</code> derive from it, so nothing else needs touching.</span></li>
<li><code>currentView()</code><span>Nothing, it already saves <code>[...visibleResourceColumns]</code>. A saved view made before your column exists simply will not include it, which is correct.</span></li>
<li><code>VERIFY-ALL.mjs</code><span>Run it. Gate 6 fails if you reached for a style attribute.</span></li>
</ol>
</div>

<div class="recipe">
<h4>Change what happens when somebody edits an allocation</h4>
<ol class="recipe-steps">
<li>Understand where it goes<span>Clicking a bar edits the <b>project-plan task</b> it was derived from, not anything on this page. There is no assignments record; storing the edit here would give the plan and this view two different answers, and the plan would keep saying the old one.</span></li>
<li><code>openAllocationEditor()</code><span>Checks <code>plan.edit</code> for that project - the plan's own permission, not the resource page's. Somebody who cannot edit the plan cannot change its allocations from here either.</span></li>
<li><code>saveAllocation()</code><span>Reads the collection, changes one task, hands the whole thing to <code>replaceAll</code>, which writes only what differs. Then <code>loadData()</code> and <code>renderGantt()</code>: the bar, the person's totals, the over-allocation runs and the spare capacity all change together, and re-deriving is the only way they stay consistent.</span></li>
<li>Row-level security<span>Whatever the browser allows, <code>public.project_plans</code> decides. A refused write comes back as <code>denied</code> and the dialogue stays open with the message.</span></li>
</ol>
</div>

<div class="recipe">
<h4>Change how allocation is calculated</h4>
<ol class="recipe-steps">
<li>Decide which question you are changing<span>Percentages of a person (the Gantt) or hours of capacity (the tabs). They are separate and conflating them is the commonest mistake here.</span></li>
<li><code>allocationsForResource()</code><span>For the per-bucket peak. Read the boundary-sampling comment first, changing it to an average is a product decision, not a refactor.</span></li>
<li><code>ppm-planning-utils.js</code><span>For anything in hours. One function, called by five screens.</span></li>
<li><code>STAGE-14-HARNESS.mjs</code><span>Add a case with a known answer. Allocation arithmetic is the kind that looks right and is off by a day.</span></li>
</ol>
</div>

<div class="recipe">
<h4>Add a field to a demand record</h4>
<ol class="recipe-steps">
<li>Migration<span>Add the column to <code>resource_demand</code>, or leave it in the payload if nothing queries it. See <a href="#data-model">data model</a> for which.</span></li>
<li><code>ppm-child-database.js</code><span>Add it to the <code>resourceDemand</code> entry's <code>fields</code> if it became a column.</span></li>
<li><code>SCHEMA-MANIFEST.json</code><span>Update it, or the drift gate fails, which is the point.</span></li>
<li><code>ppm-resource-management-features.js</code><span><code>modalMarkup()</code> for the control, <code>openDemand()</code> to populate it, <code>saveDemandForm()</code> to read it.</span></li>
<li><code>renderDemand()</code><span>Add the column if it should be visible in the table.</span></li>
<li><code>node VERIFY-ALL.mjs</code><span>Schema drift and the harness both check the registry against the database.</span></li>
</ol>
</div>

<div class="recipe">
<h4>Add a tab to the features panel</h4>
<ol class="recipe-steps">
<li><code>injectInterface()</code><span>Add <code>["myTab", "My tab"]</code> to the tab list and a <code>&lt;section id="rmPanelMyTab" data-panel="myTab"&gt;</code> to <code>panelMarkup()</code>.</span></li>
<li><code>renderActivePanel()</code><span>Add the branch that calls your render function.</span></li>
<li>Your render function<span>Read through <code>PPMStore</code> and <code>PPMPlanning</code>. Do not read localStorage, the gate will fail the build, and there is nothing there.</span></li>
<li>Permissions<span>Put <code>data-permission="resourceManagement.view"</code> on the tab button. <code>PPMAuth</code> disables controls after render, so call <code>applyControlPermissions()</code> if you render after startup.</span></li>
</ol>
</div>

<div class="warn">
  <b>Before changing anything here, know which module you are in</b>
  The Gantt and the tabs sit on the same page, look like one feature, and share no code. A change
  to "resource management" that only touches one of them will look half-applied. The heatmap and
  the Gantt in particular answer nearly the same question in different units, which is why they
  can disagree if a formula is copied rather than called.
</div>
`);

/* ------------------------------------------------------------------------- */

add("security", "Security model", `
<h3>Layers, in the order they apply</h3>
<ol class="steps">
  <li><b>Supabase Auth</b>, email and password, then TOTP. No password is
      stored by this application.</li>
  <li><b>AAL2 restrictive policy</b>, on all 37 tables. Until the
      authenticator step completes, every table returns nothing. A restrictive
      policy ANDs with everything else, so it cannot be bypassed by a permissive
      policy elsewhere.</li>
  <li><b>Row-level security</b> &mdash; 150 policies deciding, per row, what this
      identity may read and write.</li>
  <li><b>Trigger guards</b>, refuse writes that are structurally wrong
      regardless of privilege: approved budgets outside the workflow, baseline dates
      outside a rebaseline, decided stage gates, identity changes.</li>
  <li><b>Grants</b>, no DELETE on child tables; no UPDATE or DELETE on
      append-only tables; TRUNCATE, TRIGGER and REFERENCES never granted.</li>
</ol>

<h3>The access functions</h3>
<div class="scroll"><table>
<thead><tr><th>Function</th><th>Answers</th></tr></thead>
<tbody>
<tr><td><code>private.has_permission(text)</code></td><td>Does the signed-in person's role include this permission?</td></tr>
<tr><td><code>private.has_portfolio_wide_access()</code></td><td>Is their scope Portfolio-wide?</td></tr>
<tr><td><code>private.can_access_project(text)</code></td><td>May they reach this project code, under all four scope rules?</td></tr>
<tr><td><code>private.can_access_person(uuid)</code></td><td>May they see this person?</td></tr>
</tbody></table></div>
<p>
  All are <code>STABLE SECURITY DEFINER</code> with <code>set search_path = ''</code>,
  and all require the viewer to be active with account status Active.
</p>

<h4>What <code>can_access_project</code> actually checks</h4>
<ul>
  <li>Scope is Portfolio-wide; or</li>
  <li>the code is in their <code>selected_project_codes</code>; or</li>
  <li>they are the project manager, sponsor or project lead by foreign key; or</li>
  <li>their resource id appears in one of the project's named-role fields in the
      payload, project manager, sponsor, project lead, deputy, business
      analyst, technical lead, benefit owner, financial owner or creator; or</li>
  <li>they hold a resource demand row on the project; or</li>
  <li>scope is Team projects and their team leads it, is coded on a demand row, is
      assigned demand, or owns a plan task on it.</li>
</ul>
<div class="note">
  <b>Both the foreign keys and the payload identifiers are checked</b>
  Because both exist and either can be the one that is populated. When seeding or
  importing, set both, or scoped users will not see records they are named on.
</div>

<h3>The eight policies that read as unconditionally true, on purpose</h3>
<p>
  A reviewer counting policies will find eight <code>SELECT</code> policies whose
  condition is literally <code>true</code>:
</p>
<p>
  <span class="pill">financial_categories</span>
  <span class="pill">lifecycle_templates</span>
  <span class="pill">lifecycle_mandatory_rules</span>
  <span class="pill">reference_data</span>
  <span class="pill">reporting_calendars</span>
  <span class="pill">reporting_periods</span>
  <span class="pill">rag_config</span>
  <span class="pill">resource_config</span>
</p>
<p>
  All eight are global configuration: the contents of dropdowns, the stage
  definitions, the reporting calendar, the RAG tolerances and the cost category names.
  Every signed-in person needs them to render any page at all, and none of them says
  anything about a project, a person or a number. They are still behind the AAL2
  restrictive policy, so an unauthenticated caller gets nothing.
</p>
<div class="warn">
  <b>Do not narrow these without a reason, and do not add to the list without one</b>
  <code>resource_absence</code> used to be in it and should never have been - absence
  records name individuals and their long-term absence. It was narrowed to follow
  person visibility. The test to apply is simple: if a row is about somebody or
  something, it needs a scope; if it is a dropdown option, it does not.
</div>

<h3>Identity rules the database enforces</h3>
<div class="scroll"><table>
<thead><tr><th>Rule</th><th>Why</th></tr></thead>
<tbody>
<tr><td><code>auth_user_id</code> is never writable from the application, at any permission level</td><td>It decides who someone <i>is</i>. Linking is owner-only, via <code>public.ppm_link_person_login()</code>.</td></tr>
<tr><td><code>legacy_resource_id</code> cannot change once set</td><td>Every child record joins on it.</td></tr>
<tr><td>Nobody can change their own role, scope, account status or permissions</td><td>Prevents self-escalation.</td></tr>
<tr><td>Changing anyone's access requires <code>users.manage</code></td><td>Only the System Administrator has it.</td></tr>
</tbody></table></div>

<h4>How the guard tells an application write from an administrative one</h4>
<pre><code>from_application := (select auth.uid()) is not null;</code></pre>
<p>
  A browser session always carries a JWT. The SQL editor, a migration and an
  That is where the line falls, and it is why seed scripts can set
  access roles directly while the application cannot.
</p>

<h3>Permission and role model</h3>
<p>
  ${ALL_PERMISSIONS.length} permission identifiers, ${ROLE_NAMES.length} roles, four
  access scopes. The definitive matrix is in the
  <a href="USER-SPECIFICATION.html#matrix">user specification</a>, generated from the
  same source. Roles live in <code>ppm-auth-utils.js</code> and are mirrored in the
  database for policy evaluation, so a change must be made in both.
</p>
`);

/* ------------------------------------------------------------------------- */

add("triggers", "Triggers and what fires when", `
<p>
  132 triggers across ${COUNTS.tables} tables. They fall into five families. Trigger timing is
  worth internalising, because it determines what a seed or migration must supply.
</p>

<div class="scroll"><table>
<thead><tr><th>Family</th><th>Timing</th><th>Does</th></tr></thead>
<tbody>
<tr>
  <td><code>*_audit</code></td><td>AFTER INSERT / UPDATE / DELETE</td>
  <td>Writes to <code>public.audit_log</code> with the actor resolved from <code>auth.uid()</code>, and a field-level diff on update. Wrapped in an exception handler, so a failure to audit warns rather than blocking the write.</td>
</tr>
<tr>
  <td><code>*_key</code></td><td>BEFORE UPDATE</td>
  <td>Maintains derived key columns. <b>Does not fire on insert</b>, an insert must supply <code>record_key</code> itself.</td>
</tr>
<tr>
  <td><code>*_lock</code></td><td>BEFORE UPDATE</td>
  <td>Optimistic lock: increments <code>version</code>, refuses a stale one.</td>
</tr>
<tr>
  <td><code>*_guard</code></td><td>BEFORE INSERT and/or UPDATE</td>
  <td>Refuses structurally invalid writes. See below.</td>
</tr>
<tr>
  <td><code>*_immutable</code></td><td>BEFORE UPDATE / DELETE</td>
  <td>Refuses any change at all. Used on <code>audit_log</code> and <code>rag_history</code>.</td>
</tr>
</tbody></table></div>

<h3>The guards, and how to work with them</h3>
<div class="scroll"><table>
<thead><tr><th>Guard</th><th>Refuses</th><th>Escape</th></tr></thead>
<tbody>
<tr>
  <td><code>guard_project_financial_approval_fields</code></td>
  <td>Introducing or changing an approved budget, its version, request id, approver or approval timestamp, including via the payload</td>
  <td><code>set local ppm.financial_workflow = 'on'</code></td>
</tr>
<tr>
  <td><code>guard_financial_approval_workflow_write</code></td>
  <td>Any write to <code>financial_approval_requests</code></td>
  <td>Same setting</td>
</tr>
<tr>
  <td><code>guard_plan_baseline_workflow_write</code></td>
  <td>Any write to <code>plan_baselines</code></td>
  <td><code>set local ppm.baseline_workflow = 'on'</code></td>
</tr>
<tr>
  <td><code>guard_plan_baseline_request_workflow_write</code></td>
  <td>Any write to <code>plan_baseline_requests</code></td>
  <td>Same setting</td>
</tr>
<tr>
  <td><code>guard_project_plan_baseline_dates</code></td>
  <td>Setting or changing task baseline dates once the project has an approved baseline</td>
  <td>Same setting</td>
</tr>
<tr>
  <td><code>guard_resource_scenario_workflow_write</code></td>
  <td>Creating a scenario in any status but Draft; editing a published or rejected one</td>
  <td><code>set local ppm.resource_scenario_workflow = 'on'</code></td>
</tr>
<tr>
  <td><code>guard_stage_gate_workflow_write</code></td>
  <td>Inserting a gate that is not a clean Draft; editing a submitted or decided gate; changing workflow history</td>
  <td><b>Insert: none.</b> Update: <code>set local ppm.stage_gate_workflow = 'on'</code></td>
</tr>
<tr>
  <td><code>guard_person_identity</code></td>
  <td>Attaching or changing a login; changing a resource id; self-editing access; access changes without <code>users.manage</code></td>
  <td>None from the application. Owner connection only.</td>
</tr>
</tbody></table></div>

<div class="bad">
  <b>Stage gates cannot be inserted in a decided state</b>
  <code>guard_stage_gate_workflow_write</code> handles the INSERT case <i>before</i>
  it consults the workflow setting, so there is no escape hatch, not for the
  application, not for the table owner. To seed governance history you insert a
  Draft and then update it with the setting on. It is the only correct path, and it
  exercises the guard rather than going around it.
</div>

<div class="warn">
  <b><code>set local</code>, never <code>set</code></b>
  Transaction-scoped, so the relaxation expires on commit or rollback. A session-level
  setting on a pooled connection would leak the escape hatch into unrelated requests.
</div>
`);

/* ------------------------------------------------------------------------- */

add("workflows", "Transactional workflows", `
<p>
  Four state changes span several collections and must be all-or-nothing. Each is a
  <code>SECURITY DEFINER</code> function with <code>set search_path = ''</code>,
  executable by <code>authenticated</code>, that sets the matching workflow GUC
  internally and commits everything in one transaction.
</p>

<div class="scroll"><table>
<thead><tr><th>Function</th><th>Commits together</th><th>Adapter entry point</th></tr></thead>
<tbody>
<tr>
  <td><code>ppm_commit_stage_gate_workflow</code></td>
  <td>The gate, the actions arising, the linked decision, and the project's stage</td>
  <td><code>commitStageGateWorkflow()</code></td>
</tr>
<tr>
  <td><code>ppm_commit_baseline_workflow</code></td>
  <td>The rebaseline request decision, the new baseline version, and the plan's baseline dates</td>
  <td><code>commitBaselineWorkflow()</code></td>
</tr>
<tr>
  <td><code>ppm_commit_financial_workflow</code></td>
  <td>The budget request decision, the financial record's approved budget, and the cost lines</td>
  <td><code>commitFinancialWorkflow()</code></td>
</tr>
<tr>
  <td><code>ppm_commit_resource_scenario_workflow</code></td>
  <td>The scenario's publication or rejection, and the demand rows it becomes</td>
  <td><code>commitResourceScenarioWorkflow()</code></td>
</tr>
</tbody></table></div>

<h3>Every workflow takes expected versions</h3>
<p>
  Each function takes <code>p_expected_*_version</code> parameters and refuses if any
  row has moved. The optimistic lock therefore covers the whole transaction, not each
  row independently, without which a gate could be approved against a project
  someone else had already moved.
</p>

<h3>The client side, in order</h3>
<ol class="steps">
  <li>Flush pending writes for every collection in the workflow group, so the
      transaction is not built on unsaved local state.</li>
  <li>Capture the versions currently loaded.</li>
  <li>Call the RPC with the payload and those versions.</li>
  <li>On success, re-hydrate the affected collections, the database may have
      changed more than was sent.</li>
  <li>On version conflict, surface it and reload. Do not retry with a fresh version.</li>
</ol>
<p>The groups are exported so a caller cannot guess them wrong:</p>
<pre><code>PPMChildDatabase.STAGE_GATE_WORKFLOW_MODULES  // actions, decisions, stageGates
PPMChildDatabase.BASELINE_WORKFLOW_MODULES    // planBaselines, baselineRequests
PPMChildDatabase.FINANCIAL_WORKFLOW_MODULES   // financials, financialEntries, financialApprovals
PPMChildDatabase.RESOURCE_WORKFLOW_MODULES    // resourceDemand, resourceScenarios</code></pre>

<h3>Other public functions</h3>
<div class="scroll"><table>
<thead><tr><th>Function</th><th>Callable by</th><th>Purpose</th></tr></thead>
<tbody>
<tr><td><code>ppm_complete_first_run()</code></td><td><code>authenticated</code></td><td>Clears the forced password-change flag after first-run setup</td></tr>
<tr><td><code>ppm_link_person_login(email, resource_id, require_reset)</code></td><td><b>Owner only</b>, revoked from <code>authenticated</code></td><td>Attaches a Supabase Auth user to a person record</td></tr>
<tr><td><code>rls_auto_enable()</code></td><td>Owner only</td><td>Event trigger helper: a new public table gets RLS enabled automatically</td></tr>
</tbody></table></div>
<div class="ok">
  <b>Seven functions exist in <code>public</code>, and <code>anon</code> can call none of them</b>
  Worth re-checking after any migration, see the trap about
  <code>revoke ... from public</code>.
</div>
`);

/* ------------------------------------------------------------------------- */

add("audit-system", "The audit system", `
<h3>Where entries come from</h3>
<p>
  <b>Only the database writes audit entries.</b> Triggers on all 37 tables record
  every insert, update and delete, resolving the actor from <code>auth.uid()</code>
  against <code>public.people</code>, and computing a field-level diff on update.
</p>

<div class="bad">
  <b>That diff used to skip <code>legacy_payload</code>, and that was almost everything</b>
  The typed columns are a handful of fields projected out of the payload so the database can
  filter and constrain on them. Everything else a person edits, a decision's rationale and
  outcome, a RAID item's mitigation, an action's update, a status report's commentary, is
  inside the payload. With it skipped, the loop found no changed column, hit
  <code>if jsonb_array_length(changed) = 0 then return NEW</code>, and wrote <b>no audit row at
  all</b>. The change saved, the version incremented, and the trail showed nothing.
  <br /><br />
  Found in the pilot: a decision recorded with four fields filled in, row at version 2, and the
  most recent audit entry for that table two days older.
  <br /><br />
  <b>Stage 19</b> added <code>private.payload_changes()</code>, which diffs inside the payload,
  one entry per changed key, ignoring the bookkeeping keys that change on every save
  (<code>updatedAt</code>, <code>updatedBy</code>, versions, adapter fields) and capped at 80
  entries with a count of the rest. <b>Nothing backfills</b>, every edit before that
  migration is not in the trail and cannot be reconstructed, because the before values are gone.
</div>
<p>Four audit functions, differing only in how they name the record:</p>
<ul>
  <li><code>record_audit</code>, foundation tables, keyed by business code</li>
  <li><code>record_child_audit</code>, project child tables, keyed
      <code>project_code / record_key</code></li>
  <li><code>record_scope_audit</code>, scope-keyed tables</li>
  <li><code>record_rag_history_audit</code>, status history, which records
      calculated-versus-reported and every override with its justification</li>
  <li><code>record_resource_payload_audit</code>, demand and scenarios, against a named
      field list. It was diffing inside the payload before the other three did, which is where
      the pattern came from</li>
</ul>
<p>
  The first three all call <code>private.payload_changes()</code>. If you add a fourth, call it
  too, or that table's edits will be invisible in exactly the way described above.
</p>

<h3>Immutability</h3>
<p><code>public.audit_log</code> and <code>public.rag_history</code> are append-only, enforced three ways so no single mistake unlocks them:</p>
<ol>
  <li>No UPDATE or DELETE grant to <code>authenticated</code>.</li>
  <li>No policy permitting UPDATE or DELETE.</li>
  <li>A row-level trigger that raises on either.</li>
</ol>
<div class="bad">
  <b>The immutability trigger refuses the table owner too</b>
  Confirmed by trying it. To remove seeded rows you must
  <code>alter table ... disable trigger</code>, delete, and re-enable, inside
  one transaction. The demo removal script does exactly that. Never leave it
  disabled.
</div>

<h3>Provenance</h3>
<div class="scroll"><table>
<thead><tr><th>Tag</th><th>Source</th></tr></thead>
<tbody>
<tr><td><code>verified</code></td><td><code>public.audit_log</code>, trigger-written, immutable</td></tr>
<tr><td><code>imported</code></td><td><code>public.legacy_audit_history</code>, pre-migration browser events, imported once</td></tr>
<tr><td><code>local</code></td><td>Browser storage, residue from before Stage 14. Shown, clearly labelled.</td></tr>
</tbody></table></div>
<p>
  <code>PPMAudit.readAll()</code> merges all three, de-duplicating on
  <code>auditId</code> with the verified copy winning.
</p>
<div class="note">
  <b>Audit entries written by a migration or seed have no named actor</b>
  <code>auth.uid()</code> is null outside a browser session, so the actor columns are
  null. The trigger tolerates it. This is the trade for being able to seed access
  roles at all.
</div>
`);

/* ------------------------------------------------------------------------- */

add("walkthrough", "Worked example: adding a page, end to end", `
<p>
  One change, every layer, in order. The example is a <b>Lessons Learned</b> register: a
  project-scoped collection with its own page, its own permission and its own table. It is
  intentionally ordinary. Nothing here is special to lessons, and the same eleven steps
  build any new register.
</p>

<div class="note">
  <b>The order is not arbitrary</b>
  Database first, then the adapter, then the page. Each step is verifiable on its own, and doing
  it the other way round means writing a page against a shape that does not exist yet and
  discovering the mismatch at the end.
</div>

${diagram(
  "walkthrough",
  940,
  268,
  `
  <rect x="16" y="16" width="164" height="236" rx="8" class="d-box db" />
  <text x="98" y="40" text-anchor="middle" class="d-title">1&ndash;3  Database</text>
  <text x="30" y="66" class="d-small">Migration: table,</text>
  <text x="30" y="82" class="d-small">RLS, grants, triggers</text>
  <text x="30" y="106" class="d-small">Verification SQL</text>
  <text x="30" y="130" class="d-small">SCHEMA-MANIFEST</text>
  <text x="30" y="168" class="d-small">Checkable on its own:</text>
  <text x="30" y="184" class="d-small">apply it, then run</text>
  <text x="30" y="200" class="d-small">VERIFY-INVARIANTS.sql</text>

  <rect x="212" y="16" width="164" height="236" rx="8" class="d-box" />
  <text x="294" y="40" text-anchor="middle" class="d-title">4&ndash;5  Adapter</text>
  <text x="226" y="66" class="d-small">MODULES entry:</text>
  <text x="226" y="82" class="d-small">localKey, table, shape,</text>
  <text x="226" y="98" class="d-small">idField, fields</text>
  <text x="226" y="122" class="d-small">DATABASE_MODULES</text>
  <text x="226" y="160" class="d-small">PPMStore.lessons</text>
  <text x="226" y="176" class="d-small">now exists, for free,</text>
  <text x="226" y="192" class="d-small">with all nine methods</text>

  <rect x="408" y="16" width="164" height="236" rx="8" class="d-box accent" />
  <text x="490" y="40" text-anchor="middle" class="d-title">6&ndash;8  Page</text>
  <text x="422" y="66" class="d-small">lessons.html</text>
  <text x="422" y="90" class="d-small">lessons-page.js</text>
  <text x="422" y="114" class="d-small">nav link on all</text>
  <text x="422" y="130" class="d-small">20 pages</text>
  <text x="422" y="168" class="d-small">Reads and writes</text>
  <text x="422" y="184" class="d-small">only through</text>
  <text x="422" y="200" class="d-small">PPMStore</text>

  <rect x="604" y="16" width="164" height="236" rx="8" class="d-box warn" />
  <text x="686" y="40" text-anchor="middle" class="d-title">9&ndash;10  Access</text>
  <text x="618" y="66" class="d-small">ALL_PERMISSIONS</text>
  <text x="618" y="90" class="d-small">Role grants</text>
  <text x="618" y="114" class="d-small">PAGE_RULES</text>
  <text x="618" y="130" class="d-small">NAV_RULES</text>
  <text x="618" y="146" class="d-small">PAGE_EDIT_RULES</text>
  <text x="618" y="184" class="d-small">Interface only.</text>
  <text x="618" y="200" class="d-small">RLS is the boundary.</text>

  <rect x="800" y="16" width="124" height="236" rx="8" class="d-box store" />
  <text x="862" y="40" text-anchor="middle" class="d-title">11  Prove</text>
  <text x="814" y="66" class="d-small">Harness</text>
  <text x="814" y="90" class="d-small">section</text>
  <text x="814" y="114" class="d-small">Gates</text>
  <text x="814" y="138" class="d-small">Specs</text>
  <text x="814" y="176" class="d-small">Break it</text>
  <text x="814" y="192" class="d-small">deliberately</text>
  <text x="814" y="208" class="d-small">and watch</text>
  <text x="814" y="224" class="d-small">it fail</text>

  <path d="M180 134 L208 134" class="d-line strong" marker-end="url(#arrow)" />
  <path d="M376 134 L404 134" class="d-line strong" marker-end="url(#arrow)" />
  <path d="M572 134 L600 134" class="d-line strong" marker-end="url(#arrow)" />
  <path d="M768 134 L796 134" class="d-line strong" marker-end="url(#arrow)" />
  `,
  "<b>Each block is independently verifiable.</b> Apply the migration and run the invariants " +
    "before writing a line of JavaScript; register the collection and check " +
    "<code>PPMStore.lessons</code> answers in the console before building a page on it."
)}

<h3>1. The migration</h3>
<p>
  Copy the shape of an existing child table rather than inventing one. Every child table has the
  same skeleton, and the parts that look like boilerplate are the parts that make it safe.
</p>
<pre><code>create table public.project_lessons (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  project_code   text not null,
  record_key     text not null,
  legacy_payload jsonb not null default '{}'::jsonb,
  lesson_type    text,
  captured_on    date,
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (project_id, record_key)
);

alter table public.project_lessons enable row level security;
alter table public.project_lessons force row level security;

revoke all on public.project_lessons from public, anon;
grant select, insert, update on public.project_lessons to authenticated;
-- deliberately no delete: removal is deleted_at, which the audit trigger can see</code></pre>

<div class="scroll"><table>
<thead><tr><th>Column</th><th>Why it is there</th></tr></thead>
<tbody>
<tr><td><code>project_id</code> + <code>project_code</code></td><td>The uuid is the real link and drives the cascade; the code is what the browser thinks in. Both, always.</td></tr>
<tr><td><code>record_key</code></td><td>The business identifier the interface uses. Unique <i>per project</i>, not globally.</td></tr>
<tr><td><code>legacy_payload</code></td><td>The whole record as the browser holds it. Typed columns are projected out of it for the things the database needs to reason about; see <a href="#data-model">data model</a>.</td></tr>
<tr><td><code>version</code></td><td>Optimistic locking. A trigger increments it; the client sends the version it loaded.</td></tr>
<tr><td><code>deleted_at</code></td><td>Soft delete. There is no DELETE grant on any child table.</td></tr>
</tbody></table></div>

<p>Then the policies and triggers, which are the same four every time:</p>
<pre><code>create policy lessons_select on public.project_lessons for select to authenticated
  using (private.can_access_project(project_code));
create policy lessons_insert on public.project_lessons for insert to authenticated
  with check (private.can_access_project(project_code));
create policy lessons_update on public.project_lessons for update to authenticated
  using (private.can_access_project(project_code))
  with check (private.can_access_project(project_code));

-- the restrictive AAL2 policy every table carries
create policy lessons_aal2 on public.project_lessons as restrictive to authenticated
  using (private.session_is_aal2());

create trigger lessons_version before update on public.project_lessons
  for each row execute function private.bump_version();
create trigger lessons_audit after insert or update on public.project_lessons
  for each row execute function private.write_audit();</code></pre>

<div class="bad">
  <b>Two traps that have both bitten this codebase</b>
  <code>revoke ... from public</code> does not remove Supabase's implicit grant to
  <code>anon</code>, name <code>anon</code> explicitly.<br />
  A restrictive policy is <i>and</i>-ed with the permissive ones. Forget it and the table is
  readable one factor short of full authentication, which looks identical in testing because you
  are always at AAL2.
</div>

<h3>2. Verification SQL</h3>
<p>
  Add the table to <code>VERIFY-INVARIANTS.sql</code>: RLS enabled and forced, no
  <code>anon</code> grant, no DELETE grant, both triggers present, the restrictive policy
  present. This is what you run after applying the migration, before writing any JavaScript.
</p>

<h3>3. SCHEMA-MANIFEST.json</h3>
<p>
  Add the table and its typed columns. <code>SCHEMA-DRIFT-CHECK.mjs</code> cross-checks three
  descriptions of the schema, the manifest, the adapter registry and the migrations
 , and fails if they disagree. Skipping this fails the build, which is the point.
</p>

<h3>4. Register the collection</h3>
<p>
  In <code>ppm-child-database.js</code>, add an entry to <code>MODULES</code>:
</p>
<pre><code>"lessons": {
  "localKey": "ppmProjectLessons",
  "table": "project_lessons",
  "shape": "object",
  "idField": "lessonId",
  "projectField": "projectCode",
  "readOnly": false,
  "fields": [
    { "column": "lesson_type", "type": "text", "field": "lessonType" },
    { "column": "captured_on", "type": "date", "field": "capturedOn" }
  ]
},</code></pre>
<p>and add <code>"lessons"</code> to <code>DATABASE_MODULES</code>.</p>

<div class="ok">
  <b>That is all the integration needed</b>
  <code>PPMStore.lessons</code> now exists with <code>all</code>, <code>byId</code>,
  <code>forProject</code>, <code>read</code>, <code>get</code>, <code>save</code>,
  <code>saveMany</code>, <code>replaceAll</code> and <code>remove</code>. Hydration loads it,
  the store holds it, the pending ledger covers it, backups include it and the write gate
  protects its key, because every one of those reads the registry rather than a list
  somebody maintains. <code>localKey</code> is now a name in the gate's business-key set even
  though nothing writes it.
</div>

<div class="scroll"><table>
<thead><tr><th>Registry field</th><th>What it decides</th></tr></thead>
<tbody>
<tr><td><code>shape</code></td><td><code>"object"</code> means stored keyed by project, <code>"array"</code> a flat list, <code>"singleton"</code> one object. Decides what <code>read()</code> returns and what <code>replaceAll()</code> accepts.</td></tr>
<tr><td><code>idField</code></td><td>The business key. A record without it is refused as <code>invalid</code> rather than saved under an empty key.</td></tr>
<tr><td><code>projectField</code></td><td>Which field carries the project code. <code>all()</code> fills it in from the storage key when a legacy row lacks it.</td></tr>
<tr><td><code>fields</code></td><td>Payload field to typed column. Only add one when the database needs to filter, sort or constrain on it.</td></tr>
<tr><td><code>scopeKind</code></td><td>Omit for project-scoped. <code>"programme"</code> means the storage key is a programme id, which changes how <code>all()</code> backfills.</td></tr>
</tbody></table></div>

<h3>5. Check it before building on it</h3>
<pre><code>await PPMChildDatabase.hydrateModule("lessons")   // { ok: true, records: 0 }
PPMStore.lessons.all()                            // []
await PPMStore.lessons.save({ lessonId: "LES-1", projectCode: "PRJ-00008", summary: "..." })
PPMStore.lessons.forProject("PRJ-00008")          // one record</code></pre>
<p>
  If that works in the console, the database half is finished. If <code>save</code> returns
  <code>denied</code>, the policy is wrong; if it returns <code>invalid</code>, the registry and
  your record disagree about <code>idField</code>.
</p>

<h3>6. The page</h3>
<p>
  Copy an existing page's head verbatim, the CSP, the pinned supabase-js with its
  integrity hash, and the nine plumbing scripts in order. Do not hand-write it. The page-specific
  part is the last line:
</p>
<pre><code>&lt;script src="ppm-page-loader.js?v=VERSION" data-ppm-scripts="ppm-register-utils.js?v=VERSION|lessons-page.js?v=VERSION"&gt;&lt;/script&gt;</code></pre>
<div class="bad">
  <b>Page scripts go in data-ppm-scripts, never in a &lt;script src&gt; tag</b>
  That attribute is what waits for hydration. A script tag runs immediately and finds every
  collection empty, which looks exactly like the data being missing.
</div>

<h3>7. The page script</h3>
<pre><code>"use strict";

const projectCode = new URLSearchParams(location.search).get("code") || "";
let lessons = [];

function load() {
  lessons = PPMStore.lessons.forProject(projectCode);   // synchronous: hydration is done
}

async function save() {
  const store = PPMStore.lessons.read();                // the whole collection, stored shape
  store[projectCode] = lessons;                         // replace one project's rows
  const saved = await PPMStore.lessons.replaceAll(store);
  if (!saved.ok) {
    showMessage(saved.message, saved.queued ? "warning" : "error");
    return false;                                       // do not re-render as though it worked
  }
  return true;
}

load();
render();</code></pre>
<div class="warn">
  <b>Read the whole collection before replacing it</b>
  <code>replaceAll()</code> means "this is now everything". Passing only this project's rows
  would remove every other project's. Read, replace one group, hand back the whole thing.
</div>

<h3>8. Navigation</h3>
<p>
  Add the link to the <code>&lt;nav&gt;</code> of all twenty pages. It is duplicated markup, which
  is a known cost of having no build step; <code>VERIFY-STATIC.mjs</code> checks every page
  references files that exist, and §6e checks a page loads the script named after it.
</p>

<h3>9. The permission</h3>
<p>In <code>ppm-auth-utils.js</code>:</p>
<pre><code>// ALL_PERMISSIONS
"lessons.view", "lessons.edit",

// PAGE_RULES      - who may open the page at all
"lessons.html": ["lessons.view"],
// NAV_RULES       - who sees the link
"lessons.html": "lessons.view",
// PAGE_EDIT_RULES - whose controls are enabled rather than disabled
"lessons.html": "lessons.edit",</code></pre>
<p>
  Then grant them to roles. <code>BUILD-SPECIFICATIONS.mjs</code> reads
  <code>ALL_PERMISSIONS</code> and the role definitions out of this file at build time, so the
  permission matrix in both documents updates itself.
</p>
<div class="bad">
  <b>None of this is security</b>
  It decides what is shown and what is enabled. Somebody who edits the JavaScript sees every
  page. What actually stops them reading another project's lessons is
  <code>private.can_access_project()</code> in the policy from step 1.
</div>

<h3>10. Mark the controls</h3>
<pre><code>&lt;button data-permission="lessons.edit"&gt;Add lesson&lt;/button&gt;</code></pre>
<p>
  <code>PPMAuth</code> disables anything carrying a permission the person lacks. If you render
  controls after startup, call <code>PPMAuth.applyControlPermissions()</code> afterwards &mdash;
  otherwise a read-only role gets an enabled Save button that fails at the database, which is
  correct but rude. Controls that change nothing get <code>data-permission="none"</code> so they
  are not disabled by a rule that was never about them.
</p>

<h3>11. Prove it, then try to break it</h3>
<pre><code>node VERIFY-ALL.mjs</code></pre>
<p>Expect to be told about anything you skipped:</p>
<div class="scroll"><table>
<thead><tr><th>If you forgot</th><th>What tells you</th></tr></thead>
<tbody>
<tr><td>SCHEMA-MANIFEST.json</td><td>Schema drift, naming the table</td></tr>
<tr><td>To await a save, or to read its result</td><td>Static §2e</td></tr>
<tr><td>To use the right collection name</td><td>Static §2g, naming the typo</td></tr>
<tr><td>And used localStorage instead</td><td>Static §2b, naming the key and the collection</td></tr>
<tr><td>To put the page script in data-ppm-scripts</td><td>Static §6e</td></tr>
<tr><td>To bump the version</td><td>Static §2, one version across every page</td></tr>
<tr><td>A style attribute for a computed width</td><td>Static §6</td></tr>
</tbody></table></div>

<p>Then add a harness section, and make it fail before you believe it:</p>
<pre><code>{
  const D = sandbox.PPMStore;
  seed("lessons", { "PRJ-001": [{ lessonId: "LES-1", projectCode: "PRJ-001", summary: "Before" }] });

  updateResult = { data: { id: "uuid-1", version: 2 }, error: null };
  const store = D.lessons.read();
  store["PRJ-001"] = [{ lessonId: "LES-1", projectCode: "PRJ-001", summary: "After" }];
  const saved = await D.lessons.replaceAll(store);
  check("editing one lesson writes one row and removes nothing",
    saved.ok && saved.saved === 1 && saved.removed === 0, JSON.stringify(saved));

  updateResult = { data: null, error: { code: "42501", message: "permission denied" } };
  const refused = await D.lessons.save({ lessonId: "LES-1", projectCode: "PRJ-001", summary: "Refused" });
  check("a refused lesson leaves the store alone",
    refused.reason === "denied" &amp;&amp; D.lessons.byId("LES-1").summary === "After");
}</code></pre>

<div class="ok">
  <b>Deliberately break each assertion and watch it fail</b>
  This is the step people skip and it is the one that pays. Two assertions in this codebase were
  written against the wrong storage key and one against an empty store; all three passed with the
  bug present, which made them worse than nothing, a test that cannot fail is also a claim
  that something is checked.
</div>

<h3>Finally</h3>
<pre><code>node BUMP-VERSION.mjs          # one cache-bust version across every page
node BUILD-SPECIFICATIONS.mjs  # then the two document builders
node VERIFY-ALL.mjs            # all five gates green
node BUILD-DEPLOY-SET.mjs      # what the public repository should contain</code></pre>

<div class="note">
  <b>What this example did not need</b>
  No change to <code>ppm-data.js</code>, no change to the write gate's key list, no change to the
  backup module, no change to the permission matrix in either document, and no new entry in the
  pending ledger's plumbing. All of those read the adapter registry rather than a list. When a
  change here <i>does</i> require editing one of them, that is a signal something has been
  hard-coded that should have been derived.
</div>
`);

/* ------------------------------------------------------------------------- */

add("editing-a-page", "Worked example: changing a page that already exists", `
<p>
  Adding a page is the rarer job. Most work is changing one that is already there, and the way
  it goes wrong is different: not forgetting a step, but changing one of two places that had to
  move together. Three real changes, each traced end to end.
</p>

<div class="note">
  <b>Before touching anything</b>
  <a href="#modules">Module reference</a> for the file, it names what the file owns, where
  inside it to make a change, and the thing that has already caught somebody out there. Then
  <code>node VERIFY-ALL.mjs</code> <i>before</i> you start, so you know the gates were green when
  you arrived.
</div>

<h3>The two places that must agree</h3>

${diagram(
  "two-places",
  940,
  300,
  `
  <rect x="20" y="16" width="420" height="264" rx="9" class="d-box accent" />
  <text x="230" y="42" text-anchor="middle" class="d-title">The browser decides what is SHOWN</text>
  <text x="40" y="72" class="d-mono">ppm-auth-utils.js</text>
  <text x="40" y="92" class="d-small">ROLE_DEFINITIONS, ALL_PERMISSIONS</text>
  <text x="40" y="112" class="d-small">PAGE_RULES, NAV_RULES, PAGE_EDIT_RULES</text>
  <text x="40" y="132" class="d-small">can(), holdsPermission(), canAccessProject()</text>
  <text x="40" y="160" class="d-small">data-permission="..." on a control</text>
  <text x="40" y="180" class="d-small">applyControlPermissions() disables it</text>
  <rect x="36" y="200" width="388" height="62" rx="6" class="d-box warn" />
  <text x="52" y="222" class="d-small">Anyone can edit this. It is user experience:</text>
  <text x="52" y="240" class="d-small">it decides whether a button is there and enabled,</text>
  <text x="52" y="256" class="d-small">and nothing more.</text>

  <rect x="500" y="16" width="420" height="264" rx="9" class="d-box db" />
  <text x="710" y="42" text-anchor="middle" class="d-title">The database decides what HAPPENS</text>
  <text x="520" y="72" class="d-mono">private.role_permissions</text>
  <text x="520" y="92" class="d-small">private.has_permission(key, project)</text>
  <text x="520" y="112" class="d-small">private.can_access_project(code)</text>
  <text x="520" y="132" class="d-small">private.is_named_gate_approver(code)</text>
  <text x="520" y="160" class="d-small">RLS policies on all 37 tables</text>
  <text x="520" y="180" class="d-small">checks inside the four workflow functions</text>
  <rect x="516" y="200" width="388" height="62" rx="6" class="d-box store" />
  <text x="532" y="222" class="d-small">This is the only security boundary. It is</text>
  <text x="532" y="240" class="d-small">evaluated at AAL2 and cannot be talked out</text>
  <text x="532" y="256" class="d-small">of from a browser.</text>

  <path d="M444 100 L496 100" class="d-line strong" marker-end="url(#arrow)" />
  <path d="M496 130 L444 130" class="d-line strong" marker-end="url(#arrow)" />
  <text x="470" y="90" text-anchor="middle" class="d-small">agree</text>
  `,
  "<b>Change one without the other and nobody reports it.</b> Browser stricter than the database " +
    "gives somebody a hidden button for something they were entitled to do, and people assume a " +
    "missing button is not for them. Database stricter than the browser gives a button that fails " +
    "at the moment of use. No gate can catch either, the question has to be asked."
)}

<h3>A. Add a column to a register</h3>
<p>
  Say the decision register needs a "Review date". It lives in the payload, so no migration is
  needed, a column is only warranted when the database has to filter, sort or constrain
  on it.
</p>
<div class="recipe">
<h4>Adding a payload field to a register</h4>
<ol class="recipe-steps">
<li><code>ppm-register-utils.js</code><span>Add the field to that register's schema <code>fields</code> array. The schema drives the table, the form and the CSV export, so this is usually the only place the field is named.</span></li>
<li><code>prepareRecord()</code><span>Give it a default if a record without it must still read sensibly. A field that is <code>undefined</code> on 200 existing rows renders as "undefined" unless it defaults.</span></li>
<li><code>registers-page.js</code><span>Nothing, if the schema drives the columns. Check rather than assume, some columns are hand-placed.</span></li>
<li><code>node VERIFY-ALL.mjs</code><span>Then edit a record and confirm the change appears in Audit History. A payload field that does not show up there means the trigger is not diffing it, which after Stage 19 would be a bug worth reporting.</span></li>
</ol>
<p class="recipe-note">No migration, no manifest change, no adapter change. That is what the payload is for: the shape is the browser's business until the database needs an opinion about it.</p>
</div>

<h3>B. Change who is allowed to do something</h3>
<p>
  The trap here is that <b>the answer lives in two places and they must agree</b>. The browser
  decides what to show; the database decides what happens. If they disagree, the user gets a
  button that fails, or worse, a hidden button for something they were entitled to do.
</p>
<div class="recipe">
<h4>Changing a permission rule</h4>
<ol class="recipe-steps">
<li><code>ppm-auth-utils.js</code><span><code>ROLE_DEFINITIONS</code> for what a role holds; <code>PAGE_RULES</code>, <code>NAV_RULES</code> and <code>PAGE_EDIT_RULES</code> for pages. This is the interface only.</span></li>
<li>The matching database rule<span><code>private.role_permissions</code>, an RLS policy, or a check inside the relevant workflow function. <b>This is the one that decides.</b></span></li>
<li>Ask whether a role is the right test at all<span>Stage 18 is the cautionary tale: deciding a stage gate required a role permission <i>and</i> being named as an approver. Being named is the authority; requiring a role as well meant an executive could not ask a subject-matter expert to sign one gate without changing that expert's access to every other screen.</span></li>
<li><code>BUILD-SPECIFICATIONS.mjs</code><span>Nothing. It reads the role model out of <code>ppm-auth-utils.js</code> at build time, so both documents' permission matrices update themselves. Regenerate them.</span></li>
<li><code>STAGE-14-HARNESS.mjs</code><span>Add the case. Permission changes are the ones where a mistake is invisible until the wrong person tries something.</span></li>
</ol>
</div>

<h3>C. Change how something is drawn</h3>
<p>
  The resource timeline rebuild is the worked example here, and it is mostly a lesson in what
  <i>not</i> to reach for.
</p>
<div class="recipe">
<h4>Changing a rendered view</h4>
<ol class="recipe-steps">
<li>Geometry goes through <code>PPMCore.styleAttribute()</code><span>Anything computed, a bar's left and width, a column count. <code>style-src 'self'</code> blocks style attributes outright, and the browser drops them silently: the Gantt once collapsed into a single coloured block because eight scripts were still writing them.</span></li>
<li>Anything fixed is a class<span>Two states, two colours, a threshold - that is a stylesheet's job. A "computed" value that only ever takes two values is a class in disguise.</span></li>
<li>Arithmetic goes in <code>ppm-planning-utils.js</code><span>Working days, capacity, overlap. A local copy of <code>workingDaysBetween</code> was written into the timeline during the rebuild and deleted the same hour, the capacity tab, heatmap, runway and demand form all call the shared one.</span></li>
<li>Delete the CSS you orphaned<span>Rules for classes nothing emits read as live to whoever opens the file next. The harness now asserts three retired selectors stay gone.</span></li>
<li>Check the stacking<span>A z-index inside a transformed, filtered or opacity-below-1 ancestor is not a page-level z-index. See <a href="#traps">traps</a>.</span></li>
</ol>
</div>

<h3>What tends to go wrong, ranked by how long it takes to notice</h3>
<div class="scroll"><table>
<thead><tr><th class="w-layer">Mistake</th><th>How it presents</th><th>What finds it</th></tr></thead>
<tbody>
<tr><td>Changed the browser rule, not the database one</td><td>A button that works for you and fails for somebody with a different role. Often not for weeks.</td><td>Nothing automatic. Ask "what does RLS say?" every time you touch a permission.</td></tr>
<tr><td>Changed the database rule, not the browser one</td><td>A control that is hidden or disabled for somebody entitled to use it. Nobody reports a missing button, they assume it is not for them.</td><td>Nothing automatic. Same question, other direction.</td></tr>
<tr><td>Two copies of one formula</td><td>Two screens quietly disagreeing about the same number.</td><td>Only review. Put arithmetic in <code>ppm-planning-utils.js</code>.</td></tr>
<tr><td>A caller left behind by a deleted function</td><td>Works until that path runs. <code>flush is not defined</code> appeared the first time somebody approved a gate, weeks after the deletion.</td><td>Retired-identifier list, if you add the name. There is no scope analysis here.</td></tr>
<tr><td>An assertion that cannot fail</td><td>Everything green while the bug is present. Worse than no test, because it is also a claim.</td><td><b>Break it on purpose and watch it fail.</b> Three in this codebase passed against the wrong storage key or an empty store.</td></tr>
</tbody></table></div>

<div class="ok">
  <b>The habit worth copying from this codebase</b>
  Every gate and harness section here was proved by reintroducing, on purpose, the fault it
  describes and watching it fail, then restoring. It takes a minute and it is the only thing that
  distinguishes a check from a comment.
</div>
`);

/* ------------------------------------------------------------------------- */

add("change-map", "Change map: where to go for what", `
${changeMap()}
`);

/* ------------------------------------------------------------------------- */

add("how-to", "How to change things", `
<h3>Add a field to an existing record</h3>
<ol class="steps">
  <li>Add it to the page form and to whatever builds the record object.</li>
  <li>Decide whether it needs a typed column. It does if row-level security,
      an index, a constraint or reporting needs it. Otherwise the payload is enough
      and there is nothing to do in the database.</li>
  <li>If it needs a column: add the column, then register it in the collection's
      <code>fields</code> array in <code>ppm-child-database.js</code> (or the mapper
      in <code>ppm-database.js</code>) with the correct type. Mapping is generic
     , registering it is what makes it work in both directions.</li>
  <li>Add it to <code>IGNORED_FIELDS</code> only if it is adapter bookkeeping that
      must not count as a change.</li>
  <li>Run <code>node STAGE-14-HARNESS.mjs</code>.</li>
  <li>Bump <code>VERSION</code> and every cache-bust.</li>
</ol>

<h3>Add a new collection</h3>
<ol class="steps">
  <li>Create the table with the standard shape: <code>id</code>, the key columns,
      <code>legacy_payload</code>, <code>import_payload</code>, <code>version</code>,
      <code>created_at</code>, <code>updated_at</code>, <code>deleted_at</code>.</li>
  <li>Enable RLS and write policies for all four scopes. RLS is enabled
      automatically by an event trigger, but policies are not written for you: a table
      with RLS on and no policy denies everyone, which fails safe but looks like a
      bug.</li>
  <li>Attach the standard triggers: audit, key, lock.</li>
  <li>Grant SELECT, INSERT, UPDATE to <code>authenticated</code>. Not DELETE.</li>
  <li>Register the collection in <code>MODULES</code> with its table, mirror key,
      shape, scope kind, identifier field and typed fields.</li>
  <li>Add it to <code>DATABASE_MODULES</code>.</li>
  <li>Add it to the harness registry assertions and re-run.</li>
  <li>Document it here and, if users touch it, in the user specification.</li>
</ol>

<h3>Add a permission or change a role</h3>
<ol class="steps">
  <li>Add the identifier to <code>ALL_PERMISSIONS</code> in
      <code>ppm-auth-utils.js</code>.</li>
  <li>Add it to each role that should have it.</li>
  <li>Mirror it in the database role definition that
      <code>private.has_permission()</code> reads. <b>Both are required</b> &mdash;
      the browser copy controls the interface, the database copy controls access.</li>
  <li>Add a plain-language description to <code>PERMISSION_MEANING</code> and place
      it in a group in <code>PERMISSION_GROUPS</code>, in
      <code>BUILD-SPECIFICATIONS.mjs</code>. The build fails if a permission is
      ungrouped, on purpose, so the matrix cannot quietly omit it.</li>
  <li>Regenerate both specifications.</li>
</ol>

<h3>Add a transactional workflow</h3>
<ol class="steps">
  <li>Write the function in <code>public</code>, <code>SECURITY DEFINER</code>, with
      <code>set search_path = ''</code>, taking expected versions for every row it
      touches.</li>
  <li>Set the workflow GUC inside the function with <code>set local</code>.</li>
  <li>Add guard triggers to the tables so direct writes are refused, otherwise
      the workflow is a convention rather than a constraint.</li>
  <li>Grant EXECUTE to <code>authenticated</code>, and confirm <code>anon</code>
      cannot call it.</li>
  <li>Export the module group from the adapter and flush it before calling.</li>
  <li>Re-hydrate afterwards.</li>
</ol>

<h3>Apply a migration</h3>
<ol class="steps">
  <li>Write it idempotently: <code>create table if not exists</code>,
      <code>drop ... if exists</code>, guarded inserts.</li>
  <li>Lint it: <code>node STAGE-SQL-LINT.mjs</code>. Part of <code>VERIFY-ALL.mjs</code>, so
      you get this for free at release time; run it on its own while writing.</li>
  <li>Optionally parse it:
      <code>python3 -c "import pglast; pglast.parse_sql(open('file.sql').read())"</code>.
      This is the one step that needs Python installed, and it is optional: it checks grammar,
      which the lint above does not, but a plpgsql body is an opaque string literal to it, so
      it cannot see either of the two traps below.</li>
  <li>Apply it, then <b>verify against the live database rather than trusting the
      file</b>. See the traps section for why this is not optional.</li>
  <li>Write a matching <code>*-VERIFY.sql</code>.</li>
</ol>
`);

/* ------------------------------------------------------------------------- */

add("debugging", "Debugging playbook", `
<h3>Start here, always</h3>
<pre><code>await PPMDatabase.explain()        // client loaded? signed in? at aal2? what is cached?
PPMChildDatabase.explain()         // every collection: table, mirror, validity</code></pre>
<p>
  Most &ldquo;the page is empty&rdquo; reports are answered by the first three lines
  of <code>explain()</code>. Below AAL2 every table returns zero rows, which looks
  exactly like having no data.
</p>

<h3>Symptom to cause</h3>
<div class="scroll"><table>
<thead><tr><th>Symptom</th><th>Most likely cause</th><th>What to run</th></tr></thead>
<tbody>
<tr>
  <td>Page is empty for one user only</td>
  <td>Row-level security is filtering everything: scope, or account not Active</td>
  <td><code>await PPMDatabase.explain()</code>, then check their <code>access_scope</code> and <code>account_status</code></td>
</tr>
<tr>
  <td>Page is empty for everyone</td>
  <td>Not at AAL2, or the client failed to load</td>
  <td><code>await PPMDatabase.assuranceLevel()</code></td>
</tr>
<tr>
  <td>A save appears to work, then reverts on reload</td>
  <td>A caller ignored the result and re-rendered anyway. <code>VERIFY-STATIC.mjs</code> catches a
      discarded <code>PPMStore</code> result, but not one that is captured and never read.</td>
  <td><code>PPMChildDatabase.pendingWrites()</code></td>
</tr>
<tr>
  <td>&ldquo;changed by someone else&rdquo; on a record nobody else touched</td>
  <td>Version churn from spurious writes, or a record with no <code>databaseVersion</code> because it was never loaded</td>
  <td><code>await PPMChildDatabase.compare("plans")</code></td>
</tr>
<tr>
  <td>The screen and the database disagree</td>
  <td>A partial hydration, or a page that mutated what it rendered from without saving it</td>
  <td><code>await PPMChildDatabase.compareAll()</code></td>
</tr>
<tr>
  <td>Records silently missing after a save</td>
  <td>Records with no identifier are dropped by the flattener</td>
  <td><code>PPMChildDatabase.validateLocal("plans")</code></td>
</tr>
<tr>
  <td>A write is refused with no obvious reason</td>
  <td>A guard trigger. The message names which one.</td>
  <td>Read the error, they are written to be diagnostic</td>
</tr>
<tr>
  <td>Configuration page is blank</td>
  <td>Empty configuration table and the default-writing read has not run</td>
  <td>Load the page that owns that configuration once</td>
</tr>
</tbody></table></div>

<h3>The end-to-end check</h3>
<pre><code>await PPMChildDatabase.selfTest()                  // hydrate, compare, pending, per collection
await PPMChildDatabase.selfTest(["plans"], { write: true })   // also probe a real write</code></pre>
<div class="warn">
  <b><code>{ write: true }</code> writes to live tables</b>
  It inserts and soft-deletes a probe row and cleans up after itself, but it leaves
  audit entries behind, because audit is append-only. Fine on a pilot; think before
  running it anywhere that matters.
</div>

<h3>Server-side</h3>
<pre><code>await PPMDatabase.auditReport()                    // who changed what, from the database
await PPMChildDatabase.queryRows("plans", { includeDeleted: true })</code></pre>
<p>In SQL, when you need to know what a policy is actually doing:</p>
<pre><code>-- what can this identity reach?
select private.can_access_project('PRJ-00006');
select private.has_permission('financials.approve');

-- why is a table returning nothing?
select * from pg_policies where tablename = 'project_plans';</code></pre>
`);

/* ------------------------------------------------------------------------- */

add("traps", "Traps, and the gates that now catch them", `
<div class="bad">
  <b>Every entry here is a bug that has already happened in this codebase</b>
  They are recorded because each one cost real time, and most would be repeated by
  anyone reasoning from first principles.
</div>

<div class="ok">
  <b>Each trap now names the gate that catches it</b>
  A warning in a document does not prevent anything, the person about to make
  the mistake is by definition not reading the section that describes it. So every
  trap below is either structurally impossible now, or asserted by one of the ${COUNTS.releaseGates} gates
  that fail loudly:
  <br /><br />
  <code>node VERIFY-STATIC.mjs</code> &mdash; 1,900+ assertions on page and script
  structure: load order, CSP, cache-busts, dependency pinning, retired identifiers,
  secrets.<br />
  <code>node SCHEMA-DRIFT-CHECK.mjs</code>, cross-checks the database, the
  adapters and the migration files against each other.<br />
  <code>node STAGE-14-HARNESS.mjs</code> &mdash; 190 behavioural assertions against
  the real adapters.<br />
  <code>VERIFY-INVARIANTS.sql</code>, database security and structure, run in
  the SQL editor.
  <br /><br />
  Run all four before any release. They take seconds.
</div>

<h3>SQL</h3>
<dl class="fields">
  <dt><code>&lt;&gt; any(array[...])</code> does not mean &ldquo;not in&rdquo;
      <span class="pill g">caught by STAGE-SQL-LINT.mjs</span></dt>
  <dd>It is true as soon as the value differs from <i>one</i> element, so an exclusion
      list written this way silently stops excluding. Use <code>&lt;&gt; all(...)</code>.</dd>

  <dt><code>array_agg(attname)</code> is <code>name[]</code>, not <code>text[]</code>
      <span class="pill g">caught by STAGE-SQL-LINT.mjs</span></dt>
  <dd>Comparing it to a <code>text[]</code> literal fails with
      <code>operator does not exist</code>. Cast with <code>::text</code>.</dd>

  <dt>The SQL file is not the schema
      <span class="pill g">caught by SCHEMA-DRIFT-CHECK.mjs</span></dt>
  <dd>A column was renamed when a migration was applied and the file was never updated.
      Weeks later the file said <code>timestamp</code> and the database had
      <code>timestamp_value</code>. The first attempted fix would have added an empty
      duplicate column.
      <br /><br />
      <b>Now:</b> <code>SCHEMA-MANIFEST.json</code> holds the live column list, and the
      drift check compares it against both what the adapters map and what the migration
      files declare. An adapter mapping a column that does not exist is reported as
      &ldquo;every write to this collection will fail&rdquo;, because it will.
      Regenerate the manifest after each migration and commit the diff, the
      manifest changing is how a reviewer sees the schema changed.</dd>

  <dt><code>revoke ... from public</code> does not remove an explicit grant
      <span class="pill g">caught by VERIFY-INVARIANTS.sql</span></dt>
  <dd>Supabase grants <code>anon</code> explicitly, so six <code>ppm_*</code> functions
      stayed callable by <code>anon</code> despite the revoke. Revoke from each role by
      name.
      <br /><br />
      <b>Now:</b> the invariants gate asserts <code>anon</code> holds zero table grants
      and can execute zero functions, and its failure message says exactly this. It was
      tested by granting <code>anon</code> access inside a transaction and confirming
      the gate fired, then rolling back.</dd>

  <dt>RLS enabled with no policy denies everyone
      <span class="pill g">caught by VERIFY-INVARIANTS.sql</span></dt>
  <dd>Which fails safe, but presents as an inexplicably empty page. An event trigger
      enables RLS on new tables; it does not write policies.
      <br /><br />
      <b>Now:</b> asserted per table, alongside &ldquo;every table has the restrictive
      AAL2 policy&rdquo; and &ldquo;no read policy is unconditionally true outside the
      configuration allowlist&rdquo;. That last one is what
      <code>resource_absence</code> would have failed.</dd>

  <dt>A <code>SECURITY DEFINER</code> function without a fixed <code>search_path</code>
      <span class="pill g">caught by VERIFY-INVARIANTS.sql</span></dt>
  <dd>It runs as the owner, so an attacker-controlled <code>search_path</code> can
      redirect an unqualified name to their own object. Always
      <code>set search_path = ''</code> and schema-qualify everything.</dd>
</dl>

<h3>The adapters</h3>
<dl class="fields">
  <dt>A per-origin browser flag is not configuration
      <span class="pill g">structurally impossible now</span></dt>
  <dd>The source flags lived in localStorage, which is per-origin. Every cutover was
      recorded against <code>localhost</code>, so opening the same build on GitHub Pages
      was a fresh origin with an empty store and every collection fell back to browser
      storage, no projects, no people, and edits written locally and never
      pushed. Stage 14 removed the flags entirely, and the harness asserts the API is
      gone rather than merely undocumented.</dd>

  <dt>Recording a default by deleting the key is not recording it
      <span class="pill g">structurally impossible now</span></dt>
  <dd><code>setSource(x, LOCAL)</code> deleted the key, and once the default became
      DATABASE, reverting silently did nothing. Store the value you mean.</dd>

  <dt>A return field shadowed by a spread
      <span class="pill g">caught by STAGE-14-HARNESS.mjs</span></dt>
  <dd><code>return { refused: true, ...split }</code> where <code>split.refused</code>
      was an array of keys. The spread overwrote the boolean, so the caller's
      <code>if (result.refused)</code> was truthy either way and the bug was invisible.
      <br /><br />
      <b>Now:</b> the harness asserts that any returned field whose name reads as a
      yes/no question &mdash; <code>refused</code>, <code>cleared</code>,
      <code>valid</code>, <code>ok</code>, <code>identical</code>,
      <code>skipped</code>, is actually a boolean, across every result object the
      safety API returns. The class of mistake is "a name means two things", so the
      check is on the class rather than the one field.</dd>

  <dt>Key order made every record look modified
      <span class="pill g">caught by STAGE-14-HARNESS.mjs</span></dt>
  <dd><code>JSON.stringify</code> preserves insertion order, so records rebuilt with
      keys in a different order compared as different. Every page load pushed everything
      back and churned the row version, which then caused false conflicts. Hence
      <code>stableStringify</code>.
      <br /><br />
      <b>Now:</b> the harness writes the same task twice with the keys reordered and
      asserts no second write is issued, and then makes a real change and asserts
      one <i>is</i>, so the test cannot pass by the comparison being broken.</dd>

  <dt>A patched <code>getItem</code> is not the native one
      <span class="pill g">caught by VERIFY-STATIC.mjs</span></dt>
  <dd><code>ppm-auth-utils.js</code> replaces <code>getItem</code> with a
      project-scoping filter. Backup code calling <code>localStorage.getItem</code>
      therefore captured only the projects that user could see, and a full restore would
      write that partial copy over everything. <b>This destroyed data in testing.</b>
      <br /><br />
      <b>Now:</b> the static gate asserts the load order on every page, with a failure
      message that states the consequence rather than only the rule. Verified by
      swapping the two script tags and confirming it fires.</dd>

  <dt>A fallback can defeat the safety check it feeds
      <span class="pill g">caught by STAGE-14-HARNESS.mjs</span></dt>
  <dd>When the source flags were removed, <code>databaseBackedKeys()</code> would have
      returned an empty set, meaning "nothing is database-backed", and
      restore would have overwritten live data without warning. When you delete a
      mechanism, find everything that asked it questions.
      <br /><br />
      <b>Now:</b> the harness asserts the set is non-empty, that every database
      collection contributes a key, and that a stale record from a backup is never
      written. It also fails closed if neither adapter is loaded.</dd>
</dl>

<h3>Callers and APIs drifting apart</h3>
<dl class="fields">
  <dt>A retired function called through an alias
      <span class="pill g">caught by VERIFY-STATIC.mjs &sect;7</span></dt>
  <dd>Stage 14 deleted <code>compareAndRecord</code>, <code>record</code> and <code>diff</code>
      from <code>PPMAudit</code> and removed 31 call sites.
      <code>ppm-change-log.js</code> was missed, and kept calling all three, through a
      local alias:
      <pre><code>const log = audit();          // returns window.PPMAudit
log.compareAndRecord(...);    // invisible to a gate matching "PPMAudit.compareAndRecord"</code></pre>
      Every save that recorded a change threw <code>TypeError</code> <b>after the row had reached
      the database</b>, which killed the rest of the handler. On resources, milestones,
      programmes, benefits and project details the record saved and then the modal stayed open,
      the list never refreshed and no message appeared. It was reported, a month later, as a
      button that did nothing, which is the least likely symptom to be traced to an audit
      trail.
      <br /><br />
      <b>Now:</b> the recording half of the change log is deleted, distinctive method names are
      on the retired list without their global, and section 22 of the harness, every
      shared module loads without throwing, catches the reintroduction. The general
      problem remains: no gate here can follow an alias, so introducing one steps outside what
      any of them can see.</dd>

  <dt>The optional call that swallows a missing method
      <span class="pill g">caught by VERIFY-STATIC.mjs &sect;2c</span></dt>
  <dd><code>Boolean(window.PPMChildDatabase?.stage11AReady?.())</code>. The probe was retired;
      <code>?.()</code> on a missing method yields <code>undefined</code> rather than throwing,
      <code>Boolean(undefined)</code> is <code>false</code>, and all four governance workflows
      reported "not available" and fell back to a path the database refuses. Stage gates, plan
      baselines, budget approvals and scenario publishing did nothing, silently, for months.
      A plain call would have thrown on the first submission and been fixed that day.</dd>
</dl>

<h3>Removing something that was holding up more than it looked</h3>
<dl class="fields">
  <dt>The signed-in person's own record lived in a mirror that was deleted
      <span class="pill g">caught by STAGE-14-HARNESS.mjs &sect;39</span></dt>
  <dd><code>readValidSession()</code> runs on every page load, before hydration, and looks the
      signed-in person up in the people directory to check they are still active and still have a
      role. That record used to be in the <code>ppmResources</code> localStorage mirror, written
      at sign-in by <code>saveResources()</code>.
      <br /><br />
      Stage 16 deleted the mirror and, with it, the write. Nothing else read it, so it looked like
      tidying up. The next page load then found no record for the session, called
      <code>endSession("account unavailable")</code> and redirected to the login screen &mdash;
      which showed "Welcome back", offered Continue, and bounced straight back. Nobody could use
      the application, and all five gates were green.
      <br /><br />
      <b>Now:</b> the whole resolved record is written to <code>sessionStorage</code> at sign-in,
      which is the right home for it, it is identity rather than portfolio data, and it
      should die with the tab. The hydrated directory still wins whenever it has the person, so a
      deactivation or a role change takes effect on the next page load rather than the next
      sign-in. Both directions are asserted, including the inversion, because getting them the
      wrong way round would keep a revoked account usable.</dd>

  <dt>The module that decides who may use the tool had no tests at all
      <span class="pill g">closed by STAGE-14-HARNESS.mjs &sect;39</span></dt>
  <dd>The harness stubbed <code>PPMAuth</code> with two functions, because the adapters only ever
      needed <code>getCurrentUser()</code> from it. So <code>ppm-auth-utils.js</code> &mdash;
      sign-in, session resumption, roles, permissions, project scope, was never loaded,
      never called and never asserted, through every stage of this migration.
      <br /><br />
      It has its own sandbox in the harness now: two independent page loads sharing one
      <code>sessionStorage</code>, which is what makes the resumption path testable at all.
      <b>The general lesson is the one worth keeping:</b> a module with no coverage is not
      "probably fine", it is the module where a change will break something silently. Ask what is
      untested before asking what is failing.</dd>
</dl>

<h3>Rules that were the wrong shape</h3>
<dl class="fields">
  <dt>The audit trail skipped everything people actually change
      <span class="pill g">caught by STAGE-14-HARNESS.mjs &sect;38</span></dt>
  <dd>All three audit trigger functions &mdash; <code>record_audit</code> for the foundation
      tables, <code>record_child_audit</code> for eighteen child tables and
      <code>record_scope_audit</code> for fourteen configuration tables, diffed the row
      column by column with the same skip list, and <code>legacy_payload</code> was on it.
      <br /><br />
      The typed columns are a handful of fields projected out of the payload so the database can
      filter and constrain on them. <b>Everything else a person edits is inside the payload</b>:
      a decision's rationale and outcome, a RAID item's mitigation, an action's update, a status
      report's commentary. The loop found no changed column, hit
      <code>if jsonb_array_length(changed) = 0 then return NEW</code>, and wrote no audit row at
      all. The change saved, the version incremented, and the trail showed nothing.
      <br /><br />
      Found in the pilot: a decision recorded at 12:47 with four fields filled in, row at version
      2, and the most recent audit entry for that table two days older. The change history said
      "0 recorded changes" and was telling the truth.
      <br /><br />
      <b>The skip was not carelessness.</b> Putting a whole payload blob in as one before/after
      pair would be unreadable and would make every save look like a total rewrite. The instinct
      was right and the implementation too blunt: <code>private.payload_changes()</code> now
      diffs <i>inside</i> the payload, one entry per changed key, ignoring the bookkeeping keys
      that change on every save, capped at 80 entries with a count of the rest.
      <br /><br />
      <b>Nothing backfills.</b> Every edit between the migration that introduced the skip and
      Stage 19 is not in the trail and cannot be reconstructed, because the before values are
      gone. Worth stating to anyone who relies on it rather than letting them discover it.</dd>

  <dt>The per-record History button read the wrong source
      <span class="pill g">caught by STAGE-14-HARNESS.mjs &sect;38</span></dt>
  <dd><code>PPMChangeLog.historyFor()</code> read <code>legacyAudit</code>, browser rows
      recorded before Stage 14 stopped emitting them, which stop in August and are never added
      to. Honest, and increasingly empty, which reads as "nothing ever happened to this record".
      It now merges <code>public.audit_log</code> with those legacy rows, newest first.
      <br /><br />
      The audit key is composite &mdash; <code>PRJ-00011 / DEC-00011-001</code>, because a record
      id is only unique within its project, so a caller holding just the record id matches
      on the tail through the new <code>recordEndsWith</code> option.</dd>

  <dt>A transform that trapped the notification panel behind the page
      <span class="pill g">caught by VERIFY-STATIC.mjs &sect;6g</span></dt>
  <dd><code>.ppm-session-bar</code> centres itself with <code>transform: translateY(-50%)</code>.
      A transform creates a stacking context, so the notification panel's <code>z-index: 5000</code>
      only ever decided its order relative to the bell beside it, against the page, the
      whole bar competed at its position in the document with no z-index at all. The panel drew,
      and then sticky table cells at z-index 2 to 6 drew on top of it.
      <br /><br />
      <b>Now:</b> the bar carries <code>z-index: 1400</code>, above every page layer (the highest
      is 1200) and below the application-wide overlays. The gate fails if any page stylesheet
      declares a z-index at or above it, because the symptom, a panel showing through on
      one page only, is invisible until somebody opens the bell on exactly that page.
      <br /><br />
      <b>The general lesson:</b> <code>transform</code>, <code>filter</code>,
      <code>opacity</code> below 1 and <code>will-change</code> all create stacking contexts. A
      z-index inside one is not a page-level z-index, however large it looks.</dd>

  <dt>Readiness refused the decision the gate exists to record
      <span class="pill g">caught by STAGE-14-HARNESS.mjs &sect;41</span></dt>
  <dd>Submitting and approving both threw when the organisation's own readiness rules found a
      mandatory field outstanding. A stage gate <i>is</i> the decision: if a sponsor wants to
      approve with three evidence items open, because they know something the checklist does not,
      that is the call they are accountable for. Refusing does not enforce governance, it
      substitutes a checklist for a judgement, and leaves no record that a judgement was made,
      because the person simply fills in whatever unblocks the button.
      <br /><br />
      <b>Now (Stage 19):</b> readiness is evaluated, shown in the confirmation dialogue, and
      recorded on the decision &mdash; <code>readinessOutstanding</code> on the decision-history
      entry, surfaced in the gate's history as "4 readiness items outstanding at the time" with
      the list. A better artefact than a refusal, because it survives the items being completed
      afterwards.
      <br /><br />
      <code>validate()</code> now answers two questions separately: <code>errors</code> are
      statements about the record and still refuse, no gate id, a stage outside the
      lifecycle template, while <code>advice</code> is what the rules noticed and blocks
      nothing. The database never enforced readiness; it was only ever a browser rule.</dd>

  <dt>A named approver who could not approve
      <span class="pill g">caught by STAGE-14-HARNESS.mjs &sect;40</span></dt>
  <dd>Deciding a stage gate required being a named required approver <b>and</b> holding
      <code>stageGates.approve</code> for that project, in the browser and again in
      <code>ppm_commit_stage_gate_workflow</code>. It is the wrong shape for an approval. An
      executive who wants a subject-matter expert to sign a gate would have to have the expert's
      role changed for every other screen in the application first, and a sponsor named on a
      project outside their own scope could not act at all.
      <br /><br />
      <b>Now (Stage 18):</b> being named is the authority.
      <code>private.is_named_gate_approver()</code> is accepted in place of the role test, and
      the rule that an approver must already hold the permission before they can be named is
      gone. Everything that makes an approval mean something is untouched: the submitter cannot
      name themselves, you cannot decide a gate you submitted or own, only a named approver can
      decide, the approver list is frozen once a decision is being recorded, and the decision is
      written by trigger from the authenticated identity.
      <br /><br />
      <b>The trade-off, stated:</b> whoever submits a gate now decides who may approve it,
      without an administrator granting a role first.</dd>

  <dt>The browser was looser than the database about who a person is
      <span class="pill g">caught by STAGE-14-HARNESS.mjs &sect;40</span></dt>
  <dd><code>samePerson()</code> compared resource ids for equality and then <i>fell through</i> to
      comparing email addresses, so two people sharing a mailbox matched and the "both have ids,
      so no" line below could never be reached. Harmless while it only decided which row to
      highlight; not harmless once it decided who may approve, because
      <code>is_named_gate_approver()</code> matches on resource id alone, so the browser
      would offer buttons the database then refused.
      <br /><br />
      Found by writing the test, not by reading the code: the first version of the "somebody not
      named gets nothing" case passed for the wrong reason, because the bystander had been given
      the approver's email address.</dd>

  <dt>A message that blamed the account for the state of the record
      <span class="pill a">no gate can catch this, only reading it aloud</span></dt>
  <dd>"No workflow actions are available to your account for this record" was shown whenever
      there was nothing to do, including on a Draft gate, where nobody can approve,
      because it has not been submitted. It reads as a permission problem, and it sent the reader
      hunting for a missing permission that was never missing.
      <br /><br />
      The page now names the state: the gate is still a draft, or you are not one of its named
      approvers, or you submitted it yourself. This codebase has a stated convention that errors
      name the real cause; it is worth re-reading a message and asking what a person would
      conclude from it, because that is the bug this one was.</dd>
</dl>

<h3>Answers nobody looked at</h3>
<dl class="fields">
  <dt>A shape the writer did not recognise, treated as empty
      <span class="pill g">caught by STAGE-14-HARNESS.mjs &sect;35</span></dt>
  <dd><code>replaceAll()</code> opened with
      <code>Array.isArray(records) ? records : []</code>. Eighteen collections are stored as an
      object keyed by project code and every caller passes exactly that object, so
      <code>incoming</code> was empty, every existing record counted as deleted, and the call
      soft-deleted the whole collection and returned <code>ok</code>. In production it removed
      six Draft stage gates when one was deleted; the other 41 survived only because a guard
      trigger refused them.
      <br /><br />
      <b>The rule that replaced it:</b> a shape a writer does not recognise is an error, never an
      empty collection. Emptiness and "I did not understand you" must not behave the same when
      one of them deletes everything.</dd>

  <dt>A test that could not fail
      <span class="pill a">no gate can catch this, only the habit</span></dt>
  <dd>Four assertions in this codebase have now passed while the bug they described was present.
      Two read the wrong storage key. One tested a populated case against an empty store. The
      fourth checked that the timeline bound a scroll listener, by looking for
      <code>addEventListener("scroll" &hellip; passive: true)</code> anywhere in the file, and
      passed with the whole feature deleted, because it was matching the card-hiding listener
      bound two hundred lines earlier. A test that cannot fail is worse than no test, because it
      is also a claim that something is checked.
      <b>Break every new assertion on purpose and watch it fail before you believe it.</b> When
      the assertion is a pattern, check that the pattern does not also appear somewhere else in
      the same file.</dd>

  <dt>The permission guard reached outside its own application
      <span class="pill a">caught by VERIFY-STATIC.mjs &sect;6h</span></dt>
  <dd><code>applyControlPermissions()</code> queried <code>document</code>, so it found buttons
      injected by browser extensions, decided they were untagged data-changing controls, and
      disabled them. Somebody's extension broke on this site only, with no visible cause. It also
      logged a warning naming controls that do not exist anywhere in this codebase, which is a
      false defect report and hides the real ones. The scan is scoped to <code>APP_REGIONS</code>
      now. Gate 6h walks each page's tag stream keeping the open-element stack, and fails if any
      control sits outside every listed region, so scoping cannot quietly leave a control
      unguarded.</dd>

  <dt>Controls built at runtime were never checked for a permission tag
      <span class="pill a">caught by VERIFY-STATIC.mjs &sect;6i</span></dt>
  <dd>Gate 6h reads shipped HTML. Most controls here are not in shipped HTML: they are written
      into template literals and injected when a list renders, and nothing checked those at build
      time. Eight were found untagged, including Edit and Delete on every document row of the
      project details page, which therefore did nothing for anybody at any permission level.
      Untagged means the guard fails closed. The only signal was a console warning nobody sees
      unless they have devtools open on the page that renders it.</dd>

  <dt>A message that promised data the browser no longer keeps
      <span class="pill a">caught by VERIFY-STATIC.mjs &sect;7b</span></dt>
  <dd>Five messages told the reader the page was &ldquo;showing the last known local data&rdquo;
      when a load failed. True until Stage 17 deleted the localStorage mirror. After that there
      was no local copy, so a collection that failed to load was empty and its page showed
      nothing. Reassuring and wrong is the worst combination: somebody reading the console
      concludes the screen is stale rather than blank and stops looking. Four were found by hand
      and the gate immediately caught a fifth in a boot handler that the hand search had
      missed.</dd>

  <dt>Signing out was reported as thirty-six failures
      <span class="pill a">caught by STAGE-14-HARNESS.mjs &sect;47</span></dt>
  <dd>Every page loads both adapters, including the sign-in page. With no session each of the 36
      collections was queried, refused, and logged its own warning, so the correct outcome of
      pressing sign out produced a wall of red. Both adapters check for a session first now and
      say so once, at <code>info</code>, because nothing has gone wrong. Section 47 drains the
      event loop before measuring, since the adapters boot asynchronously and an earlier version
      of that test passed by measuring before anything had run.</dd>
</dl>

<h3>Migrations and seeding</h3>
<dl class="fields">
  <dt>Insert triggers and update triggers are not the same set
      <span class="pill a">documented; partially gated</span></dt>
  <dd>The <code>*_key</code> triggers are BEFORE UPDATE only, so an insert must supply
      <code>record_key</code> itself. The invariants gate asserts the triggers exist; it
      cannot assert your insert supplies the key. Read the trigger timings in
      <a href="#triggers">Triggers</a> before writing a migration that inserts.</dd>

  <dt>A trigger that derives a foreign key needs the target to exist already
      <span class="pill a">documented; fixed in the seed</span></dt>
  <dd><code>manager_id</code> is derived from the payload by looking the manager up in
      <code>people</code>. Insert someone before their manager and it silently stays
      null. The demo seed re-derives it in a second pass once everyone exists. Any
      importer needs the same two-pass shape.</dd>

  <dt>Probing production is not testing
      <span class="pill a">process, not a gate</span></dt>
  <dd>A link-login probe was run assuming one auth user existed. There were two, so it
      linked a real login to the wrong person.
      <br /><br />
      <b>Do this instead:</b> read the data before writing a test against it, and wrap
      the probe in a transaction that rolls back:
      <pre><code>do $$
begin
    -- probe here
    raise exception 'rolling back deliberately - this was a test';
exception when others then
    if sqlerrm &lt;&gt; 'rolling back deliberately - this was a test' then raise; end if;
end $$;</code></pre>
      That pattern is how the <code>anon</code> grant gate above was verified against
      the live database without leaving anything behind.</dd>

  <dt>&ldquo;Reload twice and it populates itself&rdquo; was optimistic
      <span class="pill a">documented</span></dt>
  <dd>True only for configuration the loaded page actually reads. An instruction to open
      a page that loads two specific utilities was impossible, because no single page
      loads both. Check which page owns the configuration before saying it
      self-populates.</dd>
</dl>

<h3>What is still only a warning</h3>
<p>
  Three of the traps above are process rather than gate, and it is worth being clear
  about which: <b>insert-versus-update trigger timing</b>, <b>two-pass derivation when
  seeding</b>, and <b>probing production safely</b>. All three depend on what a
  migration author intends, and a checker cannot infer intent. They are the ones to
  re-read before writing a migration.
</p>
`);

/* ------------------------------------------------------------------------- */

add("stage-14", "What Stage 14 removed, and why", `
<p>
  The migration is complete, so the machinery that made it safe has been removed. It
  was not dead code, it was live, exported, and every switch was a way to run
  the application against stale browser data.
</p>

<h3>Removed from the browser</h3>
<div class="scroll"><table>
<thead><tr><th>What</th><th>Was for</th><th>Why it had to go</th></tr></thead>
<tbody>
<tr><td>Shadow mode and the divergence log</td><td>Reading localStorage while comparing the database in the background</td><td>Nothing left to compare; the database is authoritative</td></tr>
<tr><td>Per-collection source flags (<code>LOCAL</code>/<code>SHADOW</code>/<code>DATABASE</code>)</td><td>Migrating one collection at a time</td><td>A per-origin browser flag that could point a page at stale data. Caused a live incident.</td></tr>
<tr><td><code>cutOver</code>, <code>cutOverBatch</code>, <code>fastCutOver</code>, <code>revertToLocal</code>, the staged <code>cutOverStage*</code> family</td><td>Moving collections across</td><td>All collections have moved</td></tr>
<tr><td><code>seed</code>, <code>seedAll</code>, <code>seedBatch</code>, <code>seedStage12Defaults</code></td><td>First-time population</td><td>Configuration defaults are derived on read and persisted once by an explicit <code>seedDefaults()</code></td></tr>
<tr><td>31 <code>PPMAudit.record()</code> call sites, plus <code>recordMany</code>, <code>compareAndRecord</code>, <code>diff</code></td><td>Browser-side audit</td><td>Triggers record everything verifiably; a weaker second copy added no information and invited disagreement</td></tr>
<tr><td><code>importLegacyToDatabase()</code></td><td>One-off import of pre-migration browser events</td><td>Already run; nothing is writing browser audit for it to collect</td></tr>
</tbody></table></div>

<h3>Removed from the database</h3>
<ul>
  <li>Nine <code>ppm_stage*_ready()</code> probes. Each answered &ldquo;has this
      migration stage been applied&rdquo;, which can now only be yes.</li>
  <li><code>ppm_import_legacy_audit()</code>. The rows it imported stay and are still
      read; only the ability to import more is withdrawn.</li>
</ul>

<h3>Deliberately kept</h3>
<div class="ok">
  <b>Diagnostics stayed</b>
  <code>status()</code>, <code>explain()</code>, <code>validateLocal()</code>,
  <code>flattenLocal()</code>, <code>compare()</code>, <code>compareAll()</code>,
  <code>selfTest()</code>, <code>pendingWrites()</code> and <code>flush()</code>.
  They are how a bad write gets diagnosed, and none of them can change where the
  application reads from. Removing them would have been tidier and worse.
</div>
<p>Also kept: the four workflow commits, the coupled module groups (renamed to say what they are for rather than which stage created them), <code>PPMAudit</code>'s read surface including the <code>local</code> provenance tag, and the retired-key exclusions in the snapshot filter, because an old backup may still contain them and restoring one must not resurrect a flag the current code would not understand.</p>

<h3>Renames</h3>
<div class="scroll"><table>
<thead><tr><th>Was</th><th>Now</th></tr></thead>
<tbody>
<tr><td><code>CUTOVER_MODULES</code></td><td><code>DATABASE_MODULES</code></td></tr>
<tr><td><code>STAGE_11A_BATCH</code></td><td><code>STAGE_GATE_WORKFLOW_MODULES</code></td></tr>
<tr><td><code>STAGE_11B_BATCH</code></td><td><code>BASELINE_WORKFLOW_MODULES</code></td></tr>
<tr><td><code>STAGE_11C_BATCH</code></td><td><code>FINANCIAL_WORKFLOW_MODULES</code></td></tr>
<tr><td><code>STAGE_11D_BATCH</code></td><td><code>RESOURCE_WORKFLOW_MODULES</code></td></tr>
<tr><td><code>DEFERRED_WORKFLOW_MODULES</code></td><td><code>READ_ONLY_MODULES</code></td></tr>
</tbody></table></div>
<p>Net effect: <b>about 1,500 lines removed</b> from the two adapters, plus 31 audit call sites and ten database functions.</p>
`);

/* ------------------------------------------------------------------------- */

add("release", "Release, hosting and verification", `
<h3>Release checklist</h3>
<p>Four gates, all offline except the last. They take seconds and they exist because every one of them corresponds to a bug that already happened.</p>
<ol class="steps">
  <li><code>node STAGE-14-HARNESS.mjs</code>, must be 190/190.</li>
  <li><code>node VERIFY-STATIC.mjs</code>, page and script structure.</li>
  <li><code>node SCHEMA-DRIFT-CHECK.mjs</code>, adapters, files and database agree.</li>
  <li><code>node STAGE-SQL-LINT.mjs</code>, every migration file clean.</li>
  <li><code>VERIFY-INVARIANTS.sql</code> in the SQL editor, after any migration.</li>
  <li>Bump <code>VERSION</code> and every cache-bust. <code>VERIFY-STATIC.mjs</code> fails if the pages disagree, so this is checked rather than remembered.</li>
  <li>Regenerate the specifications if behaviour, permissions or collections changed.</li>
  <li>Smoke test signed in: sign-in with authenticator, one page per navigation entry, one save, one workflow.</li>
</ol>
<div class="note">
  <b>If you add a check, prove it fails</b>
  Every gate above was verified by breaking the thing it guards and
  confirming it fired, swapping two script tags, loosening a CSP, unpinning the
  dependency, renaming a column in the manifest, granting <code>anon</code> access
  inside a transaction that rolled back. A check that has never failed is not known to
  work; it is only known to be quiet.
</div>

<h3>Content Security Policy</h3>
<p>Every application page carries:</p>
<pre><code>default-src 'self';
script-src 'self' https://cdn.jsdelivr.net;
style-src 'self';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' https://qmfigesgkoirirgpgmse.supabase.co;
object-src 'none'; base-uri 'self'; form-action 'self'</code></pre>
<ul>
  <li>No <code>unsafe-eval</code>. Keep it that way.</li>
  <li><b>No <code>unsafe-inline</code> for styles either.</b> Two things used to force
      it and both were fixed: three modules injected a <code>&lt;style&gt;</code>
      element at runtime, which a browser treats as an inline style regardless of
      where the CSS was authored; and nine pages carried 84 <code>style="..."</code>
      attributes, almost all column widths. All of it now lives in
      <code>ppm-shared.css</code>.</li>
  <li>The three specification and error pages are single-file by design, so they carry
      one inline <code>&lt;style&gt;</code> block each and name its <b>SHA-256 hash</b>
      in their own policy instead of allowing inline styles generally. The generator
      computes the hash from the same string it writes, so the two cannot drift.</li>
</ul>

<div class="warn">
  <b>A module must never inject a <code>&lt;style&gt;</code> element again</b>
  It will be blocked, and the component will render unstyled rather than error. The
  harness asserts that none of the four modules that used to do it still does.
  Setting <code>element.style.x</code> from JavaScript is unaffected by CSP and stays
  fine.
</div>

<h3>Pinned dependency</h3>
<pre><code>&lt;script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.2/dist/umd/supabase.js"
        integrity="sha256-BLlX8lY6QNywKx2db3p6I5c7+OvkwUNb5f6vJL/5ETQ="
        crossorigin="anonymous"
        referrerpolicy="no-referrer"&gt;&lt;/script&gt;</code></pre>
<p>
  It used to be <code>@supabase/supabase-js@2</code> - a floating major version with
  no integrity hash, meaning any release could ship new code into the application
  without an intentional change on this side.
</p>
<div class="note">
  <b>Why the unminified file, and why sha256</b>
  jsDelivr generates <code>.min.js</code> on the fly for packages that do not ship
  one, so its bytes are not published and are not guaranteed stable - an integrity
  hash against it could break without the package changing.
  <code>/dist/umd/supabase.js</code> is a real file in the published package with a
  published hash. jsDelivr's API exposes that hash as base64 SHA-256, which is
  exactly SRI's format; it was confirmed by hashing a small file from the same
  package and comparing.
</div>
<p><b>To move to a new version:</b></p>
<ol class="steps">
  <li>Resolve the version:
      <code>https://data.jsdelivr.com/v1/packages/npm/@supabase/supabase-js/resolved?specifier=2</code></li>
  <li>Read the hash for <code>/dist/umd/supabase.js</code> from
      <code>https://data.jsdelivr.com/v1/packages/npm/@supabase/supabase-js@&lt;version&gt;?structure=flat</code></li>
  <li>Update the URL and the <code>sha256-</code> value on all ${COUNTS.pages} pages together.</li>
  <li>Load one page and confirm sign-in works. <b>A wrong hash blocks the script
      entirely</b>, so the symptom is a completely dead page with a console error
      naming the integrity failure - obvious, but total.</li>
</ol>

<h3>Hosting</h3>
<p>
  GitHub Pages from a public repository. <code>.nojekyll</code> stops Jekyll
  processing; <code>404.html</code> gives a useful message rather than a bare error.
  The browser holds only the publishable key, which is designed to be public &mdash;
  it is row-level security that protects the data, which is why the security model
  must be treated as the product and not as configuration.
</p>

<h3>Backup and recovery</h3>
<p>
  Supabase automated backups and point-in-time recovery are the real protection.
  The in-app snapshot has two halves and the difference matters: <code>data</code> is the eight
  browser-only settings keys, which a restore writes back, and <code>collections</code> is a
  read-only copy of the portfolio as this browser had loaded it. Restore never writes the second
  half, it refuses database-backed collections and offers a comparison instead. It is a
  readable record, not a recovery artefact.
</p>
`);

/* ------------------------------------------------------------------------- */

add("backlog", "Known gaps and backlog", `
<h3>Open</h3>
<dl class="fields">
  <dt>The offline queue does not survive a reload</dt>
  <dd>An <code>offline</code> write is queued in memory and shown in the amber banner. Close the
      tab and the queued work is gone, the pending ledger records that it happened, but not
      what it was. Fixing it means persisting the queued records, which reintroduces a browser
      copy of portfolio data and needs deciding rather than assuming.</dd>

  <dt>The per-record History button only shows pre-migration events</dt>
  <dd><code>PPMChangeLog.historyFor()</code> reads <code>legacyAudit</code>, the browser rows
      recorded before Stage 14. Everything since is in <code>public.audit_log</code>, written by
      trigger, which the Audit History page reads but the per-record dialogue does not. So the
      button is honest but increasingly empty. It should read the database through
      <code>PPMDatabase.getAuditTrail()</code>.</dd>

  <dt>A plan task with an owner and no dates is invisible to resource management</dt>
  <dd><code>buildTimeline()</code> filters to tasks with both a start and a finish, so an owned but
      unscheduled task never appears on the Gantt and never counts towards allocation. That is a
      real state, work is often assigned before it is scheduled, and nothing on the
      page says it happened.</dd>

  <dt><code>reopenRaidItem()</code> has no caller</dt>
  <dd>Complete code for reopening a closed RAID item after a recurrence, with no button and no
      wiring. Either connect it or delete it; leaving it reads as a feature.</dd>
</dl>

<h3>Recently closed</h3>
<div class="ok">
  <b>The gaps this section listed have been fixed</b>
  Recorded here rather than deleted, because "why is it like this" is usually asked
  about the fix, not the gap.
</div>
<div class="scroll"><table>
<thead><tr><th>Was</th><th>Now</th></tr></thead>
<tbody>
<tr>
  <td>One 503 made the whole page do nothing</td>
  <td>GitHub Pages answered <code>ppm-project-forms.js</code> with a transient 503. The page
      loader stopped at the first rejection, so every script after it - including the page's
      own - never loaded: static shell, no data, no working buttons, and a console error
      naming a module nobody would connect with "nothing works". It now retries once and
      carries on, reporting what failed. A page missing one module is degraded in one place;
      a page missing every module after the first failure is broken everywhere, invisibly.</td>
</tr>
<tr>
  <td><code>PPMAdmin</code> did not exist, for three commits</td>
  <td><code>audit</code> was listed in its export object and no function of that name was in
      the file - a leftover from retiring the local audit helper. A shorthand property naming
      an undefined identifier throws while the object is built, so <code>window.PPMAdmin</code>
      was never assigned and <code>seedDefaults()</code> never ran. Nothing static catches it:
      the file parses, and the reference is only evaluated on load. Most callers guard with
      <code>window.PPMAdmin ? ...</code>, so it read as "that module is optional". The harness
      now loads every shared module against a DOM stub and asserts each defines its global.</td>
</tr>
<tr>
  <td>Editing a project sent you to a page headed "Add project"</td>
  <td>Three purpose-built forms on the details page now, rendered from a generated field
      registry - see <b>Editing a project: three forms, on the details page</b>. The first
      attempt at this hosted the creation form inside the details page; it reused the code but
      kept the coupling, and fell back to navigating away on any failure, which is exactly the
      behaviour it was meant to remove.</td>
</tr>
<tr>
  <td>Hydration emptied every collection below <code>aal2</code></td>
  <td>Every table's restrictive policy filters every row out below <code>aal2</code>, and
      PostgREST reports that as a successful empty result. Every write path checked the
      assurance level; the read path checked only that a session existed - so hydration
      wrote <code>[]</code> over all ${COUNTS.collections} collections and reported success. Because the
      session is per tab in <code>sessionStorage</code> and the mirror was per profile in
      <code>localStorage</code>, one tab between password and authenticator emptied the
      data every other tab was showing. Both adapters now skip hydration below
      <code>aal2</code> with one warning, and the harness asserts both directions.</td>
</tr>
<tr>
  <td>Eight page scripts still injected <code>style</code> attributes</td>
  <td>The CSP tightening moved the style attributes out of the HTML files but not out of
      the markup the scripts build, and the gate only read the HTML. The browser dropped
      all of them: the Allocation Gantt collapsed to one coloured block, the project
      plan's dependency overlay lost its box and drew its links across the whole page,
      and register columns lost their widths. Computed geometry now goes through
      <code>PPMCore.styleAttribute()</code> and <code>applyComputedStyles()</code>, which
      write it with CSSOM - outside what CSP governs - and fixed declarations became
      classes. <code>VERIFY-STATIC.mjs</code> now scans the JavaScript too.</td>
</tr>
<tr>
  <td>The harness raced the code it was testing</td>
  <td>It loaded both adapters and began asserting immediately, while
      <code>ppm-page-loader.js</code> waits for hydration before any page script runs. So
      results depended on how many microtask turns the adapters happened to take: adding
      two awaits inside <code>hydrate()</code>, without changing what it does, moved a
      snapshot against a test write and produced a spurious soft delete 300 lines later.
      It now waits the way the loader does.</td>
</tr>
<tr>
  <td>The foundation adapter had no <code>writeGlobal</code> seam</td>
  <td>Overtaken. Both seams and the function they wrapped are deleted; there is one write path
      and it returns a result. See <a href="#seams">one write seam</a>.</td>
</tr>
<tr>
  <td><code>supabase-js@2</code> floating, no integrity hash</td>
  <td>Pinned to <code>2.112.2</code> with a verified SHA-256 SRI hash and
      <code>crossorigin</code>, on all ${COUNTS.pages} pages.</td>
</tr>
<tr>
  <td><code>resource_absence</code> readable by everyone</td>
  <td>Its read policy was literally <code>true</code>. Now
      <code>private.can_access_absence()</code>: absence visibility follows person
      visibility, so it cannot drift from it. Writes narrowed the same way.</td>
</tr>
<tr>
  <td>&ldquo;This people was changed by someone else&rdquo;</td>
  <td>Every collection has an explicit human label. Two stale messages that still
      told the user to &ldquo;cut the collection over&rdquo; were fixed at the same
      time.</td>
</tr>
<tr>
  <td><code>style-src 'unsafe-inline'</code></td>
  <td>Removed. Three injected <code>&lt;style&gt;</code> blocks and 84 inline
      attributes moved into <code>ppm-shared.css</code>; the single-file documents use
      a style hash instead. The scripts were missed at the time - see the first two rows
      of this table.</td>
</tr>
<tr>
  <td>A checkout could fail the release gate on its own</td>
  <td>The two generated specifications name the SHA-256 hash of their own
      <code>&lt;style&gt;</code> block. <code>.gitattributes</code> normalised their line
      endings on checkout, which changed the bytes and therefore the hash, so a clean
      clone failed the gate with nothing wrong in the source. Both are now
      <code>-text</code>, for the same reason the vendored libraries are.</td>
</tr>
<tr>
  <td><code>VERSION</code> drifted a build behind the pages</td>
  <td>The gate checked that all 320 cache-busts agreed with each other but never that
      they agreed with <code>VERSION</code>, so the file said <code>2026.08.08.15</code>
      while every page loaded <code>2026.08.09.02</code>. Now checked.
      <code>BUMP-VERSION.mjs</code> also stamps the loader's
      <code>data-ppm-scripts</code> list, which it never saw and which was being kept in
      step by hand, and the gate now requires those entries to be stamped too,
      via the same function that writes them.</td>
</tr>
<tr>
  <td>Unverified browser audit residue</td>
  <td>The Audit History page now says how many unverified events this browser holds
      and offers <b>Download and clear them</b>, which archives to a file first and
      only clears if that succeeded.</td>
</tr>
</tbody></table></div>

<h3>Still open</h3>
<div class="scroll"><table>
<thead><tr><th>Gap</th><th>Impact</th><th>Suggested fix</th></tr></thead>
<tbody>
<tr>
  <td>Leaked-password protection is not enabled in Supabase Auth</td>
  <td>Users may choose known-breached passwords</td>
  <td>Enable it in the Auth settings. Dashboard toggle, no code.</td>
</tr>
<tr>
  <td>Only administrator-level testers have signed in</td>
  <td>The narrow scopes are the least exercised part of row-level security, and they
      are the part most likely to be wrong</td>
  <td>Onboard one Selected-projects and one Team-projects tester. The demo data has
      both waiting: RES-0106 and RES-0116 for Selected, RES-0109 and RES-0110 for
      Team.</td>
</tr>
<tr>
  <td>The specification documents are not linked from inside the tool</td>
  <td>Testers have to be told the URL</td>
  <td>Add a link in the navigation or on Home</td>
</tr>
<tr>
  <td>Utility classes in <code>ppm-shared.css</code></td>
  <td><code>.mw-145</code> holds a column width that arguably belongs in the page
      stylesheet</td>
  <td>Fold them into named classes per page over time. They are a migration aid, and
      the file says so.</td>
</tr>
<tr>
  <td>The pinned dependency needs manual review</td>
  <td>Pinning stops surprise changes but also stops security fixes arriving</td>
  <td>Check for a new version on a schedule, and follow the steps under
      <a href="#release">Pinned dependency</a></td>
</tr>
</tbody></table></div>

<h3>If you change one thing after reading this</h3>
<p>
  Verify against the live database rather than the SQL files. That single habit found
  the renamed column, the <code>anon</code> grants, the missing version column, a
  visibility hole that would have made three of five people vanish, and the absence
  policy that was quietly readable by everyone. The files describe intent; the
  database is the fact.
</p>
`);

/* ------------------------------------------------------------------------- */

const html = shell({
  file: "DEVELOPER-SPECIFICATION.html",
  title: "Developer Specification",
  kicker: "Portfolio Manager",
  lede:
    "Architecture, data model, security model, workflows and triggers, and how to change, extend, maintain and debug all of it. Written for whoever has to work on this next.",
  audience: "For developers and database administrators",
  maintenance:
    "Maintained through the build scripts: change the source and re-run rather than editing this " +
    "HTML, which is overwritten on each build. See Release and verification.",
  sections
});

writeFileSync(join(HERE, "DEVELOPER-SPECIFICATION.html"), html, "utf8");
console.log(
  `DEVELOPER-SPECIFICATION.html written (${sections.length} sections, ${Math.round(html.length / 1024)} KB, ${Object.keys(MODULES).length} collections documented)`
);
