/*
  Derives the project field registry.

    node BUILD-PROJECT-FIELDS.mjs

  Reads the field markup in add-project.html and writes ppm-project-fields.js: every
  editable project field, with its label, control, options and help text, grouped, and
  assigned to one of the three forms the project details page offers.

  WHY A REGISTRY

  The details page edits a project in place, in three purpose-built forms - the descriptive
  fields, the status update, and the stage assurance evidence. Those forms are rendered
  from this registry by ppm-project-forms.js. At runtime the details page has nothing to do
  with add-project.html: it does not fetch it, link to it, or load its script.

  WHY GENERATED RATHER THAN TYPED OUT

  There are 113 fields. Typing them a second time is how one gets missed, and a missed
  field is one the page can no longer read or write, with no error anywhere - the value just
  quietly stops being editable. So the markup that already describes them is the source,
  read once, mechanically.

  VERIFY-STATIC.mjs regenerates this in memory and fails if what is on disk differs, so the
  registry cannot drift from the markup it came from.

  IF THE TWO SHOULD DIVERGE

  If the details page's forms are ever meant to differ from the creation form - different
  labels, different grouping - stop generating this file, delete the freshness check in
  VERIFY-STATIC.mjs, and maintain it by hand. That is a deliberate decision to make once,
  not something to discover from a failing gate.
*/

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = "add-project.html";
const OUTPUT = "ppm-project-fields.js";

