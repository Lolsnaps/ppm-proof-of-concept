/*
  Content for USER-SPECIFICATION.html - the document for people who use the tool:
  administrators, project managers, sponsors, PMO, resource managers, executives
  and auditors.

  It contains no code. Where behaviour is enforced by the database
  rather than by the screen, it says so, because that is the difference between
  "the button is hidden" and "it cannot be done".
*/

import {
  permissionMatrix,
  roleCards,
  ROLE_NAMES,
  ALL_PERMISSIONS,
  shell,
  HERE,
  join,
  writeFileSync
} from "./BUILD-SPECIFICATIONS.mjs";

const sections = [];
const add = (id, title, html, subs) => sections.push({ id, title, html, subs });

/* ------------------------------------------------------------------------- */

add("about", "About this document", `
<p>
  This is the working specification for <b>Portfolio Manager</b>, the portfolio and project
  management tool. It covers what each page does, what each record holds, how the workflows move,
  and what each of the nine access roles can and cannot do.
</p>
<p>There is a second document written for a different audience:</p>
<ul>
  <li><b>This document</b> is for the people who use the tool day to day, and for the
      administrators who configure it and look after accounts.</li>
  <li><b><a href="DEVELOPER-SPECIFICATION.html">Developer specification</a></b> covers the
      architecture, the database, the security model, and how to change, extend and debug the
      system.</li>
</ul>

<div class="note">
  <b>This is a pilot</b>
  It is being tested with a small group. The data is real and is held in a hosted PostgreSQL
  database with row-level security, but features are still being added and the interface will
  change.
</div>

<h3>How to read the permission statements</h3>
<p>
  Where this document says who can do what, that is enforced in two different places and the
  difference matters:
</p>
<ul>
  <li><b>The database decides.</b> Whether you can read or change a record is enforced by the
      database itself, per row, on every request. Nothing the browser does gets past it.</li>
  <li><b>The screen tidies up.</b> Hidden buttons and greyed-out fields keep the interface honest
      and uncluttered. They are a convenience and not the security boundary.</li>
</ul>
<p>
  So if this document says a role cannot approve a budget, that is not just a missing button. The
  database refuses the change.
</p>
`);

/* ------------------------------------------------------------------------- */

add("signing-in", "Signing in", `
<p>
  You sign in with your email address and password, then a six-digit code from an authenticator
  app. The second step is not optional and cannot be turned off for an account. Until it is
  completed the database returns no data at all.
</p>

<h3>Your first sign-in</h3>
<p>An administrator creates your account and gives you a temporary password. After that:</p>
<ol class="steps">
  <li>Sign in with your email address and the temporary password.</li>
  <li><b>Set up your authenticator.</b> A QR code appears. Scan it with an authenticator app.
      Microsoft Authenticator, Google Authenticator, 1Password and Authy all work. If you cannot
      scan it, the page shows a key you can type in instead. Enter the six-digit code the app
      gives you.</li>
  <li><b>Choose your own password.</b> You have to replace the temporary one, because an
      administrator created it and could have seen it. Minimum twelve characters, and it has to be
      different from the temporary one.</li>
</ol>
<p>
  From then on, signing in is email, your password, then a fresh code from the authenticator.
</p>

<div class="warn">
  <b>Keep the authenticator app</b>
  You need a new code from it every time you sign in. If you lose access to it, an administrator
  has to reset the enrolment for you. There is no self-service route, and that is on purpose.
</div>

<h3>If you cannot get in</h3>
<dl class="fields">
  <dt>The password is rejected</dt>
  <dd>Ask an administrator to issue a new temporary password. You will be asked to change it on
      your next sign-in.</dd>
  <dt>The code is rejected</dt>
  <dd>Authenticator codes are time-based, so check your phone's clock is set automatically. Codes
      expire roughly every 30 seconds, so wait for a fresh one rather than reusing the same
      digits.</dd>
  <dt>You sign in but every page is empty</dt>
  <dd>Almost always this means the authenticator step did not complete. Sign out and back in. If
      it keeps happening, your person record may not be linked to your login, or your account
      status may not be Active. Both are administrator fixes.</dd>
  <dt>&ldquo;That page does not exist&rdquo;</dt>
  <dd>Either a mistyped address or an old bookmark. Sign in and use the navigation across the top
      instead of typing addresses.</dd>
</dl>
`);

/* ------------------------------------------------------------------------- */

add("structure", "How the portfolio is structured", `
<p>Work is organised in three levels, plus the people who deliver it.</p>

<dl class="fields">
  <dt>Portfolio</dt>
  <dd>The top level. Holds the financial year, reporting frequency, total budget and currency.
      There is normally one.</dd>
  <dt>Programme</dt>
  <dd>A group of related projects with a shared objective, sponsor and budget. Every project
      belongs to exactly one programme.</dd>
  <dt>Project</dt>
  <dd>The unit of delivery. Everything else in the tool hangs off a project: the plan, milestones,
      RAID, actions, decisions, benefits, financials, resource demand, status reports and stage
      gates.</dd>
  <dt>Resource</dt>
  <dd>A person, or a placeholder for a role that has not been filled. Resources own tasks and
      records, appear in capacity planning, and may or may not have a login.</dd>
</dl>

<div class="note">
  <b>A resource is not the same thing as an account</b>
  Everyone who does work is a resource, whether or not they can sign in. Contractors who never log
  in, vacancies with no name against them yet, and people who have left all stay on as resources
  so that history keeps making sense. Giving someone a login is a separate step.
</div>

<h3>Identifiers</h3>
<p>Every record carries a readable identifier, and these show up throughout reporting:</p>
<div class="scroll"><table>
<thead><tr><th>Prefix</th><th>Record</th><th>Example</th></tr></thead>
<tbody>
<tr><td><code>PORT-</code></td><td>Portfolio</td><td><code>PORT-00001</code></td></tr>
<tr><td><code>PRG-</code></td><td>Programme</td><td><code>PRG-00001</code></td></tr>
<tr><td><code>PRJ-</code></td><td>Project</td><td><code>PRJ-00006</code></td></tr>
<tr><td><code>RES-</code></td><td>Resource</td><td><code>RES-0103</code></td></tr>
<tr><td><code>TSK-</code></td><td>Plan task</td><td><code>TSK-00006-004</code></td></tr>
<tr><td><code>MST-</code></td><td>Milestone</td><td><code>MST-00006-02</code></td></tr>
<tr><td><code>RAID-</code></td><td>Risk, assumption, issue or dependency</td><td><code>RAID-00007-001</code></td></tr>
<tr><td><code>ACT-</code></td><td>Action</td><td><code>ACT-00006-001</code></td></tr>
<tr><td><code>DEC-</code></td><td>Decision</td><td><code>DEC-00007-002</code></td></tr>
<tr><td><code>DOC-</code></td><td>Document link</td><td><code>DOC-00006-003</code></td></tr>
<tr><td><code>STS-</code></td><td>Status report</td><td><code>STS-00006-003</code></td></tr>
<tr><td><code>SG-</code></td><td>Stage gate</td><td><code>SG-00006-03</code></td></tr>
<tr><td><code>BEN-</code></td><td>Benefit</td><td><code>BEN-00006-01</code></td></tr>
<tr><td><code>FIN-</code>, <code>FE-</code>, <code>FAR-</code></td><td>Financial record, cost line, budget request</td><td><code>FAR-00007-002</code></td></tr>
<tr><td><code>DEM-</code></td><td>Resource demand</td><td><code>DEM-00006-04</code></td></tr>
<tr><td><code>BL-</code>, <code>BLR-</code></td><td>Plan baseline, rebaseline request</td><td><code>BL-00006-001</code></td></tr>
<tr><td><code>ABS-</code></td><td>Absence</td><td><code>ABS-0004</code></td></tr>
</tbody></table></div>

<div class="warn">
  <b>A project code cannot be changed once it is set</b>
  Plans, RAID, financials, benefits and every other child record are joined to the project by its
  code. The same goes for a resource identifier. The database refuses to change either, because
  doing so would orphan everything attached to it.
</div>
`);

/* ------------------------------------------------------------------------- */

add("pages", "The pages", `
<p>The navigation across the top shows you every page your role allows.</p>

<div class="scroll"><table>
<thead><tr><th>Page</th><th>What it is for</th><th>Needs</th></tr></thead>
<tbody>
<tr><td><b>Home</b></td><td>Your dashboard. What is assigned to you, what is overdue, and what needs a decision from you.</td><td><code>home.view</code></td></tr>
<tr><td><b>Projects</b></td><td>The project list. Filter, sort, open, create, duplicate and archive.</td><td><code>projects.view</code></td></tr>
<tr><td><b>Project details</b></td><td>One project in full, with every field grouped by lifecycle stage, plus its documents and gates.</td><td><code>projects.view</code></td></tr>
<tr><td><b>Add project</b></td><td>Creates a new project. Editing an existing one happens on its own details page, see <a href="#editing">Editing a project</a>.</td><td><code>projects.create</code></td></tr>
<tr><td><b>Programmes</b></td><td>Programme list and detail, with the projects inside each one.</td><td><code>programmes.view</code></td></tr>
<tr><td><b>Milestones</b></td><td>Milestones across the portfolio, showing baseline against forecast.</td><td><code>milestones.view</code></td></tr>
<tr><td><b>Project plan</b></td><td>Task level plan. Phases, owners, dependencies, effort, progress, critical path and slippage.</td><td><code>plan.view</code></td></tr>
<tr><td><b>Stage gates</b></td><td>Governance. Submit a gate, approve, reject or defer it, and read the decision history.</td><td><code>stageGates.view</code></td></tr>
<tr><td><b>RAID log</b></td><td>Risks, assumptions, issues and dependencies, with scoring and escalation.</td><td><code>raid.view</code></td></tr>
<tr><td><b>Registers</b></td><td>Four registers on one page: actions, decisions, documents and status reports.</td><td><code>registers.view</code></td></tr>
<tr><td><b>Benefits</b></td><td>Benefits at project and programme level, with baseline, target and measurement.</td><td><code>benefits.view</code></td></tr>
<tr><td><b>Resources</b></td><td>The resource directory. People, teams, capacity and account status.</td><td><code>resources.view</code></td></tr>
<tr><td><b>Resource management</b></td><td>Demand against capacity, utilisation, conflicts, absence and scenarios.</td><td><code>resourceManagement.view</code></td></tr>
<tr><td><b>Financials</b></td><td>Budgets, forecasts, actuals, variance, cost lines and budget approvals.</td><td><code>financials.viewRag</code> at minimum</td></tr>
<tr><td><b>Reports &amp; dashboards</b></td><td>Portfolio reporting, saved views and exports.</td><td><code>reports.view</code></td></tr>
<tr><td><b>Audit history</b></td><td>Read-only record of who changed what, when, and where in the tool.</td><td><code>audit.view</code></td></tr>
<tr><td><b>Search</b></td><td>Search everything you are allowed to see, across all record types.</td><td><code>search.use</code></td></tr>
<tr><td><b>Administration</b></td><td>Configuration. Lifecycle templates, reference data, reporting calendars, mandatory rules, thresholds, cost categories and data tools.</td><td><code>administration.view</code></td></tr>
</tbody></table></div>

<p>
  If a page is missing from your navigation, your role does not include the permission for it.
  That is intended and is not a fault.
</p>
`);

