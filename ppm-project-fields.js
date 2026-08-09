/*
  GENERATED - do not edit.

  Every editable project field, derived from the field markup in add-project.html and grouped
  into the three forms the project details page offers. 113 fields.

  Rendered by ppm-project-forms.js. Regenerate with:  node BUILD-PROJECT-FIELDS.mjs
  VERIFY-STATIC.mjs fails if this file and add-project.html have drifted apart.
*/
window.PPMProjectFields = Object.freeze({
  forms: {
    /* 43 field(s) in 5 group(s). */
    details: {
      permission: "projects.edit",
      title: "Edit project details",
      description: "What the project is: its identity, scope, the people accountable for it and its strategic context. These change rarely once a project exists.",
      groups: [
        {
          name: "Identity",
          fields: [
            {"id":"projectCode","label":"Project Code","control":"input","type":"text","readOnly":true,"help":"Generated automatically and cannot be changed."},
            {"id":"projectName","label":"Project Name","control":"input","type":"text","required":true,"placeholder":"Enter the project name","maxlength":"200"},
            {"id":"shortName","label":"Short Name","control":"input","type":"text","placeholder":"Short project name","maxlength":"80"},
            {"id":"formerName","label":"Former Name or Alias","control":"input","type":"text","placeholder":"Previous or alternative name","maxlength":"160"},
            {"id":"projectType","label":"Project Type","control":"select","options":[{"value":"","label":"Not set"},{"value":"Change project","label":"Change project"},{"value":"Programme project","label":"Programme project"},{"value":"Regulatory change","label":"Regulatory change"},{"value":"Technology delivery","label":"Technology delivery"},{"value":"Product change","label":"Product change"},{"value":"BAU initiative","label":"BAU initiative"}]},
            {"id":"projectClassification","label":"Classification","control":"select","options":[{"value":"","label":"Not set"},{"value":"Strategy","label":"Strategy"},{"value":"Regulatory","label":"Regulatory"},{"value":"Mandatory","label":"Mandatory"},{"value":"Operational","label":"Operational"},{"value":"Technology","label":"Technology"},{"value":"Product","label":"Product"},{"value":"BAU","label":"BAU"}]},
            {"id":"confidentialityClassification","label":"Confidentiality","control":"select","options":[{"value":"Internal","label":"Internal"},{"value":"Public","label":"Public"},{"value":"Confidential","label":"Confidential"},{"value":"Highly Confidential","label":"Highly Confidential"}]}
          ]
        },
        {
          name: "Where it sits",
          fields: [
            {"id":"businessArea","label":"Business Area","control":"select","options":[{"value":"","label":"Not set"}]},
            {"id":"portfolio","label":"Portfolio","control":"select","options":[{"value":"","label":"Select a portfolio"}]},
            {"id":"workstream","label":"Programme / Workstream","control":"select","options":[{"value":"","label":"Select a programme / workstream"}]},
            {"id":"priority","label":"Priority","control":"select","options":[{"value":"Not Set","label":"Not set"},{"value":"Critical","label":"Critical"},{"value":"High","label":"High"},{"value":"Medium","label":"Medium"},{"value":"Low","label":"Low"}]},
            {"id":"lifecycleTemplateId","label":"Lifecycle Template","control":"select","help":"The template controls stages, gates and mandatory information.","options":[{"value":"","label":"Select a lifecycle template"}]},
            {"id":"lifecycleTemplateVersion","label":"Lifecycle Template Version","control":"input","type":"hidden","help":"The template controls stages, gates and mandatory information."}
          ]
        },
        {
          name: "People accountable",
          fields: [
            {"id":"requestor","label":"Requestor","control":"select","options":[{"value":"","label":"Select a requestor"}]},
            {"id":"projectManager","label":"Project Manager","control":"select","options":[{"value":"","label":"Select a project manager"}]},
            {"id":"sponsor","label":"Project Sponsor","control":"select","options":[{"value":"","label":"Select a project sponsor"}]},
            {"id":"projectLead","label":"Project Lead","control":"select","options":[{"value":"","label":"Select a project lead"}]},
            {"id":"deputyProjectManager","label":"Deputy Project Manager","control":"select","options":[{"value":"","label":"Select a deputy project manager"}]},
            {"id":"businessOwner","label":"Business Owner","control":"select","options":[{"value":"","label":"Select a business owner"}]},
            {"id":"technicalLead","label":"Technical Lead","control":"select","options":[{"value":"","label":"Select a technical lead"}]},
            {"id":"businessAnalyst","label":"Business Analyst","control":"select","options":[{"value":"","label":"Select a business analyst"}]},
            {"id":"testLead","label":"Test Lead","control":"select","options":[{"value":"","label":"Select a test lead"}]},
            {"id":"changeLead","label":"Change / Operational Readiness Lead","control":"select","options":[{"value":"","label":"Select a change lead"}]},
            {"id":"financeContact","label":"Finance Contact","control":"select","options":[{"value":"","label":"Select a finance contact"}]},
            {"id":"complianceContact","label":"Compliance Contact","control":"select","options":[{"value":"","label":"Select a compliance contact"}]},
            {"id":"additionalStakeholders","label":"Additional Stakeholders","control":"textarea","placeholder":"Record other stakeholders, groups or governance attendees","maxlength":"4000"}
          ]
        },
        {
          name: "What it delivers",
          fields: [
            {"id":"description","label":"Project Description","control":"textarea","required":true,"placeholder":"Describe what the project will deliver and why it is required","maxlength":"4000"},
            {"id":"businessProblem","label":"Background or Business Problem","control":"textarea","placeholder":"Describe the problem or opportunity that prompted the project","maxlength":"4000"},
            {"id":"desiredOutcome","label":"Desired Outcome","control":"textarea","placeholder":"Describe the outcome the project is expected to achieve","maxlength":"4000"},
            {"id":"highLevelScope","label":"High Level Scope","control":"textarea","placeholder":"Describe the work included within the project","maxlength":"4000"},
            {"id":"inScope","label":"Detailed in Scope Items","control":"textarea","placeholder":"List the products, processes, teams or deliverables included","maxlength":"4000"},
            {"id":"outOfScope","label":"Out of Scope","control":"textarea","placeholder":"Describe anything explicitly excluded from the project","maxlength":"4000"}
          ]
        },
        {
          name: "Strategic context",
          fields: [
            {"id":"businessPriority","label":"Business Priority","control":"select","options":[{"value":"","label":"Not set"},{"value":"Critical","label":"Critical"},{"value":"High","label":"High"},{"value":"Medium","label":"Medium"},{"value":"Low","label":"Low"}]},
            {"id":"strategicDriver","label":"Strategic or Regulatory Driver","control":"select","options":[{"value":"","label":"Not set"},{"value":"Strategic","label":"Strategic"},{"value":"Regulatory","label":"Regulatory"},{"value":"Mandatory","label":"Mandatory"},{"value":"Customer","label":"Customer"},{"value":"Risk reduction","label":"Risk reduction"},{"value":"Operational efficiency","label":"Operational efficiency"}]},
            {"id":"strategicObjective","label":"Strategic Objective","control":"textarea","maxlength":"4000"},
            {"id":"regulatoryDriver","label":"Regulatory Driver or Obligation","control":"textarea","maxlength":"4000"},
            {"id":"customerOutcome","label":"Customer Outcome","control":"textarea","maxlength":"4000"},
            {"id":"mandatoryDeliveryDate","label":"Mandatory Delivery Date","control":"input","type":"date"},
            {"id":"expectedBenefits","label":"Expected Benefits","control":"textarea","maxlength":"4000"},
            {"id":"benefitOwner","label":"Benefit Owner","control":"select","options":[{"value":"","label":"Select a benefit owner"}]},
            {"id":"successMeasures","label":"Success Measures","control":"textarea","maxlength":"4000"},
            {"id":"strategicDependencies","label":"Dependencies on Strategic Initiatives","control":"textarea","maxlength":"4000"},
            {"id":"initialResourceRequirements","label":"Initial Resource Requirements","control":"textarea","placeholder":"Summarise the teams, roles or specialist capacity required","maxlength":"4000"}
          ]
        }
      ]
    },
    /* 32 field(s) in 4 group(s). */
    status: {
      permission: "projects.status",
      title: "Update project status",
      description: "Where the project has got to: its stage, dates, progress, health assessment and the commentary behind it. This is the form to use for a reporting update.",
      groups: [
        {
          name: "Where it stands now",
          fields: [
            {"id":"currentPosition","label":"Current Position","control":"textarea","placeholder":"Summarise the current position of the project","maxlength":"4000"},
            {"id":"nextSteps","label":"Next Steps","control":"textarea","placeholder":"Summarise the immediate next steps","maxlength":"4000"},
            {"id":"reasonForSlippage","label":"Reason for Slippage","control":"textarea","placeholder":"Explain why the forecast date is later than the baseline","maxlength":"4000"},
            {"id":"returnToGreen","label":"Return to Green Actions","control":"textarea","required":true,"placeholder":"Describe the actions required to recover the project","maxlength":"4000"},
            {"id":"currentStage","label":"Current Stage","control":"select","options":[{"value":"Intake","label":"Intake"},{"value":"Discovery","label":"Discovery"},{"value":"Requirements and Design","label":"Requirements and Design"},{"value":"Build","label":"Build"},{"value":"Test","label":"Test"},{"value":"Implementation","label":"Implementation"},{"value":"Hypercare","label":"Hypercare"},{"value":"Closure","label":"Closure"}]},
            {"id":"nextStage","label":"Next Stage","control":"select","help":"This exceptional change is retained in Audit History. Normal progression is completed from Stage Gates.","options":[{"value":"","label":"Not set"},{"value":"Discovery","label":"Discovery"},{"value":"Requirements and Design","label":"Requirements and Design"},{"value":"Build","label":"Build"},{"value":"Test","label":"Test"},{"value":"Implementation","label":"Implementation"},{"value":"Hypercare","label":"Hypercare"},{"value":"Closure","label":"Closure"}]},
            {"id":"forecastStartDate","label":"Forecast Start Date","control":"input","type":"date"},
            {"id":"forecastEndDate","label":"Forecast End Date","control":"input","type":"date"}
          ]
        },
        {
          name: "RAG assessment",
          fields: [
            {"id":"overallRag","label":"Overall RAG","control":"select","required":true,"options":[{"value":"Not Assessed","label":"Not Assessed"},{"value":"Green","label":"Green"},{"value":"Amber","label":"Amber"},{"value":"Red","label":"Red"}]},
            {"id":"scheduleRag","label":"Schedule RAG","control":"select","options":[{"value":"Not Assessed","label":"Not Assessed"},{"value":"Green","label":"Green"},{"value":"Amber","label":"Amber"},{"value":"Red","label":"Red"}]},
            {"id":"scopeRag","label":"Scope RAG","control":"select","options":[{"value":"Not Assessed","label":"Not Assessed"},{"value":"Green","label":"Green"},{"value":"Amber","label":"Amber"},{"value":"Red","label":"Red"}]},
            {"id":"financialRag","label":"Financial RAG","control":"select","options":[{"value":"Not Assessed","label":"Not Assessed"},{"value":"Green","label":"Green"},{"value":"Amber","label":"Amber"},{"value":"Red","label":"Red"}]},
            {"id":"resourceRag","label":"Resources RAG","control":"select","options":[{"value":"Not Assessed","label":"Not Assessed"},{"value":"Green","label":"Green"},{"value":"Amber","label":"Amber"},{"value":"Red","label":"Red"}]},
            {"id":"riskRag","label":"Risk RAG","control":"select","options":[{"value":"Not Assessed","label":"Not Assessed"},{"value":"Green","label":"Green"},{"value":"Amber","label":"Amber"},{"value":"Red","label":"Red"}]},
            {"id":"benefitRag","label":"Benefits RAG","control":"select","options":[{"value":"Not Assessed","label":"Not Assessed"},{"value":"Green","label":"Green"},{"value":"Amber","label":"Amber"},{"value":"Red","label":"Red"}]},
            {"id":"qualityRag","label":"Quality RAG","control":"select","options":[{"value":"Not Assessed","label":"Not Assessed"},{"value":"Green","label":"Green"},{"value":"Amber","label":"Amber"},{"value":"Red","label":"Red"}]},
            {"id":"operationalReadinessRag","label":"Operational Readiness RAG","control":"select","options":[{"value":"Not Assessed","label":"Not Assessed"},{"value":"Green","label":"Green"},{"value":"Amber","label":"Amber"},{"value":"Red","label":"Red"}]},
            {"id":"deliveryConfidence","label":"Delivery Confidence","control":"select","options":[{"value":"Not Assessed","label":"Not Assessed"},{"value":"Confident","label":"Confident"},{"value":"At Risk","label":"At Risk"},{"value":"Unlikely","label":"Unlikely"}]}
          ]
        },
        {
          name: "Progress and approval",
          fields: [
            {"id":"projectStatus","label":"Project Status","control":"select","required":true,"options":[{"value":"Proposed","label":"Proposed"},{"value":"Planned","label":"Planned"},{"value":"Active","label":"Active"},{"value":"On Hold","label":"On Hold"},{"value":"Completed","label":"Completed"},{"value":"Cancelled","label":"Cancelled"},{"value":"Rejected","label":"Rejected"}]},
            {"id":"percentageComplete","label":"Percentage Complete","control":"input","type":"number","required":true,"min":"0","max":"100"},
            {"id":"approvalStatus","label":"Approval Status","control":"select","options":[{"value":"Draft","label":"Draft"},{"value":"Pending Approval","label":"Pending Approval"},{"value":"Approved","label":"Approved"},{"value":"Conditionally Approved","label":"Conditionally Approved"},{"value":"Rejected","label":"Rejected"},{"value":"Deferred","label":"Deferred"}]},
            {"id":"stageOverrideReason","label":"Stage Override Justification","control":"textarea","placeholder":"Explain why the project stage is being changed without an approved formal stage gate.","maxlength":"2000","help":"This exceptional change is retained in Audit History. Normal progression is completed from Stage Gates."}
          ]
        },
        {
          name: "Other dates",
          fields: [
            {"id":"dateLogged","label":"Date Logged","control":"input","type":"date"},
            {"id":"proposedStartDate","label":"Proposed Start Date","control":"input","type":"date"},
            {"id":"currentStageGate","label":"Current Stage Gate","control":"input","type":"text","placeholder":"Current governance gate","maxlength":"180"},
            {"id":"nextStageGateDate","label":"Next Stage Gate Date","control":"input","type":"date"},
            {"id":"baselineStartDate","label":"Baseline Start Date","control":"input","type":"date"},
            {"id":"baselineEndDate","label":"Baseline End Date","control":"input","type":"date"},
            {"id":"targetImplementationDate","label":"Target Implementation Date","control":"input","type":"date"},
            {"id":"actualStartDate","label":"Actual Start Date","control":"input","type":"date"},
            {"id":"actualEndDate","label":"Actual End Date","control":"input","type":"date"},
            {"id":"closureDate","label":"Closure Date","control":"input","type":"date"}
          ]
        }
      ]
    },
    /* 38 field(s) in 6 group(s). */
    assurance: {
      permission: "projects.edit",
      title: "Lifecycle assurance evidence",
      description: "The evidence each stage gate expects, grouped by the stage that asks for it. Fill each group in as the project reaches that stage.",
      groups: [
        {
          name: "Intake",
          fields: [
            {"id":"sponsorConfirmationStatus","label":"Sponsor Confirmation","control":"select","options":[{"value":"","label":"Not set"},{"value":"Proposed","label":"Proposed"},{"value":"Confirmed","label":"Confirmed"}]},
            {"id":"assumptionsConstraints","label":"Assumptions and Constraints","control":"textarea"},
            {"id":"initialRaidSummary","label":"Initial RAID Summary","control":"textarea"},
            {"id":"indicativeCosts","label":"Indicative Costs (£)","control":"input","type":"number","min":"0","step":"1000"},
            {"id":"resourceDemandSummary","label":"Indicative Resource Demand","control":"textarea"}
          ]
        },
        {
          name: "Discovery",
          fields: [
            {"id":"discoveryDeliverables","label":"Discovery Deliverables","control":"textarea"}
          ]
        },
        {
          name: "Requirements and design",
          fields: [
            {"id":"requirementsApprovalStatus","label":"Requirements Approval","control":"select","options":[{"value":"","label":"Not set"},{"value":"Draft","label":"Draft"},{"value":"Pending Approval","label":"Pending Approval"},{"value":"Approved","label":"Approved"},{"value":"Rejected","label":"Rejected"}]},
            {"id":"solutionOptions","label":"Solution Options and Selected Approach","control":"textarea"},
            {"id":"deliveryPlanSummary","label":"Confirmed Delivery Plan","control":"textarea"},
            {"id":"detailedResourceDemand","label":"Detailed Resource Demand","control":"textarea"},
            {"id":"costEstimate","label":"Cost Estimate (£)","control":"input","type":"number","min":"0","step":"1000"},
            {"id":"fundingSource","label":"Funding Source","control":"input","type":"text","placeholder":"Approved source or cost centre","maxlength":"240"},
            {"id":"deliveryDependencies","label":"Delivery Dependencies","control":"textarea"},
            {"id":"testApproach","label":"Test Approach","control":"textarea"},
            {"id":"operationalReadinessRequirements","label":"Operational Readiness Requirements","control":"textarea"},
            {"id":"implementationApproach","label":"Implementation Approach","control":"textarea"},
            {"id":"benefitMeasures","label":"Benefit Measures","control":"textarea"}
          ]
        },
        {
          name: "Build and test",
          fields: [
            {"id":"baselineApprovalStatus","label":"Baseline Approval","control":"select","options":[{"value":"","label":"Not set"},{"value":"Pending Approval","label":"Pending Approval"},{"value":"Approved","label":"Approved"},{"value":"Rejected","label":"Rejected"}]},
            {"id":"testDatesStatus","label":"Test Dates and Current Status","control":"textarea"},
            {"id":"defectsBlockers","label":"Defects or Delivery Blockers","control":"textarea"},
            {"id":"deploymentDependencies","label":"Deployment Dependencies","control":"textarea"},
            {"id":"goLiveCriteria","label":"Go Live Criteria","control":"textarea"}
          ]
        },
        {
          name: "Implementation",
          fields: [
            {"id":"approvedImplementationDate","label":"Approved Implementation Date","control":"input","type":"date"},
            {"id":"goLiveApprovalStatus","label":"Go Live Approval","control":"select","options":[{"value":"","label":"Not set"},{"value":"Pending Approval","label":"Pending Approval"},{"value":"Approved","label":"Approved"},{"value":"Conditionally Approved","label":"Conditionally Approved"},{"value":"Rejected","label":"Rejected"}]},
            {"id":"operationalReadinessStatus","label":"Operational Readiness Status","control":"select","options":[{"value":"","label":"Not set"},{"value":"Not Started","label":"Not Started"},{"value":"In Progress","label":"In Progress"},{"value":"Ready","label":"Ready"},{"value":"Not Ready","label":"Not Ready"}]},
            {"id":"trainingStatus","label":"Training Status","control":"select","options":[{"value":"","label":"Not set"},{"value":"Not Required","label":"Not Required"},{"value":"Not Started","label":"Not Started"},{"value":"In Progress","label":"In Progress"},{"value":"Complete","label":"Complete"}]},
            {"id":"communicationsStatus","label":"Communications Status","control":"select","options":[{"value":"","label":"Not set"},{"value":"Not Required","label":"Not Required"},{"value":"Not Started","label":"Not Started"},{"value":"In Progress","label":"In Progress"},{"value":"Complete","label":"Complete"}]},
            {"id":"supportModel","label":"Support Model","control":"textarea"},
            {"id":"hypercarePlan","label":"Hypercare Plan","control":"textarea"},
            {"id":"rollbackPlan","label":"Rollback Plan","control":"textarea"},
            {"id":"outstandingRisksIssues","label":"Outstanding Risks and Issues","control":"textarea"}
          ]
        },
        {
          name: "Closure",
          fields: [
            {"id":"closureSummary","label":"Closure Summary","control":"textarea"},
            {"id":"finalFinancialPosition","label":"Final Financial Position","control":"textarea"},
            {"id":"outstandingActions","label":"Outstanding Actions","control":"textarea"},
            {"id":"benefitsHandover","label":"Benefits Handover","control":"textarea"},
            {"id":"lessonsLearned","label":"Lessons Learned","control":"textarea"},
            {"id":"closureApprovalStatus","label":"Closure Approval","control":"select","options":[{"value":"","label":"Not set"},{"value":"Pending Approval","label":"Pending Approval"},{"value":"Approved","label":"Approved"},{"value":"Rejected","label":"Rejected"}]},
            {"id":"archiveLocation","label":"Archive Location","control":"input","type":"url","placeholder":"SharePoint or governed repository link"}
          ]
        }
      ]
    }
  }
});