/*
  The three forms, and what goes in each.

  This is the whole design decision, so it is written out rather than inferred:

    details    what the project IS. Set at creation, changed rarely but not never.
    status     what the project is DOING. Changed every reporting cycle.
    assurance  the evidence each stage gate expects, filled in as the project moves.

  The assurance fields are their own form rather than part of the status update: 38 evidence
  fields alongside a weekly RAG update makes the weekly job harder, and the two are answered
  at different times by different people.

  Grouping is by field id and not read from the markup's own <h4> headings, which was tried
  first and got two groups wrong - some of those headings introduce a display panel (the
  readiness summary, the calculated-RAG comparison) rather than the fields after them, so
  five commentary fields ended up under "Calculated and reported RAG" and the intake
  evidence under "Discovery information". Nothing in the markup distinguishes the two kinds
  of heading, so the grouping is stated here instead.

  Every field in the creation form must appear exactly once below. build() refuses
  otherwise, which is what stops a new field from being silently uneditable here.
*/
const GROUPS = [
  {
    form: "details",
    name: "Identity",
    fields: [
      "projectCode",
      "projectName",
      "shortName",
      "formerName",
      "projectType",
      "projectClassification",
      "confidentialityClassification"
    ]
  },
  {
    form: "details",
    name: "Where it sits",
    fields: [
      "businessArea",
      "portfolio",
      "workstream",
      "priority",
      "lifecycleTemplateId",
      "lifecycleTemplateVersion"
    ]
  },
  {
    form: "details",
    name: "People accountable",
    fields: [
      "requestor",
      "projectManager",
      "sponsor",
      "projectLead",
      "deputyProjectManager",
      "businessOwner",
      "technicalLead",
      "businessAnalyst",
      "testLead",
      "changeLead",
      "financeContact",
      "complianceContact",
      "additionalStakeholders"
    ]
  },
  {
    form: "details",
    name: "What it delivers",
    fields: ["description", "businessProblem", "desiredOutcome", "highLevelScope", "inScope", "outOfScope"]
  },
  {
    form: "details",
    name: "Strategic context",
    fields: [
      "businessPriority",
      "strategicDriver",
      "strategicObjective",
      "regulatoryDriver",
      "customerOutcome",
      "mandatoryDeliveryDate",
      "expectedBenefits",
      "benefitOwner",
      "successMeasures",
      "strategicDependencies",
      "initialResourceRequirements"
    ]
  },

  /*
    Order matters most in this form, because it is the one used every reporting cycle.

    The commentary comes first: what the position is, what happens next, and - if the dates
    have moved - why, and what is being done about it. Then the phase and the forecast dates
    that the commentary is about. Then the RAG assessment, which is a judgement about
    everything above it and reads oddly before it.

    Everything else - the other eight dates, the approval and override fields - is real but
    rarely touched in a weekly update, so it sits below in its own groups rather than filling
    the top of the form.
  */
  {
    form: "status",
    name: "Where it stands now",
    fields: [
      "currentPosition",
      "nextSteps",
      "reasonForSlippage",
      "returnToGreen",
      "currentStage",
      "nextStage",
      "forecastStartDate",
      "forecastEndDate"
    ]
  },
  {
    form: "status",
    name: "RAG assessment",
    fields: [
      "overallRag",
      "scheduleRag",
      "scopeRag",
      "financialRag",
      "resourceRag",
      "riskRag",
      "benefitRag",
      "qualityRag",
      "operationalReadinessRag",
      "deliveryConfidence"
    ]
  },
  {
    form: "status",
    name: "Progress and approval",
    fields: ["projectStatus", "percentageComplete", "approvalStatus", "stageOverrideReason"]
  },
  {
    form: "status",
    name: "Other dates",
    fields: [
      "dateLogged",
      "proposedStartDate",
      "currentStageGate",
      "nextStageGateDate",
      "baselineStartDate",
      "baselineEndDate",
      "targetImplementationDate",
      "actualStartDate",
      "actualEndDate",
      "closureDate"
    ]
  },

  {
    form: "assurance",
    name: "Intake",
    fields: [
      "sponsorConfirmationStatus",
      "assumptionsConstraints",
      "initialRaidSummary",
      "indicativeCosts",
      "resourceDemandSummary"
    ]
  },
  { form: "assurance", name: "Discovery", fields: ["discoveryDeliverables"] },
  {
    form: "assurance",
    name: "Requirements and design",
    fields: [
      "requirementsApprovalStatus",
      "solutionOptions",
      "deliveryPlanSummary",
      "detailedResourceDemand",
      "costEstimate",
      "fundingSource",
      "deliveryDependencies",
      "testApproach",
      "operationalReadinessRequirements",
      "implementationApproach",
      "benefitMeasures"
    ]
  },
  {
    form: "assurance",
    name: "Build and test",
    fields: [
      "baselineApprovalStatus",
      "testDatesStatus",
      "defectsBlockers",
      "deploymentDependencies",
      "goLiveCriteria"
    ]
  },
  {
    form: "assurance",
    name: "Implementation",
    fields: [
      "approvedImplementationDate",
      "goLiveApprovalStatus",
      "operationalReadinessStatus",
      "trainingStatus",
      "communicationsStatus",
      "supportModel",
      "hypercarePlan",
      "rollbackPlan",
      "outstandingRisksIssues"
    ]
  },
  {
    form: "assurance",
    name: "Closure",
    fields: [
      "closureSummary",
      "finalFinancialPosition",
      "outstandingActions",
      "benefitsHandover",
      "lessonsLearned",
      "closureApprovalStatus",
      "archiveLocation"
    ]
  }
];

const FORM_META = {
  details: {
    /*
      The permission each form's controls carry. PPMAuth disables any control it finds that
      changes data and has no data-permission - "fail closed" - so every rendered field
      states which permission it needs. Without it the whole form arrives disabled, which is
      correct behaviour applied to the wrong thing.
    */
    permission: "projects.edit",
    title: "Edit project details",
    description:
      "What the project is: its identity, scope, the people accountable for it and its strategic context. These change rarely once a project exists."
  },
  status: {
    permission: "projects.status",
    title: "Update project status",
    description:
      "Where the project has got to: its stage, dates, progress, health assessment and the commentary behind it. This is the form to use for a reporting update."
  },
  assurance: {
    permission: "projects.edit",
    title: "Lifecycle assurance evidence",
    description:
      "The evidence each stage gate expects, grouped by the stage that asks for it. Fill each group in as the project reaches that stage."
  }
};