/* ------------------------------------------------------------------------- */

add("roles", "Roles and what each one can do", `
<p>
  There are nine roles. Your role sets what <i>kinds</i> of things you can do, and your
  <a href="#scopes">access scope</a> sets <i>which records</i> you can do them to. Both apply at
  the same time.
</p>

<div class="callout">
  <b>One person can hold more than one role.</b>
  Your permissions are then everything all of your roles allow, added together. Adding a role
  never takes anything away.
</div>

<p>
  This matters more than it sounds. The roles are shaped around jobs, and one person often does
  two of them. The clearest example is an executive who also sponsors a project:
</p>
<div class="scroll"><table>
<thead><tr><th></th><th>Executive / Steering User</th><th>Project Sponsor / Project Lead</th><th>Both</th></tr></thead>
<tbody>
<tr><td>Which projects they see</td><td>every project in the portfolio</td><td>only the ones they are named on</td><td>every project</td></tr>
<tr><td>Sees budgets and forecasts</td><td>yes</td><td>yes</td><td>yes</td></tr>
<tr><td>Approves rebaselines and budgets</td><td><b>no</b></td><td>yes</td><td><b>yes</b></td></tr>
<tr><td>Approves a stage gate they are <i>named</i> on</td><td>yes</td><td>yes</td><td>yes</td></tr>
<tr><td>Approves any stage gate on a project they can see</td><td><b>no</b></td><td>yes</td><td><b>yes</b></td></tr>
<tr><td>Posts a status update</td><td>no</td><td>yes</td><td>yes</td></tr>
</tbody>
</table></div>
<p>
  With one role either way round they get portfolio visibility or approval authority, but not
  both. Held together they get what the job actually needs. An administrator sets this on the
  <b>Resources</b> page, by choosing a permission level plus any number of additional roles. The
  page shows you how many permissions the combination grants as you go.
</p>
<div class="callout">
  <b>Stage gates are the exception. Being named beats the role.</b>
  If somebody is listed as a required approver on a gate, they can decide it whatever their role
  says. See <a href="#named-approver">Being named as an approver is the authority</a>. Every
  other approval in the tool still needs the role, including rebaselines, budgets and resource
  scenarios. So if somebody cannot approve one of those, an additional role is the answer.
</div>

${roleCards()}

<h3 id="matrix">The full permission matrix</h3>
<p>
  All ${ALL_PERMISSIONS.length} permissions across all ${ROLE_NAMES.length} roles.
  This table is generated directly from the tool's own configuration, so it cannot
  drift from what the software actually does.
</p>
<p class="pill">Admin = System Administrator &nbsp; PfM = Portfolio / PMO Manager &nbsp; PM = Project Manager &nbsp; PMO = PMO Analyst &nbsp; Spon = Sponsor / Project Lead &nbsp; ResM = Resource / Team Manager &nbsp; Team = Project Team Member &nbsp; Exec = Executive / Steering &nbsp; Audit = Read-only / Auditor</p>

${permissionMatrix()}

<h3>Separations of duty</h3>
<dl class="fields">
  <dt>Only the System Administrator can manage users</dt>
  <dd><code>users.manage</code> is the single permission the Portfolio Manager does
      not have. Setting somebody's role, scope or account status is kept apart from running the portfolio on
      purpose.</dd>
  <dt>Nobody can change their own access</dt>
  <dd>Even a System Administrator cannot alter their own role, scope, account status
      or permissions. Another administrator must do it. This is enforced by the
      database, not the screen.</dd>
  <dt>Submitting and approving are different permissions</dt>
  <dd><code>stageGates.submit</code> and <code>stageGates.approve</code> are
      separate, as are <code>plan.requestBaseline</code> and
      <code>plan.approveBaseline</code>. A Project Manager can ask; a sponsor or
      PMO manager decides. The PMO Analyst role exists so that data can be maintained by somebody who cannot then
      approve it themselves.</dd>
  <dt>Nobody approves their own submission</dt>
  <dd>This applies even where being named gives the authority. Whoever submitted a gate cannot be
      one of its required approvers and cannot decide it. No role gets you past separation of
      duties.</dd>
  <dt>Financial visibility has two levels</dt>
  <dd><code>financials.viewRag</code> shows only whether finances are Green, Amber
      or Red. <code>financials.viewDetail</code> shows the actual numbers. A Project
      Team Member gets the first and not the second.</dd>
  <dt>Contact details are separately controlled</dt>
  <dd><code>resources.viewContact</code> governs email addresses and contact
      information, apart from seeing that a person exists.</dd>
  <dt>An override is narrower than a role</dt>
  <dd>A single permission can be allowed or refused for one person, on top of whatever their roles
      say. Use an override for a one-off exception, and a second role when somebody simply does
      two jobs. Overrides are easy to forget about later, whereas a role explains itself.</dd>
</dl>
`);

/* ------------------------------------------------------------------------- */

add("scopes", "Access scopes: which records you see", `
<p>
  Your role says what you may do. Your scope says which records you may do it to.
  There are four, and they are enforced by the database on every read and write.
</p>

<div class="scroll"><table>
<thead><tr><th>Scope</th><th>You can see</th><th>Typically</th></tr></thead>
<tbody>
<tr>
  <td><b>Portfolio-wide</b></td>
  <td>Every project, programme and portfolio.</td>
  <td>Administrators, PMO, executives</td>
</tr>
<tr>
  <td><b>Assigned projects</b></td>
  <td>Projects where you are named in a role, project manager, sponsor,
      project lead, deputy, business analyst, technical lead, benefit owner or
      financial owner &mdash; <i>or</i> where you hold resource demand.</td>
  <td>Project managers, sponsors, team members</td>
</tr>
<tr>
  <td><b>Team projects</b></td>
  <td>Projects your team is involved in: where a teammate leads it, where a demand
      row is coded to your team, where demand is assigned to a teammate, or where a
      plan task is owned by someone on your team.</td>
  <td>Resource and team managers</td>
</tr>
<tr>
  <td><b>Selected projects</b></td>
  <td>Only the specific projects named on your record, and nothing else.</td>
  <td>Auditors, interim staff, external reviewers</td>
</tr>
</tbody></table></div>

<div class="note">
  <b>Under &ldquo;Assigned projects&rdquo;, access comes from being named on the project</b>
  If a project manager cannot see their project, the usual cause is that they are not actually
  recorded in a named role on it. The fix is to add them as project manager on the project record,
  not to change their permissions.
</div>

<h3>How scopes interact with people</h3>
<p>
  Which <i>people</i> you can see follows similar rules. You can always see
  yourself. Beyond that you can see anyone on your own team, anyone named on a
  project you can access, and, if you are Portfolio-wide, everyone.
</p>
<div class="warn">
  <b>An inactive or disabled account sees nothing</b>
  The visibility rules require the viewer to be active with an Active account status. Somebody who
  has been deactivated stops being able to read anything at all. That is intended, but it does mean
  deactivating the wrong person locks them out straight away.
</div>
`);

/* ------------------------------------------------------------------------- */

add("editing", "Editing a project", `
<p>
  Everything about a project is edited on its own <b>Project details</b> page. Three buttons
  open three different forms, in a panel on that page. Nothing takes you to another screen,
  and none of them is the <b>Add project</b> form.
</p>

<div class="scroll"><table>
<thead><tr><th>Button</th><th>Fields</th><th>Use it when</th><th>Needs</th></tr></thead>
<tbody>
<tr>
  <td><b>Edit project details</b></td><td>43</td>
  <td>Something about what the project <i>is</i> has changed: its name, who is accountable for
      it, what it is delivering, its strategic context. Rarely, once a project exists.</td>
  <td><code>projects.edit</code></td>
</tr>
<tr>
  <td><b>Update project status</b></td><td>32</td>
  <td>Every reporting cycle. This is the weekly job, and it is intentionally the smallest of the
      three.</td>
  <td><code>projects.status</code></td>
</tr>
<tr>
  <td><b>Edit assurance evidence</b></td><td>38</td>
  <td>A stage is approaching or has completed and the evidence that gate expects needs
      recording. Grouped by stage, so only the stage you are at is in front of you.</td>
  <td><code>projects.edit</code></td>
</tr>
</tbody></table></div>

<h3>What the status update asks for, in order</h3>
<p>The order is the order a reporting conversation actually happens in:</p>
<ol class="steps">
  <li><b>Where it stands now</b>, current position, next steps, and if the dates have
      moved, why and what is being done about it. Then the stage it is at, the stage it is
      going to, and the forecast start and end dates.</li>
  <li><b>RAG assessment</b>, the nine dimensions and delivery confidence. This comes
      after the commentary because it is a judgement about everything above it.</li>
  <li><b>Progress and approval</b>, status, percentage complete, approval status.</li>
  <li><b>Other dates</b>, baselines, actuals, closure, the stage-gate dates. Real, but
      rarely touched in a weekly update.</li>
</ol>
<p>
  Each group opens and closes, and the first one is open when the form appears. The field count
  on each heading tells you how much is inside before you open it.
</p>

<h3>Two things the form will not let you do</h3>
<dl class="fields">
  <dt>Save a reported RAG that differs from the calculated one, without saying why</dt>
  <dd>Each RAG shows what the rules calculate next to what you have reported, coloured green,
      amber, red or grey. Where the two differ the form asks for a reason and will not save
      until it has one. Overriding is allowed, the rules cannot know everything &mdash;
      but an unexplained override is indistinguishable from a mistake when somebody reads it
      back in three months.</dd>
  <dt>Save dates that run backwards</dt>
  <dd>An end date before its start date is refused, for baseline, forecast and actual dates
      alike. Percentage complete must be between 0 and 100.</dd>
</dl>

<div class="note">
  <b>Saving a status update also records a RAG snapshot</b>
  The RAG reporting history is append-only: it is a record of what was reported and when. The
  correction for a wrong status is a new update, never an edit of the old one.
</div>

<h3>If somebody else edited it while you had the form open</h3>
<p>
  You will be told the record changed, and nothing you typed will be written over their
  change. Reload the page and reapply your edit. This is the concurrency protection working;
  the tool would rather interrupt you than lose one of the two edits silently.
</p>
`);

