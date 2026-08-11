PORTFOLIO MANAGER - ACCESS, ADMINISTRATION AND GOVERNANCE QUICK START

FULL TECHNICAL DOCUMENTATION

This file is the quick start. For everything else - how the tool is built, what each file
does, how the data is shaped, how permissions work, how to make changes safely, and what
moving to a database and Microsoft sign-in involves - open TECHNICAL-SPECIFICATION.html
in a browser. It has a contents sidebar and is written in two parts: one for whoever looks
after the tool day to day, and one for a developer or IT.

GETTING STARTED

1. Open login.html.
2. Sign in with your Supabase Auth email address and password. The tool itself no longer holds
   passwords - they are checked by Supabase Auth, not by the browser.
3. Multi-factor authentication is required. After your password is accepted you must enter the
   six-digit code from your authenticator app before the tool will let you in.
4. Open Resources to add named users and set their login status, permission level, project access
   and approved permission exceptions. These control what a person sees inside the tool.
5. Sign-in accounts themselves are created separately in Supabase Auth during this stage of the
   migration and linked to the matching Resource record, so there is no password field in Resources.
   Ask whoever administers the Supabase project to create the account and enrol its authenticator.

CENTRAL ADMINISTRATION

Open Administration to maintain the governed data used throughout the prototype:

- portfolios and portfolio ownership;
- versioned project lifecycle templates and their stages;
- mandatory project information by lifecycle stage and project type;
- controlled reference lists used by project and plan picklists;
- calculated RAG thresholds; and
- reporting calendars, generated reporting periods, due dates and period locks.

System Administrators and Portfolio Managers can maintain the full configuration. Users granted
portfolios.edit can maintain portfolio records only; the remaining administration areas stay read-only.
Material changes are written to Audit History. Lifecycle stages and their mandatory rules are versioned
together, so existing projects retain the governance route and validation rules they were assigned.

FORMAL STAGE GATES

Projects select a governed portfolio and lifecycle template. Their next stage is derived from that
template. Use Stage Gates to create a submission, record evidence, assign independent approvers and
capture the decision. The submitter cannot approve their own gate. All required approvals must be
recorded before the project advances, and mandatory information is checked again at approval.

Each first submission is version 1. A rejected or deferred gate can be revised and resubmitted as the
next version, while every prior submission snapshot and approver decision remains available in history.

Route exceptions require a separate approval. Approved, submitted and archived governance records
cannot be deleted. Exceptional direct stage changes require the specific override permission and a
recorded justification. Archived projects and their gates are read-only.

MILESTONES AND STAGE GATES

These are now separate. Milestones records delivery checkpoints and their baseline and
forecast dates. Formal lifecycle gates, evidence, approvers and decisions are held only in
Stage Gates. Any milestone previously typed "Stage Gate" is converted to a plain milestone
the first time the Milestones page is opened; no dates, notes or history are lost.

CHANGE HISTORY

Every editable table records changes cell by cell. Saving a row writes the fields that moved,
their previous and new values, who made the change and when.

The clock icon on each row opens that record's own history without leaving the page. Audit
History holds the same information for the whole portfolio, with an "All activity" view and a
"By record" view that groups every change against the record it belongs to.

Audit events record where in the tool a change was made, for example "Project plan" or
"Administration - reporting calendars", rather than a page filename. Record type, event type
and location can each be filtered on several values at once.

REPORTS

Reports export to CSV, Excel, Word, PowerPoint and PDF. The PDF export is a formatted
document rather than a table dump: a branded cover page, the filters applied, headline
measures, charts, and sectioned tables whose headers repeat across pages, with page
numbering throughout. Portfolio Status, Project Status, Exceptions, Financial and Formal
Stage-Gate each have a purpose-built layout.

PDF generation needs pdfmake.min.js and vfs_fonts.js to stay in this folder. It runs entirely
in the browser, so no internet connection is required.

NOTIFICATIONS

The bell in the top-right header shows the signed-in person's unread notification count. Notifications
cover assigned approvals, stage-gate meetings and outcomes, project scope, ownership, review dates,
overdue delivery work and other actionable records. Opening a notification marks it as read and takes
the user directly to the relevant item.

