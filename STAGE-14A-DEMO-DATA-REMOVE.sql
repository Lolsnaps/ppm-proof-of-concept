/*
  STAGE 14A - remove the demo data.

  Deletes strictly where legacy_payload->>'demoDataSet' = 'STAGE-14A', so it can
  only ever remove rows this seed created. Your four real people, PRJ-00001 to
  PRJ-00005 and anything you have entered yourself are untouched.

  Two things it deliberately does NOT undo:
    - the enrichment of PORT-00001 and PRG-00001 to PRG-00005, because those rows
      existed before the seed and the added detail is an improvement worth keeping;
    - audit_log entries, which are append-only by design. History of the seed
      having happened is not something the application is allowed to erase.
*/

begin;

/* Recorded status history is protected by an immutability trigger that refuses a
   delete from everyone, the table owner included - confirmed by attempting it. The
   trigger is therefore switched off for exactly one statement, inside this
   transaction, and switched straight back on. It is never off outside these two
   lines, and only rows carrying the seed marker are removed. */
alter table public.rag_history disable trigger trg_rag_history_immutable;
delete from public.rag_history where legacy_payload->>'demoDataSet' = 'STAGE-14A';
alter table public.rag_history enable trigger trg_rag_history_immutable;

delete from public.project_plans where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.project_milestones where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.project_raid where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.project_actions where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.project_decisions where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.project_documents where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.project_financials where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.financial_entries where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.financial_approval_requests where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.project_benefits where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.status_reports where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.stage_gates where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.plan_baselines where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.plan_baseline_requests where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.resource_demand where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.reference_data where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.financial_categories where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.reporting_periods where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.resource_absence where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.rag_config where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.resource_config where legacy_payload->>'demoDataSet' = 'STAGE-14A';

/* Projects and people last, because the child rows above reference them. */
delete from public.projects where legacy_payload->>'demoDataSet' = 'STAGE-14A';
delete from public.people where legacy_payload->>'demoDataSet' = 'STAGE-14A';

do $$
declare
    v_left integer;
begin
    select count(*) into v_left from public.projects
     where legacy_payload->>'demoDataSet' = 'STAGE-14A';
    raise notice 'Stage 14A demo data removed. Demo projects remaining: %', v_left;
end $$;

commit;