/* ------------------------------------------------------------------------- */

add("notifications", "Notifications: how the tool decides who to tell", `
<p>
  The bell in the top right collects everything that is waiting for <b>you</b>. It is not a feed of
  everything happening in the portfolio.
</p>

<div class="callout">
  <b>Notifications follow the person, not the role.</b>
  You are told about something because you are named on it, as the approver, the owner, the task
  owner or the submitter. Not because your role could in principle see it.
</div>

<p>That means the tool tells you about:</p>
<div class="scroll"><table>
<thead><tr><th>You get told when</th><th>Because you are</th></tr></thead>
<tbody>
<tr><td>A stage gate, budget request, rebaseline or resource scenario is waiting for a decision</td><td>the named approver on it</td></tr>
<tr><td>A decision you asked for has been approved or rejected</td><td>the person who requested it</td></tr>
<tr><td>A plan task is due today or overdue</td><td>the task owner, or the project manager, if the task has no owner</td></tr>
<tr><td>A RAID item is due for review, past its target date or needs escalating</td><td>its owner</td></tr>
<tr><td>An action or a decision is overdue</td><td>its owner</td></tr>
<tr><td>A milestone or a benefit review is due</td><td>the owner of it</td></tr>
<tr><td>A status report is due, or one you submitted was returned</td><td>the project manager</td></tr>
<tr><td>Unfilled resource demand or an absence needs reviewing</td><td>the manager of that team</td></tr>
</tbody></table></div>

<p>
  Two things follow from that. If you are not being told about something you expected, the likely
  cause is that you are not recorded as the owner or approver on the record, rather than a
  permission problem. And nobody is told about work assigned to someone else, so an unassigned
  overdue task is nobody's notification. Assign an owner and it becomes somebody's.
</p>

<div class="note">
  <b>If you are named on something your role cannot decide</b>
  For a <b>stage gate</b> this no longer happens. Being named is the authority, so if it is in your
  list you can act on it. For anything else, such as a rebaseline, a budget request or a resource
  scenario, you are still told, and the notification says your access roles cannot act on it and to
  ask an administrator. The usual fix is an additional role rather than an exception, see
  <a href="#roles">Roles and what each one can do</a>. Staying silent would leave the record
  waiting indefinitely, with the one person who could chase it unaware of it.
</div>

<h3>Using the panel</h3>
<p>
  The bell shows a count of anything unread. Clicking it opens the panel over the page; clicking
  the bell again, or anywhere outside the panel, closes it. Each entry links straight to the
  record it is about.
</p>
<p>
  Marking a notification read is per person and per browser. It does not change the record and it
  does not affect anybody else's list. It also does not make the underlying thing go away. An
  overdue action you have dismissed is still overdue and will reappear on another browser. The
  list is worked out fresh from the records every time a page loads, so it cannot drift out of
  step with what is actually there.
</p>
`);

/* ------------------------------------------------------------------------- */

add("project-record", "The project record, field by field", `
<p>
  A project holds a lot. The form groups fields by the lifecycle stage at which
  they are normally filled in, so early-stage projects are not confronted with
  closure fields. Nothing stops you filling anything in early.
</p>

<h3>Identity and classification</h3>
<dl class="fields">
  <dt>Project ID</dt><dd>Generated, unique, permanent.</dd>
  <dt>Project name, short name, former name</dt><dd>Short name is used where space is tight; former name keeps a renamed project findable.</dd>
  <dt>Description</dt><dd>What the project is, in a few sentences.</dd>
  <dt>Programme / workstream</dt><dd>Which programme this belongs to. Drives programme reporting.</dd>
  <dt>Portfolio</dt><dd>Which portfolio, and therefore which financial year and reporting calendar apply.</dd>
  <dt>Project type</dt><dd>Change project, Regulatory, Technology, Product, Operational, M&amp;A or BAU. Can drive which gate rules are mandatory.</dd>
  <dt>Project classification</dt><dd>Local categorisation, configurable in Administration.</dd>
  <dt>Business area</dt><dd>Which part of the business owns the outcome.</dd>
  <dt>Confidentiality classification</dt><dd>Internal, Confidential, Highly Confidential or Restricted. Informs handling, and is inherited by document links.</dd>
  <dt>Priority and business priority</dt><dd>Critical, High, Medium or Low.</dd>
  <dt>Lifecycle template and version</dt><dd>Which set of stages and gate rules this project follows.</dd>
  <dt>Reporting frequency and calendar</dt><dd>How often status is expected, and against which period set.</dd>
</dl>

<h3>People</h3>
<p>Thirteen named roles can be recorded. Each stores the person's name, resource identifier and email together, so they cannot disagree:</p>
<p>
  <span class="pill">Requestor</span> <span class="pill">Project manager</span>
  <span class="pill">Sponsor</span> <span class="pill">Project lead</span>
  <span class="pill">Deputy project manager</span> <span class="pill">Business owner</span>
  <span class="pill">Technical lead</span> <span class="pill">Business analyst</span>
  <span class="pill">Test lead</span> <span class="pill">Change lead</span>
  <span class="pill">Finance contact</span> <span class="pill">Compliance contact</span>
  <span class="pill">Benefit owner</span>
</p>
<div class="note">
  <b>These fields are also access control</b>
  Being named here is what gives someone on &ldquo;Assigned projects&rdquo; scope
  sight of the project. Filling them in accurately is therefore not just good
  practice; it is how people get the access they need.
</div>

<h3>Status and health</h3>
<dl class="fields">
  <dt>Project status</dt><dd>Proposed, Planned, Active, On Hold, Completed, Cancelled or Archived.</dd>
  <dt>Current stage and next stage</dt><dd>Where the project is in its lifecycle.</dd>
  <dt>Overall RAG</dt><dd>The headline. <span class="pill g">Green</span> <span class="pill a">Amber</span> <span class="pill r">Red</span> or Not Assessed.</dd>
  <dt>Dimension RAGs</dt><dd>Schedule, Scope, Financial, Resource, Risk, Benefits, Quality and Operational readiness, each rated separately. See <a href="#rag">how RAG works</a>.</dd>
  <dt>Delivery confidence</dt><dd>High, Medium or Low, a judgement about the plan, distinct from current health.</dd>
  <dt>Percentage complete</dt><dd>0 to 100.</dd>
  <dt>Current position</dt><dd>Where things actually stand. The single most-read field in reporting.</dd>
  <dt>Next steps</dt><dd>What happens next, and by when.</dd>
  <dt>Reason for slippage</dt><dd>Required in practice whenever forecast has moved past baseline. Explains the cause, not the symptom.</dd>
  <dt>Return to green</dt><dd>What is being done, by whom, by when. An Amber or Red project without this is not being managed.</dd>
</dl>

<h3>Dates</h3>
<dl class="fields">
  <dt>Baseline start and end</dt><dd>The agreed plan. Once a baseline is approved, these can only change through an approved rebaseline, the database enforces it.</dd>
  <dt>Forecast start and end</dt><dd>What you now expect. The gap against baseline is slippage.</dd>
  <dt>Actual start and end</dt><dd>What happened.</dd>
  <dt>Target implementation date</dt><dd>When the change is intended to land.</dd>
  <dt>Approved implementation date</dt><dd>The date governance actually approved.</dd>
  <dt>Mandatory delivery date</dt><dd>An externally imposed deadline, typically regulatory. Distinguishes &ldquo;we would like to&rdquo; from &ldquo;we must&rdquo;.</dd>
  <dt>Date logged, proposed start, closure date</dt><dd>Intake and closure bookkeeping.</dd>
  <dt>Next stage gate date</dt><dd>When the next governance review is expected.</dd>
</dl>

<h3>Scope and case</h3>
<dl class="fields">
  <dt>High-level scope / in scope / out of scope</dt><dd>What is included, and explicitly what is not. The out-of-scope field prevents most scope arguments.</dd>
  <dt>Business problem</dt><dd>The problem being solved, with evidence where possible.</dd>
  <dt>Desired outcome, customer outcome</dt><dd>What good looks like, for the business and for members.</dd>
  <dt>Strategic driver, strategic objective, regulatory driver</dt><dd>Why this, why now, and whether an external obligation applies.</dd>
  <dt>Expected benefits, success measures, benefit measures</dt><dd>What will improve, how it will be measured, and from what source.</dd>
  <dt>Assumptions and constraints</dt><dd>What is being taken as true, and what limits the approach.</dd>
  <dt>Strategic and delivery dependencies</dt><dd>What this needs from elsewhere.</dd>
  <dt>Additional stakeholders</dt><dd>Who else must be consulted or informed.</dd>
</dl>

<h3>Stage-specific fields</h3>
<p>
  The remaining fields belong to particular stages and appear in the matching
  section of the form: discovery deliverables, solution options, requirements
  approval status, delivery plan summary, resource demand summary, cost estimate and
  funding source, test approach and test dates status, defects and blockers,
  operational readiness requirements and status, training and communications status,
  implementation approach, go-live criteria and approval, deployment dependencies,
  support model, hypercare plan, rollback plan, outstanding risks and issues, and
  then the closure set: closure summary, final financial position, outstanding
  actions, benefits handover, lessons learned, closure approval status and archive
  location.
</p>

<h3>Archiving</h3>
<p>
  Archiving a project sets <code>Archived</code>, records who archived it, when, and
  why, and remembers the status it held beforehand so it can be restored accurately.
  <b>Archived projects are read-only</b>, the database refuses edits to them
  and to their child records. Nothing is deleted.
</p>
`);