const text = (value) =>
  String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  if (match) return match[1];
  /* Valueless attributes: required, readonly, multiple, disabled. */
  return new RegExp(`\\s${name}(?=[\\s/>])`).test(tag) ? "" : null;
}

function optionsOf(block) {
  return [...block.matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)].map((match) => {
    const value = attribute(match[1] + " ", "value");
    const label = text(match[2]);
    return { value: value === null ? label : value, label };
  });
}

/*
  Words that stay lower case inside a heading, and words that are never merely capitalised.
  Without the first list "Reason for slippage" becomes "Reason For Slippage"; without the
  second, "Overall rag" and "Initial raid summary".
*/
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
const ACRONYMS = new Map([
  ["rag", "RAG"],
  ["raid", "RAID"],
  ["id", "ID"],
  ["pm", "PM"],
  ["pmo", "PMO"],
  ["it", "IT"],
  ["kpi", "KPI"],
  ["sla", "SLA"],
  ["bau", "BAU"],
  ["ba", "BA"]
]);

/*
  Turns a field id or an existing label into a heading.

  Both go through the same function on purpose. A label lifted from the markup is written in
  sentence case ("Proposed start date"); an id has no case at all
  ("proposedStartDate"). Passing both through one formatter is what makes every heading in
  all three forms look like it was written by the same person.
*/
function heading(source) {
  const words = String(source)
    /* camelCase and PascalCase to spaced words: proposedStartDate -> proposed Start Date */
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s*\*\s*$/, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return ACRONYMS.get(lower);
      /* A small word keeps its place but not a capital, unless it opens the heading. */
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      /* Words already carrying internal capitals are left alone: "GoLive", "IRIS". */
      if (/[A-Z]/.test(word.slice(1))) return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/*
  The label is found by its `for` attribute across the whole form rather than inside the
  field's block.

  It used to be looked up inside the block, with a `</label>` closing tag. Both were wrong:
  the markup is formatted `</label\n>` on its own line - so the literal never matched - and
  block slicing added a second way to miss. 61 of 113 headings silently fell back to the raw
  id, which is how "proposedStartDate" ended up on screen as a heading. `for` is unique, so
  no slicing is needed to find the right label.
*/
function labelFor(html, id) {
  const match = new RegExp(`<label[^>]*for="${id}"[^>]*>([\\s\\S]*?)</label\\s*>`).exec(html);
  return match ? text(match[1]) : "";
}

/*
  Reads one field out of the creation form's markup by id: its label, control, options, help
  text and constraints. The enclosing .form-field block is located first, so the help text
  that belongs to this field is the one found.
*/
function readField(html, id) {
  const control = new RegExp(`<(input|select|textarea)([^>]*\\sid="${id}"[^>]*)>`).exec(html);
  if (!control) throw new Error(`${SOURCE}: no control with id="${id}"`);

  /* The block this field lives in, so a neighbouring field's label is not picked up. */
  const before = html.lastIndexOf('<div class="form-field', control.index);
  const afterStart = control.index + control[0].length;
  const nextBlock = html.indexOf('<div class="form-field', afterStart);
  const block = html.slice(before === -1 ? control.index : before, nextBlock === -1 ? afterStart + 400 : nextBlock);

  const [, tagName, rawAttributes] = control;
  const attributes = `${rawAttributes} `;
  const help = /<p class="help-text">([\s\S]*?)<\/p>/.exec(block);

  /* The markup's wording where it has one, the id humanised where it does not - and both
     formatted the same way, so no heading reads like a variable name. */
  const field = { id, label: heading(labelFor(html, id) || id), control: tagName };
  if (tagName === "input") field.type = attribute(attributes, "type") || "text";
  if (attribute(attributes, "required") !== null) field.required = true;
  if (attribute(attributes, "readonly") !== null) field.readOnly = true;
  ["placeholder", "maxlength", "min", "max", "step", "rows"].forEach((name) => {
    const value = attribute(attributes, name);
    if (value !== null && value !== "") field[name] = value;
  });
  if (help) field.help = text(help[1]);

  if (tagName === "select") {
    const from = html.indexOf(control[0]);
    const to = html.indexOf("</select>", from);
    field.options = optionsOf(html.slice(from, to === -1 ? undefined : to));
  }

  return field;
}

export function build() {
  const html = readFileSync(join(HERE, SOURCE), "utf8");

  /* Every editable control inside the creation form, so coverage can be proved rather
     than assumed. */
  const formStart = html.indexOf('<form id="projectForm"');
  const formEnd = html.indexOf("</form>", formStart);
  if (formStart === -1 || formEnd === -1) throw new Error(`${SOURCE}: #projectForm not found`);
  const formHtml = html.slice(formStart, formEnd);
  const inForm = [...formHtml.matchAll(/<(?:input|select|textarea)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);

  const grouped = GROUPS.flatMap((group) => group.fields);
  const missing = inForm.filter((id) => !grouped.includes(id));
  const unknown = grouped.filter((id) => !inForm.includes(id));
  const duplicated = grouped.filter((id, index) => grouped.indexOf(id) !== index);

  /*
    Three refusals rather than three silent omissions. A field present in the creation form
    but absent from every group would exist on a new project and then be uneditable, which
    is the failure this whole file is arranged to prevent.
  */
  if (missing.length) throw new Error(`fields in ${SOURCE} that no group claims: ${missing.join(", ")}`);
  if (unknown.length) throw new Error(`grouped fields that ${SOURCE} does not contain: ${unknown.join(", ")}`);
  if (duplicated.length) throw new Error(`fields claimed by more than one group: ${duplicated.join(", ")}`);

  const forms = { details: [], status: [], assurance: [] };
  GROUPS.forEach((group) => {
    forms[group.form].push({
      name: group.name,
      fields: group.fields.map((id) => readField(formHtml, id))
    });
  });

  const body = Object.entries(forms)
    .map(([name, groups]) => {
      const meta = FORM_META[name];
      const count = groups.reduce((sum, group) => sum + group.fields.length, 0);
      const groupSource = groups
        .map(
          (group) =>
            `        {\n` +
            `          name: ${JSON.stringify(group.name)},\n` +
            `          fields: [\n` +
            group.fields.map((field) => `            ${JSON.stringify(field)}`).join(",\n") +
            `\n          ]\n` +
            `        }`
        )
        .join(",\n");
      return (
        `    /* ${count} field(s) in ${groups.length} group(s). */\n` +
        `    ${name}: {\n` +
        `      permission: ${JSON.stringify(meta.permission)},\n` +
        `      title: ${JSON.stringify(meta.title)},\n` +
        `      description: ${JSON.stringify(meta.description)},\n` +
        `      groups: [\n${groupSource}\n      ]\n` +
        `    }`
      );
    })
    .join(",\n");

  const total = inForm.length;

  return (
    `/*\n` +
    `  GENERATED - do not edit.\n\n` +
    `  Every editable project field, derived from the field markup in ${SOURCE} and grouped\n` +
    `  into the three forms the project details page offers. ${total} fields.\n\n` +
    `  Rendered by ppm-project-forms.js. Regenerate with:  node BUILD-PROJECT-FIELDS.mjs\n` +
    `  VERIFY-STATIC.mjs fails if this file and ${SOURCE} have drifted apart.\n` +
    `*/\n` +
    `window.PPMProjectFields = Object.freeze({\n` +
    `  forms: {\n${body}\n  }\n` +
    `});\n`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const source = build();
  writeFileSync(join(HERE, OUTPUT), source, "utf8");
  const fields = (source.match(/"id":/g) || []).length;
  console.log(`${OUTPUT} written (${fields} fields, ${Math.round(source.length / 1024)} KB)`);
}