KEY BROWSER-STORAGE RECORDS

Administration uses ppmPortfolios, ppmLifecycleTemplates, ppmReferenceData,
ppmLifecycleMandatoryRules, ppmRagConfig, ppmReportingCalendars and ppmReportingPeriods.
Formal stage gates use ppmStageGates. Projects continue to use ppmProjects, with the selected portfolio
ID, lifecycle template ID and lifecycle version stored on each project.

BACKUPS - READ THIS FIRST

Everything in this tool is stored inside the browser on the machine it is opened on.
There is no copy on a server. Clearing browsing data, a rebuilt laptop, a new machine or
a different browser will take the entire portfolio with it, permanently.

Open Administration and select the "Data and backup" tab:

- Download full backup produces a single file holding every project, plan, milestone,
  RAID item, register, benefit, financial record, stage gate, user account and audit
  event. Save it somewhere the organisation backs up, such as OneDrive or SharePoint.
  Do this weekly at least, and always before restoring or making bulk changes.

- Restore from a backup replaces everything in this browser with the contents of a
  backup file. Use it to move the tool to a new machine, or to recover lost data. It
  asks you to type RESTORE first, because it cannot be undone.

The backup file contains user accounts and their password hashes, so store it as
confidentially as the tool itself.

STORAGE LIMITS

Browsers allow this tool roughly 5 MB. Audit history grows with every saved edit and is
the largest thing held, so a busy team can reach the limit within a few months. When it
is full, nothing more can be saved.

The Data and backup tab shows how much space is in use and what is taking it. A warning
appears on every page once storage passes 70 per cent, and becomes more urgent at 85.

"Archive older events" downloads the oldest audit events as their own file and then
removes them from the browser, freeing space. The file is always produced before
anything is removed, so no history is lost. Keep those archive files with the backups.

If a save is ever refused because storage is full, a message appears explaining what
happened and what to do. The change you were making will need to be re-entered.

HOW THE FILES ARE ORGANISED

Each screen is three files with the same name: the page itself, its styling and its code.
For example project-plan.html, project-plan-page.css and project-plan-page.js. To change
what a screen does, open its -page.js file; to change how it looks, open its -page.css file.

Files beginning ppm- are shared by every screen. ppm-core.js holds the small helpers used
everywhere (escaping, dates, JSON) and loads first on every page. pdfmake.min.js and
vfs_fonts.js are the PDF engine and are third-party files that should not be edited.

AFTER YOU CHANGE A FILE

Double-click bump-version.cmd. Browsers cache scripts and stylesheets, so without this
some people would keep seeing the previous version. It updates the ?v= tag on every page
in one go. Nothing needs installing; it uses PowerShell, already part of Windows.

ADDING A BUTTON THAT CHANGES DATA

Every control that changes data must say which permission it needs:

    <button data-permission="milestones.edit">Save changes</button>

Controls that do not change anything - Cancel, Close, filters, tab switches - say so:

    <button data-permission="none">Cancel</button>

A button that looks like it changes data but has no tag is disabled automatically, and the
browser console lists it on page load. This is deliberate: a new button cannot go live
without someone deciding what permission it needs.

READING AND WRITING STORED DATA

Use PPMAuth.readScoped / writeScoped for anything a normal user reads or edits. These
respect the signed-in person's project access, so someone limited to three projects only
ever sees and saves those three.

Use PPMAuth.readGlobal / writeGlobal only for configuration that is not project-specific,
or for the few administration screens that must see every project. Pass a short reason as
the third argument so the justification sits next to the code.

PROTOTYPE SECURITY BOUNDARY

This remains a browser-storage prototype. Passwords are salted and hashed, sessions expire, failed
sign-ins are rate-limited, and visible records and actions are filtered for the signed-in account.
Browser code cannot provide the server-side enforcement required for production use.

Before live deployment, move identities, permissions, records, workflow enforcement and audit events
to an authenticated server/API, and use the organisation's single sign-on and multi-factor controls.