/* ------------------------------------------------------------------------- */

add("lifecycle", "Lifecycle, stages and stage gates", `
<h3>The default stages</h3>
<p>Eight stages, in order:</p>
<p>
  <span class="pill">Intake</span> &rarr; <span class="pill">Discovery</span> &rarr;
  <span class="pill">Requirements and Design</span> &rarr; <span class="pill">Build</span> &rarr;
  <span class="pill">Test</span> &rarr; <span class="pill">Implementation</span> &rarr;
  <span class="pill">Hypercare</span> &rarr; <span class="pill">Closure</span>
</p>
<p>
  Stages are configurable per lifecycle template in Administration, including which
  stages require a gate. Different project types can follow different templates.
</p>

<h3>What a stage gate is</h3>
<p>
  A stage gate is the formal decision to let a project move from one stage to the
  next. It records what was submitted, who approved it, when, on what conditions,
  and what actions came out of it.
</p>

<h4>Gate statuses</h4>
<div class="scroll"><table>
<thead><tr><th>Status</th><th>Meaning</th></tr></thead>
<tbody>
<tr><td><b>Draft</b></td><td>Being prepared. Editable. Every gate starts here, the database will not accept a new gate in any other status.</td></tr>
<tr><td><b>Submitted</b></td><td>Sent for decision. Now read-only outside the workflow.</td></tr>
<tr><td><b>Conditionally Approved</b></td><td>Approved subject to stated conditions.</td></tr>
<tr><td><b>Approved</b></td><td>Approved. The project may move to the proposed next stage.</td></tr>
<tr><td><b>Deferred</b></td><td>No decision yet; sent back for more work. Can be revised and resubmitted.</td></tr>
<tr><td><b>Rejected</b></td><td>Declined. Can be revised and resubmitted.</td></tr>
<tr><td><b>Cancelled</b></td><td>Withdrawn.</td></tr>
</tbody></table></div>

<h4>Governance route</h4>
<p>
  Some changes need a route through a wider governance body and some do not. The route requirement is <b>Required</b>, <b>Optional</b> or
  <b>Not Applicable</b>. Choosing Not Applicable is itself a claim that needs
  approving, so it carries its own approval status: Not Requested, Pending,
  Approved or Rejected. A stated reason is expected.
</p>

<h4>How a gate moves</h4>
<ol class="steps">
  <li>The project manager creates the gate in <b>Draft</b>, naming the current stage,
      the proposed next stage, the required approvers and the supporting pack.</li>
  <li>They <b>submit</b> it. This needs <code>stageGates.submit</code>. The gate
      becomes read-only and a submission record is kept.</li>
  <li>Each named approver <b>decides</b>. Approve, conditionally approve, defer or
      reject, with comments. Their approval is held against their own account.</li>
  <li>Once every required approver has given final approval the project's stage moves,
      actions arising are created in the action register, and the decision is written
      to the gate's history.</li>
</ol>

<h4 id="named-approver">Being named as an approver is the authority</h4>
<p>
  If somebody is listed as a required approver on a gate, they can decide that gate. Their access
  role does not have to include <code>stageGates.approve</code>, and the project does not have to
  fall inside their normal access scope.
</p>
<p>
  This is how approvals work outside software, and it is intentional here. An executive who wants
  a subject matter expert to sign off a technical gate can just name them. Before this change, the
  only way to arrange it was to change the expert's role, which would have altered what they could
  do on every other screen in the tool in order to sign one gate.
</p>

<div class="note">
  <b>What being named gives someone, and what it does not</b>
  A named approver can see the project's name, stage and dates, and the gates they are personally
  named on. They cannot see the project's plan, RAID, registers, financials, benefits or resources.
  They cannot see the project's other gates and they cannot edit anything. Naming somebody as an
  approver is not a way of giving them access to a project.
</div>

<p>The controls that make an approval mean something are all still in force:</p>
<ul>
  <li>Whoever submitted the gate cannot also be one of its required approvers.</li>
  <li>You cannot decide a gate you submitted or own.</li>
  <li>Only somebody actually on the approver list can decide.</li>
  <li>The approver list cannot be changed while a decision is being recorded.</li>
  <li>An approver can only change their own decision, not anybody else's.</li>
  <li>The decision is stamped with the authenticated identity of whoever made it, by
      the database rather than by the browser.</li>
  <li>Required approvers must be active people with active accounts at the moment of
      submission.</li>
</ul>

<div class="warn">
  <b>The trade-off</b>
  Whoever submits a gate now chooses who can approve it, without an administrator having to grant
  a role first. That is the intention, but it does mean the naming step is where the authority
  comes from, and it should be treated with the same care as any other governance decision. What
  stops it being misused is that the submitter cannot name themselves, and that every decision
  permanently records the person who made it.
</div>

<div class="note">
  <b>Gate history cannot be rewritten</b>
  Submission history, decision history and route approval history can only be added
  to by the workflow itself. Once a gate is past Draft, it cannot be edited or
  deleted, decided gates are governance evidence. Only Draft gates can be
  removed.
</div>

<h4>Stage override</h4>
<p>
  <code>stageGates.override</code> allows moving a project's stage without a gate.
  It requires a recorded reason, and the override is written to the audit trail as
  an override rather than an approval. It exists for genuine exceptions and shows up
  clearly in reporting when used.
</p>

<h4>Mandatory readiness rules</h4>
<p>
  Administration can define, per stage and per project type, which fields and records
  are expected to be present at a gate, a business case, a risk assessment, an
  approved budget, and so on. The tool checks them and tells you what is outstanding.
</p>

<div class="callout">
  <b>Readiness is advice, not a barrier.</b>
  Outstanding readiness items do not stop a gate being submitted, approved, deferred or rejected.
  The confirmation panel lists what is missing before you commit, and then lets you carry on.
</div>

<p>
  This is a change from how the tool first behaved. Whether an incomplete pack is good enough to
  decide on is a governance judgement, and it belongs to the people accountable for the decision
  rather than to a rule somebody configured months earlier who is not in the room. Holding a gate
  up over a tick-box the approver considers irrelevant does not improve governance. It just moves
  the conversation somewhere the tool cannot see it.
</p>

<div class="note">
  <b>Carrying on is recorded, not waved through</b>
  Whatever was outstanding at the moment of the decision is written onto the decision entry
  permanently, and appears in the gate's history and the audit trail. So the tool does not stop
  you, and it does not forget either. Anyone reviewing the gate later can see exactly what was and
  was not in place when it was signed.
</div>
`);

/* ------------------------------------------------------------------------- */

add("plan", "The project plan, baselines and rebaselining", `
<h3>Plan tasks</h3>
<p>Each task holds:</p>
<dl class="fields">
  <dt>Phase and task name</dt><dd>Which lifecycle phase the work belongs to, and what it is.</dd>
  <dt>Task type and deliverable</dt><dd>Whether it produces something, and what.</dd>
  <dt>Owner and supporting contributors</dt><dd>Who is accountable, and who else is involved. The owner's team is what drives Team-projects visibility and capacity reporting.</dd>
  <dt>Baseline start and end</dt><dd>The agreed dates. Locked once a baseline is approved.</dd>
  <dt>Forecast start and end</dt><dd>Current expectation.</dd>
  <dt>Actual start and end</dt><dd>What happened.</dd>
  <dt>Duration, estimated effort, remaining effort, allocation</dt><dd>Size and shape of the work. Effort feeds resource demand.</dd>
  <dt>Status and percentage complete</dt><dd>Not Started, In Progress, Blocked, Complete or Cancelled.</dd>
  <dt>Dependencies</dt><dd>Which tasks must finish first.</dd>
  <dt>Critical path</dt><dd>Whether slipping this task slips the project.</dd>
  <dt>Priority and mandatory</dt><dd>Whether the task is required for the stage to be complete.</dd>
  <dt>Reason for slippage, slippage impact, recovery not possible, return to green</dt><dd>Why a task is late, what it costs, and whether it can be recovered at all.</dd>
  <dt>Notes</dt><dd>Anything else.</dd>
</dl>

<h3>Baselines</h3>
<p>
  A baseline is a frozen copy of the plan's agreed dates, taken when the plan is
  approved, normally at the design gate. Once one exists, baseline dates on
  tasks and on the project can no longer be edited directly. The database refuses
  it, at every permission level.
</p>

<h4>Rebaselining</h4>
<ol class="steps">
  <li>The project manager raises a <b>rebaseline request</b>
      (<code>plan.requestBaseline</code>), stating the reason and the impact. The
      request captures both the existing baseline and the proposed one, so the
      decision is made on a visible comparison.</li>
  <li>An approver decides (<code>plan.approveBaseline</code>), a permission
      project managers do not hold.</li>
  <li>On approval a new baseline version is written, the plan's baseline dates move,
      and the previous baseline is kept as history.</li>
</ol>
<p>
  Baselines are versioned. Nothing overwrites an earlier one, so the sequence of
  agreed plans stays readable after the fact.
</p>
`);

/* ------------------------------------------------------------------------- */

add("milestones", "Milestones", `
<p>
  Milestones are the dates other people care about. Each holds a name, a type
  (stage milestone, key milestone and so on), baseline start and finish, forecast
  start and finish, percentage complete, status, an owner, and notes.
</p>
<p>Status values: Not Started, In Progress, Complete, Overdue and Cancelled.</p>
<div class="note">
  <b>Overdue is a fact, not an opinion</b>
  A milestone whose forecast finish has passed without completion reports as
  Overdue. The way to change that is to complete it or re-forecast it with a stated
  reason, not to relabel it.
</div>
`);

/* ------------------------------------------------------------------------- */

add("raid", "RAID: risks, assumptions, issues and dependencies", `
<p>
  One register, four record types, each with its own fields. All share a title,
  owner, raised-by, dates, priority, escalation status, review frequency, and
  closure evidence.
</p>

<h3>Risks</h3>
<p>A risk is stated as cause, event and effect, not as a worry:</p>
<pre><code>Because &lt;cause&gt;, there is a risk that &lt;event&gt;,
which would mean &lt;effect&gt;.</code></pre>
<dl class="fields">
  <dt>Inherent probability and impact</dt><dd>1 to 5 each. Their product is the inherent score.</dd>
  <dt>Mitigation</dt><dd>What reduces the likelihood or the impact.</dd>
  <dt>Contingency</dt><dd>What you do if it happens anyway.</dd>
  <dt>Residual probability and impact</dt><dd>The position after mitigation. Their product is the residual score, and this is the number that should drive attention.</dd>
  <dt>Risk appetite position</dt><dd>Whether the residual score sits within appetite or outside it.</dd>
  <dt>Escalation threshold and trend</dt><dd>When this must be escalated, and whether it is getting better or worse.</dd>
</dl>

<h3>Issues</h3>
<p>An issue has already happened. Fields: description, root cause, business impact, delivery impact, resolution plan, resolution owner, expected and actual resolution date, and workaround.</p>

<h3>Assumptions</h3>
<p>Something being taken as true that has not been proven. Holds the description and the business impact if it turns out to be false. Assumptions should end up either confirmed and closed, or converted into a risk or issue.</p>

<h3>Dependencies</h3>
<p>Something one party needs from another. Holds direction (inbound or outbound), provider, recipient, required-by date, confidence, impact if missed, acceptance criteria, and the related project where it is a cross-project dependency.</p>

<div class="note">
  <b>Cross-project dependencies are visible from both ends</b>
  Recording a dependency on another project makes it show up in that project's
  reporting too. That is the point: dependencies fail because nobody on the other
  side knew.
</div>
`);

/* ------------------------------------------------------------------------- */

add("registers", "Actions, decisions, documents and status reports", `
<h3>Actions</h3>
<p>
  Fields: action, source (where it came from, a board, a gate, a RAID item),
  owner, supporting owners, date raised, due date, priority, status
  (Open, In Progress, Blocked, Complete, Closed), completion date and commentary,
  evidence, escalation status, and related records.
</p>

<h3>Decisions</h3>
<p>
  A decision register that captures the question before the answer, which is what
  makes it useful later. Fields: decision required, background, options considered,
  recommendation, decision owner, required-by date, status
  (Required, Under Review, Approved, Rejected, Deferred, Closed), final decision,
  decision date, rationale, conditions, impact, related records and supporting
  evidence.
</p>

<h3>Documents</h3>
<p>
  Links to documents held elsewhere, the tool does not store files. Fields:
  document type, title, version, owner, status (Draft, In Review, Approved,
  Superseded, Archived), repository link, linked date, approval status, approved
  version, review date, classification and notes.
</p>
<p>
  Document types include Business Case, Project Profile, Requirements, Solution
  Design, Project Plan, RAID Log, Stage-Gate Pack, Status Report, Test Evidence,
  Operational Readiness, Implementation Plan, Approvals, Closure Report and Lessons
  Learned.
</p>

<h3>Status reports</h3>
<p>
  A periodic report against a reporting period. Much of it is assembled for you from
  the project's own plan, milestones, RAID, decisions and financials, so the report
  and the underlying records cannot disagree.
</p>
<dl class="fields">
  <dt>Period and due date</dt><dd>Which reporting period, and when the report was due.</dd>
  <dt>Overall status and eight dimension RAGs</dt><dd>Carried from the project.</dd>
  <dt>Executive summary</dt><dd>The part that gets read. Position and confidence in a short paragraph.</dd>
  <dt>Progress this period, planned next period</dt><dd>Done, and next.</dd>
  <dt>Completed and upcoming milestones</dt><dd>Assembled from the milestone records.</dd>
  <dt>Tasks behind plan</dt><dd>Assembled from the plan.</dd>
  <dt>Risks and issues, decisions required, dependencies</dt><dd>Assembled from RAID and the decision register.</dd>
  <dt>Resource position, financial position</dt><dd>Assembled from demand and financials.</dd>
  <dt>Scope changes, benefits update, return-to-green actions</dt><dd>Narrative.</dd>
  <dt>Sponsor comments</dt><dd>Added by the approver.</dd>
  <dt>Workflow status and version</dt><dd>Draft, Submitted, Returned, Approved or Locked. Revising an approved report creates a new version rather than editing it.</dd>
</dl>
`);

/* ------------------------------------------------------------------------- */

add("benefits", "Benefits", `
<p>
  Benefits can be held against a project or against a programme, for benefits that
  only make sense at the aggregate level.
</p>
<dl class="fields">
  <dt>Benefit level</dt><dd>Project or Programme.</dd>
  <dt>Benefit and benefit type</dt><dd>What improves, and its nature, cashable, non-cashable, revenue, growth, risk reduction, compliance or member outcome.</dd>
  <dt>Owner</dt><dd>Who is accountable for realising it. Usually not the project manager, because benefits land after the project closes.</dd>
  <dt>Baseline value, target value, unit</dt><dd>Where you are starting, where you intend to get to, and in what units. A target without a baseline cannot be evidenced.</dd>
  <dt>Measurement method and data source</dt><dd>How it will be measured and from where. Agreed before delivery, not after.</dd>
  <dt>Lead indicators</dt><dd>Early signals that it is working.</dd>
  <dt>Current value</dt><dd>Latest measurement.</dd>
  <dt>Target realisation date</dt><dd>When the benefit is expected to be realised.</dd>
  <dt>Status</dt><dd>Proposed, Approved, In delivery, Partially realised, Realised, Not realised, or No longer applicable.</dd>
  <dt>Realisation confidence</dt><dd>High, Medium, Low or Not Assessed.</dd>
  <dt>Review frequency, last and next review</dt><dd>Monthly, Quarterly, Six-monthly or Annually.</dd>
  <dt>Commentary and evidence</dt><dd>Where the benefit stands, and what proves it.</dd>
</dl>
<div class="note">
  <b>&ldquo;Not realised&rdquo; is a valid and useful answer</b>
  A benefits register where everything is eventually Realised is not being
  maintained honestly. Recording a benefit that did not materialise, with the
  reason, is how the next business case gets better.
</div>
`);

/* ------------------------------------------------------------------------- */

add("financials", "Financials and budget approval", `
<h3>What a project's financial record holds</h3>
<dl class="fields">
  <dt>Proposed budget</dt><dd>What was asked for.</dd>
  <dt>Approved budget</dt><dd>What governance actually approved. <b>This field cannot be typed in</b>, it only changes through an approved budget request. The database enforces that.</dd>
  <dt>Forecast cost</dt><dd>What you now expect the project to cost in total.</dd>
  <dt>Actual cost</dt><dd>What has been spent.</dd>
  <dt>Committed cost</dt><dd>Contracted but not yet invoiced.</dd>
  <dt>Remaining forecast</dt><dd>Expected still to spend.</dd>
  <dt>Contingency</dt><dd>Approved provision held against risk.</dd>
  <dt>Estimate at completion</dt><dd>Actual plus committed plus remaining forecast.</dd>
  <dt>Budget variance and variance percentage</dt><dd>Approved budget minus estimate at completion. Negative means forecast overspend.</dd>
  <dt>Currency and funding source</dt><dd>Which budget it comes from.</dd>
  <dt>Financial owner</dt><dd>Usually a finance business partner rather than the project manager.</dd>
  <dt>Financial RAG and commentary</dt><dd>The rating and the explanation behind it.</dd>
  <dt>Budget approval status and approved version</dt><dd>Which approval the current figure came from.</dd>
  <dt>Last financial update</dt><dd>When the numbers were last refreshed. A stale date is itself a finding.</dd>
</dl>

<h3>Cost lines</h3>
<p>
  Detail behind the totals: one line per cost category per financial period, each
  with budget, forecast, actual, committed and remaining amounts, plus a description
  and notes. The seven categories are Internal resource, External resource,
  Supplier, Software, Infrastructure, Contingency and Other, and they are
  configurable with <code>financials.configure</code>.
</p>
<div class="note">
  <b>The summary should equal the detail</b>
  Approved budget should be the sum of the budget lines and actual cost the sum of
  the actual lines. If they diverge, the summary has been edited without the detail
  and reporting will not reconcile.
</div>

<h3>The budget approval workflow</h3>
<ol class="steps">
  <li>Someone raises a <b>budget request</b>, either an initial approval or an
      increase, stating the current approved budget, the proposed budget, the
      change and the reason. The request takes a snapshot of the financial position
      at that moment, so the decision remains auditable after the numbers move on.</li>
  <li>An approver with <code>financials.approve</code> decides. Project managers do
      not have it.</li>
  <li>On approval the approved budget changes, the approval version increments, and
      the request, decision, decision-maker and comments are all retained.</li>
</ol>
<div class="warn">
  <b>There is no way to set an approved budget directly</b>
  Not through the screen, not through an import, and not by an administrator. This
  is intentional. An approved budget with no approval behind it is the one number in
  the tool that must never exist.
</div>
`);

/* ------------------------------------------------------------------------- */

add("resources", "Resources, demand, capacity and scenarios", `
<h3>The resource directory</h3>
<dl class="fields">
  <dt>Resource ID, full name, email</dt><dd>Identity. The resource ID is permanent.</dd>
  <dt>Resource kind</dt><dd>Named person, or Generic role for a placeholder.</dd>
  <dt>Team, department, job title, delivery role</dt><dd>Where they sit and what they do. Team drives Team-projects visibility and capacity grouping.</dd>
  <dt>Resource type</dt><dd>Permanent, Contractor, Vacancy and so on.</dd>
  <dt>Working pattern and standard weekly capacity</dt><dd>Full time, part time, compressed hours, and the hours available per week. Capacity reporting depends on this being right.</dd>
  <dt>Effective start and end date</dt><dd>When they joined, and when they leave. An end date stops capacity being planned beyond it.</dd>
  <dt>Manager</dt><dd>Reporting line, used for team roll-ups.</dd>
  <dt>Active</dt><dd>Whether they are current. Leavers are deactivated, never deleted, so history keeps resolving.</dd>
  <dt>Account status</dt><dd>Whether they can sign in: Active, Not enabled, or Disabled.</dd>
  <dt>Access role, access scope, selected projects</dt><dd>Their permissions. Only a System Administrator can change these, and nobody can change their own.</dd>
</dl>

<div class="warn">
  <b>There is no delete button, on purpose</b>
  Resources are deactivated, not deleted. Deleting somebody would break every task, RAID entry, approval and audit record that names
  them. Deactivate them instead. They drop out of the pickers and capacity planning, and the
  history stays intact.
</div>

<h3>Resource demand</h3>
<p>
  A demand record is a request for somebody's time on a project. Fields: project,
  phase, linked task, role or skill, the named resource or generic role, team,
  start and end date, allocation method (hours or percentage) with the amount,
  status, confidence, priority, requestor, approver and notes.
</p>
<p>Demand status: <b>Requested</b> &rarr; <b>Provisional</b> &rarr; <b>Confirmed</b>, and each change keeps a history entry showing who changed it and when.</p>

<h3>Capacity and utilisation</h3>
<p>
  Capacity comes from each person's standard weekly hours, reduced by approved
  absence. Utilisation is demand against that capacity. Thresholds are configurable
  in Administration, by default over 100% is a warning, over 115% is critical,
  and under 70% is flagged as under-used.
</p>

<h3 id="timeline">The allocation timeline</h3>
<p>
  The chart at the bottom of the Resources page shows who is committed to what, and when.
  One row per person, with every piece of work they are allocated to drawn on its own line
  underneath their name.
</p>

<h4>Reading a row</h4>
<dl class="fields">
  <dt>The person's line</dt>
  <dd>Their name, team and total allocation. Anything that is a property of the
      <i>person</i> rather than of one task is drawn here.</dd>
  <dt>A task bar</dt>
  <dd>One per assignment, positioned by its start and finish dates. The bar is labelled
      with the project, the task, the allocation percentage, how many working days it
      covers, and how far through it is.</dd>
  <dt>A red bar</dt>
  <dd>A run of days where that person's total allocation across everything exceeds the
      over-allocation threshold. It is drawn on the person's line, not on any one task,
      because being over-committed is a property of the person, no single task is
      at fault, and it is the combination that needs resolving. Consecutive days at the
      same level are merged into one bar so a month of over-allocation reads as one
      problem rather than twenty.</dd>
  <dt>A spare-capacity bar</dt>
  <dd>The opposite: a run of days with hours left unclaimed, labelled with how many per
      day. This is what you look at when you need to find somebody.</dd>
  <dt>A shaded band</dt>
  <dd>Approved absence. A task bar crossing one is flagged in its hover card, because a
      plan that assumes somebody is at work during their annual leave is a plan that will
      slip.</dd>
</dl>

<h4>Weekends</h4>
<p>
  Saturday and Sunday are shaded and are left out of every duration. A task described as
  &ldquo;10 work days&rdquo; means ten working days, so a bar that spans a weekend is visibly
  longer on the chart than one that does not. It is why the weekends are shaded rather than hidden altogether.
</p>
<div class="note">
  <b>Weekend work is still possible</b>
  Leaving weekends out of durations does not stop you planning weekend work. A task can start,
  finish or run across a weekend and it will be drawn there. The point is that the tool will not
  quietly count a Saturday towards a deadline you agreed in working days.
</div>

<h4>Zoom</h4>
<p>
  Five levels: <b>Day</b>, <b>Week</b>, <b>Month</b>, <b>Quarter</b> and <b>Year</b>. Day is
  for resolving a specific clash, who is doing what on Thursday. Year is for seeing
  whether a team is committed for the next eighteen months. The columns are labelled with
  dates rather than week numbers.
</p>

<h4>The hover card</h4>
<p>
  Hovering over a task bar brings up a card at the pointer. It shows the person, the project, the
  task, its status, the start and finish dates in full, the allocation and duration, progress, and
  any absence it clashes with. At day zoom a bar can be too narrow to label, so the card is where
  the detail sits. Keyboard users get the same card by tabbing to a bar.
</p>

<h4>Changing an allocation from the chart</h4>
<p>
  Clicking a task bar opens a small editor for its allocation percentage. Saving writes the
  new value <b>back to the project plan</b>, this is the same task, not a copy, so the
  plan page will show the change and so will everything computed from it.
</p>
<div class="note">
  <b>The same permissions apply as on the plan itself</b>
  You can only change an allocation on a project whose plan you are allowed to edit. If you are
  not, the chart tells you, rather than failing quietly when you save. Because it is editing the
  plan, the change is version checked and audited in the same way as an edit made on the plan
  page.
</div>
<p>
  After a successful save the affected rows are recalculated rather than patched up. The bar, the
  person's totals, the over-allocation runs and the spare capacity all move together, and
  recalculating is the only way to keep them consistent with each other.
</p>

<h4>Labels follow what you can see</h4>
<p>
  A bar is drawn where its dates put it, and its label normally sits at the start. If you scroll
  into the second half of a three month task, the label would go with the first half and leave a
  long coloured rectangle on screen with nothing written on it. So the label travels. It moves
  along the bar as you scroll and sits on whichever part of the bar is in view, shortening to fit
  if there is not much left. Scroll back and it settles at the start again.
</p>
<p>
  This applies to the task bars, the red over-allocation bars, the spare-capacity bars and the
  absence bands, anything long enough to outrun the window it is being read in.
</p>

<h4>Moving around</h4>
<p>
  Click and drag anywhere on the chart to scroll it horizontally, which is faster than the
  scrollbar when you are comparing two periods. <b>Expand Gantt</b> takes it full-window;
  <kbd>Escape</kbd> or the same button returns.
</p>

<div class="warn">
  <b>A task with an owner but no dates cannot be placed</b>
  It is listed on the person's row and marked as undated, but there is nowhere to draw it on a
  timeline and it does not count towards capacity or over-allocation. If somebody looks
  under-committed and you know they are not, undated tasks are the first thing to check.
</div>

<h3>Absence</h3>
<p>
  Annual leave, long-term absence, training and contract end dates. Absence reduces
  available capacity, which is what stops the plan assuming somebody is free when they are not.
</p>
<div class="note">
  <b>You only see absence for people you can already see</b>
  Absence visibility follows the same rules as people: yourself, your own team, and
  anyone named on a project you can access. Portfolio-wide roles see everything.
  Recording absence also requires <code>resourceManagement.edit</code>, and only for
  people within your scope, so a team manager can record their own team's
  absence and nobody else's. This is enforced by the database, not by the screen.
</div>

<h3>Scenarios</h3>
<p>
  A scenario is a draft resourcing plan you can build without affecting live demand.
  Scenarios start as <b>Draft</b>, and can be <b>Published</b>, which turns
  them into real demand, or <b>Rejected</b>.
</p>
<div class="note">
  <b>A published or rejected scenario cannot be changed</b>
  Once it has been decided it becomes history and can no longer be edited. Publishing requires
  <code>resourceManagement.publishScenario</code>. The scenario keeps a snapshot of
  the demand versions it was built from, so it cannot quietly turn into a plan built on numbers that have moved since.
</div>
`);

/* ------------------------------------------------------------------------- */

add("rag", "How RAG status works", `
<p>
  Eight dimensions are rated separately &mdash; Schedule, Scope, Financial,
  Resource, Risk, Benefits, Quality and Operational readiness, plus an
  Overall rating. Each is Green, Amber, Red or Not Assessed.
</p>

<h3>Calculated versus reported</h3>
<p>
  The tool <b>calculates</b> a suggested rating from the underlying records, and you
  <b>report</b> a rating. Usually they agree. When they do not, the difference is
  recorded along with your justification.
</p>
<p>Default calculation thresholds, all configurable in Administration:</p>
<div class="scroll"><table>
<thead><tr><th>Dimension</th><th>Amber when</th><th>Red when</th></tr></thead>
<tbody>
<tr><td>Schedule</td><td>Forecast is more than 5 days past baseline</td><td>More than 20 days past baseline</td></tr>
<tr><td>Financial</td><td>Variance beyond 5%</td><td>Variance beyond 10%</td></tr>
<tr><td>Resource</td><td>Utilisation above 100%</td><td>Above 115%</td></tr>
</tbody></table></div>
<p>Overall is the worst of the dimensions unless it is manually overridden.</p>

<div class="note">
  <b>Overriding is allowed, and it is recorded</b>
  Reporting Amber where the tool calculated Red is a legitimate management
  judgement, for instance where recovery actions are already agreed. The
  override, the calculated value and your justification are all written to the
  status history, permanently. An override without a justification is visible as
  exactly that.
</div>

<h3>Recorded status history</h3>
<p>
  Every time status is recorded, a snapshot is kept: what was calculated, what was
  reported, which dimensions were overridden and why, who recorded it and when.
</p>
<div class="bad">
  <b>Status history can never be edited or deleted</b>
  Not by a project manager, not by an administrator, not by a developer. The
  database has no permission to change or remove these records. If a status was
  reported wrongly, the correction is a new snapshot, which is also what
  leaves an honest trail.
</div>
`);

/* ------------------------------------------------------------------------- */

add("reporting", "Reports, dashboards, saved views and search", `
<h3>Reports and dashboards</h3>
<p>
  Portfolio and programme roll-ups, milestone and RAG summaries, financial
  positions, resource utilisation and delivery confidence. Everything respects your
  access scope: a report never shows you a project you could not open directly.
</p>

<h3>Saved views</h3>
<p>
  A saved view keeps a set of filters, columns and sorting. Views are personal by
  default. With <code>views.publish</code> a view can be published so the whole team
  uses the same definition of, say, &ldquo;projects at risk&rdquo;.
</p>

<h3>Exports</h3>
<p>
  <code>reports.export</code> allows CSV export of what is on screen. Exports
  contain only what your scope permits.
</p>
<div class="warn">
  <b>An export leaves the tool's protection behind</b>
  Once data is in a spreadsheet, row-level security no longer applies to it. Treat
  exports of Confidential or Highly Confidential projects accordingly.
</div>

<h3>Search</h3>
<p>
  Global search covers projects, programmes, plan tasks, milestones, RAID entries,
  actions, decisions, documents, benefits and resources, filtered to your
  scope. Recent searches are remembered on your own machine only.
</p>
`);

/* ------------------------------------------------------------------------- */

add("audit", "Audit history", `
<p>
  A read-only record of what changed, who changed it, when, and where in the tool.
  Requires <code>audit.view</code>.
</p>
<p>You can filter by project, record type, event type, where the change was made, evidence type and date range, and export the filtered set.</p>

<h3>The History button on a record</h3>
<p>
  You do not have to go to the Audit History page to see what happened to one record. Most records
  carry a <b>History</b> button that opens the same trail filtered to that record on its own. You
  will find it on projects, programmes, the plan, milestones, RAID, the registers, benefits,
  financials and the resource directory. It reads from the database, so it shows changes made by
  anybody on any machine and not just your own. There is a link at the foot of it to the full trail
  if you need the surrounding context.
</p>

<h3>Evidence types</h3>
<div class="scroll"><table>
<thead><tr><th>Label</th><th>What it means</th><th>Can it be trusted?</th></tr></thead>
<tbody>
<tr>
  <td><b>Verified</b></td>
  <td>Written by the database from the authenticated identity of whoever made the change.</td>
  <td>Yes. The application has no permission to alter or delete these.</td>
</tr>
<tr>
  <td><b>Legacy</b></td>
  <td>History from browser storage before the move to a database, imported once as historical context.</td>
  <td>Kept for continuity. It was never independently verifiable.</td>
</tr>
<tr>
  <td><b>Unverified</b></td>
  <td>Events still held in a browser from before the audit cleanup.</td>
  <td>No. Shown clearly labelled rather than quietly dropped.</td>
</tr>
</tbody></table></div>

<p>
  Every change made from now on is Verified. Each entry records the actor's name, email
  and role at the time, the record affected, the operation, and the individual fields that
  changed with their before and after values.
</p>

<div class="bad">
  <b>The audit log is append-only</b>
  Nothing in the tool can edit or delete an audit entry, at any permission level.
  It is what makes the log usable as evidence.
</div>

<h3>A gap you should know about, 7 to 11 August 2026</h3>
<p>
  Please read this if you are relying on the audit trail for any period before <b>11 August
  2026</b>.
</p>
<p>
  Each record in this tool has a handful of structured columns, such as a code, a status and a
  date, with everything else held together in one block of detail. The audit triggers compared the
  structured columns and, through an error in their original design, skipped the block of detail
  altogether. When nothing structured had changed they concluded nothing had changed and wrote no
  entry at all.
</p>
<p>
  Almost everything a person types sits in that block. A decision's rationale, conditions and
  outcome. A risk's description and mitigation. An action's update. A status report's commentary.
  So an edit that only touched those fields saved correctly, incremented the record's version, and
  was recorded nowhere. The change history dialogue reported &ldquo;0 recorded changes&rdquo; and
  was telling the truth.
</p>

<div class="bad">
  <b>Nothing backfills, and nothing can</b>
  The fix was applied on 11 August 2026, and every change since then is recorded in full. It
  cannot be applied retrospectively, because the previous values were never written down anywhere
  and there is nothing to recover them from. Edits made between 7 and 11 August 2026 that only
  touched descriptive fields are absent from the trail, and the record now shows only its current
  value. I have set this out here rather than leave it to be found later, because an audit trail
  that quietly omits things is worse than one with a known and dated gap.
</div>

<p>
  This affected projects, programmes, portfolios, people, the eighteen registers hanging off a
  project (plans, milestones, RAID, actions, decisions, benefits, documents, status reports, stage
  gates, baselines and financials) and the configuration tables. In other words, all of it.
  Structured changes such as a status moving from Draft to Submitted, or a stage changing, were
  recorded throughout and are intact.
</p>

<h3>What an entry covers now</h3>
<p>
  Both the structured columns and the detail block, with one line per field that actually changed,
  ordered by field name. Bookkeeping that changes on every save and describes nothing is left out,
  such as timestamps, version markers and who last touched the record. The person and the time are
  already on the entry itself, and repeating them would bury the line that matters.
</p>
<p>
  A single save that rewrites an unusually large number of fields is capped at eighty listed
  changes, followed by a count of the rest. That keeps a bulk edit honest without letting one entry
  make the page unreadable.
</p>
`);

/* ------------------------------------------------------------------------- */

add("administration", "Administration", `
<p>Requires <code>administration.view</code> to read and <code>administration.edit</code> to change.</p>

<h3>Lifecycle templates</h3>
<p>
  Define the stages a project moves through, their order, and which require a gate.
  Templates are versioned and can be restricted to particular project types, so
  regulatory work can follow a stricter path than BAU.
</p>

<h3>Reference data</h3>
<p>
  The contents of the dropdowns: project types, business areas, confidentiality
  levels, priorities, project statuses, reporting frequencies, RAG statuses, RAID
  types, task statuses, milestone statuses and benefit types. Each entry has a code,
  a display value, a sort order and an active flag, deactivating rather than
  deleting keeps existing records valid.
</p>

<h3>Reporting calendars and periods</h3>
<p>
  Define reporting periods, their start and end dates, and how many days after
  period end a report is due. A portfolio has a default calendar and a project can
  override it.
</p>

<h3>Mandatory readiness rules</h3>
<p>
  Per stage and per project type, which fields and records must be present before a
  gate can be submitted. This is how governance standards are enforced consistently
  rather than by reviewer memory.
</p>

<h3>Thresholds</h3>
<p>
  The RAG tolerances and the resource utilisation thresholds described under
  <a href="#rag">RAG status</a>.
</p>

<h3>Cost categories</h3>
<p>Requires <code>financials.configure</code>. The categories cost lines are grouped into.</p>

<h3>Data tools</h3>
<p>See <a href="#data">Data, backup and recovery</a>.</p>
`);

/* ------------------------------------------------------------------------- */

add("accounts", "Managing people and accounts", `
<p>
  This section is for System Administrators. Managing accounts needs
  <code>users.manage</code>, which only that role has.
</p>

<h3>Adding a person who does not need a login</h3>
<p>
  Most resources fall here, they own tasks and appear in capacity planning but
  never sign in. Create them in the Resources page with their team, job title,
  working pattern and capacity. Leave account status as <b>Not enabled</b>. Nothing
  further is needed.
</p>

<h3>Giving someone a login</h3>
<p>Three steps, and the order matters:</p>
<ol class="steps">
  <li><b>Create the person record</b> in the Resources page, if it does not exist.
      Set their permission level, any additional roles, and their scope.</li>
  <li><b>Create the login</b> in the Supabase dashboard, under
      <b>Authentication &rarr; Users &rarr; Add user</b>. Use their real email
      address, set a temporary password, and tick <i>Auto Confirm User</i>.</li>
  <li><b>Link the two</b>, from the Supabase SQL editor:
      <pre><code>select public.ppm_link_person_login('their.email@example.com', 'RES-0103');</code></pre>
      Then give them the temporary password. On first sign-in they will be required
      to enrol an authenticator and set their own password.</li>
</ol>

<h3>Choosing someone's roles</h3>
<p>
  Set the <b>permission level</b> to the job they mainly do. Then add an <b>additional role</b>
  for each other job they also do. Permissions are the sum of all of them; adding a role never
  takes anything away. The page shows how many of the ${ALL_PERMISSIONS.length} permissions the
  combination grants as you choose.
</p>
<dl class="fields">
  <dt>An executive who sponsors projects</dt>
  <dd>Executive / Steering User, plus Project Sponsor / Project Lead. Portfolio-wide
      visibility from the first, approval authority from the second. Neither alone does the
      job, and this is the case the feature exists for.</dd>
  <dt>A project manager who also manages a team's capacity</dt>
  <dd>Project Manager, plus Resource Manager / Team Manager.</dd>
  <dt>A PMO analyst who sponsors a small project</dt>
  <dd>PMO Analyst, plus Project Sponsor / Project Lead, but check the segregation rules
      first. Nobody can approve their own submission whatever roles they hold, and the tool
      enforces that separately.</dd>
  <dt>When to use a permission override instead</dt>
  <dd>When somebody needs exactly one extra thing that no role sensibly bundles. An override
      is a single permission allowed or refused for one person. It is the right tool for a
      genuine exception and the wrong one for &ldquo;they do two jobs&rdquo;, because a role
      explains itself in six months' time and an override does not.</dd>
</dl>
<p>
  Scope still applies on top. A person's scope is whichever you set explicitly; if you leave it
  alone it defaults to the widest of the roles they hold, because adding a role should never
  narrow what somebody can see.
</p>

<div class="note">
  <b>Nobody can change their own roles</b>
  Including a System Administrator, and including additional roles. Another administrator has
  to do it. The database refuses it, not just the screen.
</div>

<div class="warn">
  <b>Linking cannot be done from inside the tool, at any permission level</b>
  Which login belongs to which person decides who someone <i>is</i>, so it is
  kept outside the application on purpose. Even a System Administrator signed into
  the tool cannot do it, the database refuses. It requires database owner
  access, which means the Supabase dashboard.
</div>

<h3>Changing someone's access</h3>
<p>
  Change their access role, access scope, selected projects or account status on
  their resource record. Two rules are enforced by the database:
</p>
<ul>
  <li>You cannot change your own role, scope, account status or permissions.</li>
  <li>You cannot change which login is attached to a person.</li>
</ul>

<h3>When someone leaves</h3>
<ol class="steps">
  <li>Set their <b>effective end date</b>, so capacity stops being planned for them.</li>
  <li>Set <b>account status</b> to Disabled, which stops them signing in.</li>
  <li>Set <b>Active</b> to false, which removes them from pickers.</li>
  <li>Reassign their open tasks, actions and RAID ownership.</li>
</ol>
<p>Do not delete them. Their name stays correct on everything they did.</p>

<h3>Lost authenticator</h3>
<p>
  There is no self-service reset. An administrator removes the person's
  authenticator enrolment in the Supabase dashboard under
  <b>Authentication &rarr; Users</b>, after which their next sign-in walks them
  through enrolling a new one.
</p>
`);

/* ------------------------------------------------------------------------- */

add("data", "Data, backup and recovery", `
<div class="note">
  <b>Your data lives in a database, not in your browser</b>
  Everything is held in a hosted PostgreSQL database. When a page opens it loads what it needs into
  memory so the screen can be drawn quickly, and that copy is thrown away when you close the tab
  and rebuilt from the database next time. Nothing you do to your browser can lose your work,
  whether that is clearing data, switching machine, or using a different browser altogether.
</div>

<div class="callout">
  <b>A change is only saved once the database has confirmed it.</b>
  The screen does not update first and reconcile afterwards. If a save fails you are told at the
  time, and what is on screen still matches what is stored. There is no situation in which the
  tool shows you a value the database does not have.
</div>

<h3>What actually protects the data</h3>
<p>
  The database platform takes automated backups and supports point-in-time recovery.
  That is the real backup. Recovery is a database operation, performed by whoever
  administers the Supabase project.
</p>

<h3>The snapshot download in Administration</h3>
<p>
  Administration offers a snapshot download. It is useful for reading, archiving or comparing against what is live, but it is <b>not</b> a
  disaster recovery artefact and the file says so.
</p>
<div class="warn">
  <b>Restoring a snapshot over database-backed data is refused</b>
  A snapshot is a point-in-time copy of the browser's working copy. Loading an old
  one back would put stale records on screen that the database knows nothing about,
  and any edit made against them would then be written through as if it were new.
  So restore refuses database-backed collections and offers a comparison report
  instead. Browser-only items, such as personal preferences, still restore normally.
</div>

<h3>Storage warnings</h3>
<p>
  If the browser's own storage gets close to its limit, a warning appears in Administration. This
  is now rare, because portfolio data is no longer kept in the browser at all. What is left is
  preferences, saved views and some historical local audit events. Archiving the old local audit
  history from Administration is the usual fix, and it does not touch the database audit trail.
</p>
`);

/* ------------------------------------------------------------------------- */

add("troubleshooting", "When something looks wrong", `
<dl class="fields">
  <dt>A page shows grey placeholder blocks for a moment when it opens</dt>
  <dd>That is the page waiting for the database, and it is intended. The tool draws an
      outline of what is coming rather than a finished but empty page, because an empty page
      reads as broken. On a warm connection you will not see it at all. If it is still there
      after twelve seconds it is replaced by an explanation.</dd>

  <dt>A page is empty, or shows far fewer records than expected</dt>
  <dd>In order of likelihood: the authenticator step did not complete this session;
      your access scope excludes those records; or your account status is
      not Active. Sign out and back in first.</dd>

  <dt>A button appears to do nothing</dt>
  <dd>Look for a red message at the top of the page, a failure now says what went
      wrong rather than staying silent. If there is nothing, press <code>F12</code>, open
      <b>Console</b> and send whatever is red. If it is a button on the project details page,
      <code>PPMProjectForms.explain()</code> typed into that console prints exactly which part
      did not load.</dd>

  <dt>You are not being notified about something you own</dt>
  <dd>Notifications follow the name on the record, not the role. Check that you are actually
      recorded as the owner or approver on it. If you are named but the notification says your
      roles cannot act, you need the role that allows it, an administrator can add one
      alongside the role you already have.</dd>

  <dt>&ldquo;This record was changed by someone else&rdquo;</dt>
  <dd>Two people edited the same record at once. Your copy was based on an older
      version, so the save was refused rather than silently overwriting theirs.
      Reload the page and reapply your change. This is the tool working as intended.</dd>

  <dt>A save appears to have worked but the value is back after a reload</dt>
  <dd>The change did not reach the database. An administrator can list what failed and why
      from the browser console with <code>PPMChildDatabase.pendingWrites()</code> for project
      records, or <code>PPMDatabase.pendingWrites()</code> for projects, people and
      configuration. Nothing retries automatically, and that is on purpose. A change that failed
      because somebody else edited the record should not be replayed over the top of theirs.
      Make the change again.</dd>

  <dt>A stage gate you are named on will not let you approve it</dt>
  <dd>Check that you are on the <i>required approvers</i> list for that gate and not merely
      copied in, and that you did not submit or own it, nobody approves their own
      submission, at any permission level. If you are named and did not submit it, you can
      decide it whatever your role says; report it if you cannot.</dd>

  <dt>A gate warns that readiness items are outstanding</dt>
  <dd>That is advice, not a refusal. Submit or decide anyway if that is your judgement. What
      was outstanding is recorded against your decision.</dd>

  <dt>A change you made is not in the change history</dt>
  <dd>If it was made before 11 August 2026 and only touched descriptive fields, it was not
      recorded, see <a href="#audit">the gap described under Audit history</a>. After
      that date, everything is recorded, so report it.</dd>

  <dt>A project manager cannot see their own project</dt>
  <dd>They are almost certainly not named in a role on it. Add them as project
      manager on the project record. Changing their permissions will not help.</dd>

  <dt>A baseline date will not save</dt>
  <dd>The plan has an approved baseline, so baseline dates can only move through an
      approved rebaseline. Raise a rebaseline request.</dd>

  <dt>An approved budget will not save</dt>
  <dd>Approved budgets only change through the budget approval workflow. Raise a
      budget request.</dd>

  <dt>A stage gate cannot be edited</dt>
  <dd>It has been submitted. Only Draft gates are editable. Defer or reject it to
      send it back for revision.</dd>

  <dt>A person cannot be deleted</dt>
  <dd>Correct, there is no delete. Deactivate them instead.</dd>

  <dt>Someone new cannot sign in</dt>
  <dd>Their login exists but is probably not linked to their person record. See
      <a href="#accounts">Giving someone a login</a>.</dd>
</dl>

<p>
  If none of that fits, report it with: what you were doing, what you expected, what
  happened, which project and record, and roughly when. If a link inside the tool
  took you to a &ldquo;page does not exist&rdquo; screen, that is a genuine bug worth
  reporting.
</p>
`);

/* ------------------------------------------------------------------------- */

add("glossary", "Glossary", `
<dl class="fields">
  <dt>AAL2</dt><dd>The assurance level reached once you have completed the authenticator step. Below it, the database returns no data.</dd>
  <dt>Append-only</dt><dd>Records can be added but never changed or removed. Applies to audit history and recorded status history.</dd>
  <dt>Baseline</dt><dd>The agreed plan, frozen. Changing it requires an approved rebaseline.</dd>
  <dt>Calculated RAG</dt><dd>The rating the tool works out from the underlying records, as opposed to the one you report.</dd>
  <dt>Estimate at completion</dt><dd>Actual plus committed plus remaining forecast, the expected final cost.</dd>
  <dt>Hypercare</dt><dd>The heightened-support period straight after go-live.</dd>
  <dt>Inherent versus residual</dt><dd>A risk before mitigation, versus after it.</dd>
  <dt>Named approver</dt><dd>Someone listed as a required approver on a stage gate. Being named is what grants the authority to decide it, independently of their access role.</dd>
  <dt>Over-allocation</dt><dd>A person committed beyond their available hours once every project is counted together. Shown in red on the allocation timeline, on the person's row rather than on any one task.</dd>
  <dt>Optimistic locking</dt><dd>How simultaneous edits are handled: a save carries the version it was based on, and is refused if that version has moved.</dd>
  <dt>Readiness rule</dt><dd>A configured expectation about what should be in place at a stage gate. Advisory: it is reported before a decision and recorded alongside it, but it does not block anything.</dd>
  <dt>Provenance</dt><dd>Whether an audit entry is Verified, Legacy or Unverified.</dd>
  <dt>RAG</dt><dd>Red, Amber, Green.</dd>
  <dt>RAID</dt><dd>Risks, Assumptions, Issues, Dependencies.</dd>
  <dt>Row-level security</dt><dd>The database deciding, row by row, what your identity is allowed to see and change.</dd>
  <dt>Scope (access)</dt><dd>Which records you can reach: Portfolio-wide, Assigned projects, Team projects or Selected projects.</dd>
  <dt>Soft delete</dt><dd>Marking a record deleted rather than removing it, so history stays intact.</dd>
  <dt>Stage gate</dt><dd>The formal decision to move a project to its next stage.</dd>
  <dt>TOTP</dt><dd>Time-based one-time password, the six-digit authenticator code.</dd>
</dl>
`);

/* ------------------------------------------------------------------------- */

const html = shell({
  file: "USER-SPECIFICATION.html",
  title: "User and Administrator Specification",
  kicker: "Portfolio Manager",
  lede:
    "What every page does, what every record holds, how each workflow moves, and exactly what each of the nine access roles can and cannot do. Written for the people who use and administer the tool.",
  audience: "For users, project managers, PMO and administrators",
  sections
});

writeFileSync(join(HERE, "USER-SPECIFICATION.html"), html, "utf8");
console.log(`USER-SPECIFICATION.html written (${sections.length} sections, ${Math.round(html.length / 1024)} KB)`);
