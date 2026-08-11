/* Portfolio Manager — Stage 11F read-only verification

   Run after STAGE-11F-AUDIT-CONSOLIDATION-MIGRATION.sql. Every statement is a
   SELECT. Expect PASS on every row.

   The checks that matter most are the privilege ones. An audit trail the browser
   can write to is not an audit trail, so "no INSERT grant" is the property this
   whole stage rests on.
*/

select 'Stage 11F readiness function exists' as check,
       case when to_regprocedure('public.ppm_stage11f_ready()') is not null then 'PASS' else 'FAIL' end as result;

select 'Gated import function exists' as check,
       case when to_regprocedure('public.ppm_import_legacy_audit(jsonb)') is not null
            then 'PASS'
            else 'ABSENT — expected if you have already dropped it after importing' end as result;

select 'Import function is SECURITY DEFINER with a pinned search_path' as check,
       case when count(*) = 1 then 'PASS'
            when count(*) = 0 then 'SKIPPED — function already dropped'
            else 'FAIL' end as result
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'ppm_import_legacy_audit'
  and p.prosecdef
  /* PostgreSQL stores `set search_path = ''` as the text search_path="" — quotes
     included — so this matches the prefix rather than an exact string. */
  and exists (
      select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as c(setting)
       where c.setting like 'search_path=%'
  );

select 'Import function is not executable by anon' as check,
       case when to_regprocedure('public.ppm_import_legacy_audit(jsonb)') is null then 'SKIPPED — already dropped'
            when not has_function_privilege('anon', 'public.ppm_import_legacy_audit(jsonb)', 'EXECUTE')
             and has_function_privilege('authenticated', 'public.ppm_import_legacy_audit(jsonb)', 'EXECUTE')
            then 'PASS' else 'FAIL' end as result;

/* ---------------------------------------------------------- the core property */

select 'Verified trail is readable and unwritable from the browser' as check,
       case when has_table_privilege('authenticated', 'public.audit_log', 'SELECT')
             and not has_table_privilege('authenticated', 'public.audit_log', 'INSERT')
             and not has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
             and not has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
             and not has_table_privilege('authenticated', 'public.audit_log', 'TRUNCATE')
            then 'PASS' else 'FAIL' end as result;

select 'Legacy history is readable and unwritable from the browser' as check,
       case when has_table_privilege('authenticated', 'public.legacy_audit_history', 'SELECT')
             and not has_table_privilege('authenticated', 'public.legacy_audit_history', 'INSERT')
             and not has_table_privilege('authenticated', 'public.legacy_audit_history', 'UPDATE')
             and not has_table_privilege('authenticated', 'public.legacy_audit_history', 'DELETE')
             and not has_table_privilege('authenticated', 'public.legacy_audit_history', 'TRUNCATE')
             and not has_table_privilege('authenticated', 'public.legacy_audit_history', 'TRIGGER')
             and not has_table_privilege('authenticated', 'public.legacy_audit_history', 'REFERENCES')
            then 'PASS' else 'FAIL' end as result;

select 'anon cannot read either audit table' as check,
       case when not has_table_privilege('anon', 'public.audit_log', 'SELECT')
             and not has_table_privilege('anon', 'public.legacy_audit_history', 'SELECT')
            then 'PASS' else 'FAIL' end as result;

/* ------------------------------------------------------------------ policies */

select 'RLS enabled on both audit tables' as check,
       case when count(*) = 2 then 'PASS' else 'FAIL: ' || count(*) || ' of 2' end as result
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relrowsecurity
  and c.relname = any(array['audit_log', 'legacy_audit_history']);

select 'Legacy history read policy is scope-aware' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as result
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = 'legacy_audit_history'
  and policyname = 'legacy_audit_history read scope'
  and qual like '%can_access_project%'
  and qual like '%audit.view%';

select 'Legacy history requires AAL2' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as result
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = 'legacy_audit_history'
  and permissive = 'RESTRICTIVE'
  and qual like '%aal2%';

select 'Legacy history has no write policy' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || string_agg(policyname, ', ') end as result
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = 'legacy_audit_history'
  and cmd in ('INSERT', 'UPDATE', 'DELETE');

select 'Audit immutability triggers still installed' as check,
       case when count(*) >= 1 then 'PASS' else 'FAIL' end as result
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname = 'audit_log';

select 'Chronology index on legacy history' as check,
       case when to_regclass('public.legacy_audit_history_timestamp_idx') is not null
            then 'PASS' else 'FAIL' end as result;

/* ------------------------------------------------------ anonymous surface

   Added in Stage 11F after finding six public ppm_* functions reachable by anon,
   because `revoke ... from public` does not remove Supabase's explicit default
   grant to that role. Checked as a sweep so a function added later cannot miss it.
*/
select 'No public ppm_* function is reachable by anon' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || string_agg(p.proname, ', ') end as result
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'ppm%'
  and has_function_privilege('anon', p.oid, 'EXECUTE');

select 'No table in public or private is reachable by anon' as check,
       case when count(*) = 0 then 'PASS'
            else 'FAIL: ' || string_agg(n.nspname || '.' || c.relname, ', ') end as result
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','private') and c.relkind = 'r'
  and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
    or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')
    or has_table_privilege('anon', c.oid, 'TRUNCATE'));

select 'RLS is enabled on every public table' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || string_agg(c.relname, ', ') end as result
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

/* ------------------------------------------------------- import provenance */

select 'Every imported row is stamped unverified' as check,
       case when count(*) = 0 then 'PASS'
            else 'FAIL: ' || count(*) || ' imported row(s) missing a provenance stamp' end as result
from public.legacy_audit_history
where import_payload is not null
  and coalesce(import_payload ->> 'verified', 'missing') <> 'false';

select 'No imported row claims to be verified' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) || ' row(s)' end as result
from public.legacy_audit_history
where (import_payload ->> 'verified')::text = 'true';

select 'Imported rows carry a business key' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) || ' row(s)' end as result
from public.legacy_audit_history
where coalesce(btrim(record_key), '') = '';

/* ---------------------------------------------------------------- inspection */

select 'Verified trail volume by table' as summary,
       table_name,
       count(*)          as entries,
       min(occurred_at)  as first_entry,
       max(occurred_at)  as last_entry
from public.audit_log
group by table_name
order by count(*) desc;

select 'Legacy imported history' as summary,
       count(*)                                   as rows_imported,
       count(*) filter (where import_payload is not null) as with_provenance_stamp,
       min(timestamp_value)                       as earliest,
       max(timestamp_value)                       as latest
from public.legacy_audit_history;

select 'Who has imported legacy history' as summary,
       actor_name, actor_email, occurred_at,
       changes -> 0 ->> 'after' as detail
from public.audit_log
where table_name = 'legacy_audit_history'
  and record_key = 'GLOBAL / legacy-import'
order by occurred_at desc;

/* ---------------------------------------------- Stage 9 shape safety net

   Added in Stage 11F after discovering that legacy_audit_history did not have the
   shape Stage 9 defines. The cause is structural, not a one-off: Stage 9 creates
   tables with `create table if not exists`, so if any earlier draft had already
   created a table of that name, Stage 9 skipped it and left the earlier shape.

   On a table holding rows this surfaces quickly, because an INSERT naming a missing
   column fails. On an EMPTY table it is invisible — the parity check only diffs
   records present on both sides, so zero rows means zero comparisons, and
   compare() happily reports IDENTICAL against a table of the wrong shape.

   This checks every column Stage 9 defines across all 18 child tables.
*/
with expected(tbl, col) as (
    values
        ('financial_approval_requests','id'),
        ('financial_approval_requests','project_id'),
        ('financial_approval_requests','project_code'),
        ('financial_approval_requests','record_key'),
        ('financial_approval_requests','request_type'),
        ('financial_approval_requests','current_approved_budget'),
        ('financial_approval_requests','proposed_budget'),
        ('financial_approval_requests','change_amount'),
        ('financial_approval_requests','change_percentage'),
        ('financial_approval_requests','reason'),
        ('financial_approval_requests','requester_resource_id'),
        ('financial_approval_requests','requester_name'),
        ('financial_approval_requests','requester_email'),
        ('financial_approval_requests','approver_resource_id'),
        ('financial_approval_requests','approver_name'),
        ('financial_approval_requests','approver_email'),
        ('financial_approval_requests','status'),
        ('financial_approval_requests','requested_at'),
        ('financial_approval_requests','decision_at'),
        ('financial_approval_requests','decision_by_resource_id'),
        ('financial_approval_requests','decision_by_name'),
        ('financial_approval_requests','decision_comments'),
        ('financial_approval_requests','budget_snapshot'),
        ('financial_approval_requests','legacy_payload'),
        ('financial_approval_requests','import_payload'),
        ('financial_approval_requests','version'),
        ('financial_approval_requests','created_at'),
        ('financial_approval_requests','updated_at'),
        ('financial_entries','id'),
        ('financial_entries','project_id'),
        ('financial_entries','project_code'),
        ('financial_entries','record_key'),
        ('financial_entries','category_id'),
        ('financial_entries','category_name'),
        ('financial_entries','description'),
        ('financial_entries','financial_period'),
        ('financial_entries','budget_amount'),
        ('financial_entries','forecast_cost'),
        ('financial_entries','actual_cost'),
        ('financial_entries','committed_cost'),
        ('financial_entries','remaining_forecast'),
        ('financial_entries','notes'),
        ('financial_entries','legacy_payload'),
        ('financial_entries','import_payload'),
        ('financial_entries','version'),
        ('financial_entries','created_at'),
        ('financial_entries','updated_at'),
        ('legacy_audit_history','id'),
        ('legacy_audit_history','project_id'),
        ('legacy_audit_history','project_code'),
        ('legacy_audit_history','record_key'),
        ('legacy_audit_history','timestamp_value'),
        ('legacy_audit_history','entity_type'),
        ('legacy_audit_history','entity_id'),
        ('legacy_audit_history','action'),
        ('legacy_audit_history','summary'),
        ('legacy_audit_history','source_page'),
        ('legacy_audit_history','actor_name'),
        ('legacy_audit_history','actor_resource_id'),
        ('legacy_audit_history','actor_email'),
        ('legacy_audit_history','actor_role'),
        ('legacy_audit_history','status_from'),
        ('legacy_audit_history','status_to'),
        ('legacy_audit_history','approval_status_from'),
        ('legacy_audit_history','approval_status_to'),
        ('legacy_audit_history','approval_id'),
        ('legacy_audit_history','changes'),
        ('legacy_audit_history','metadata'),
        ('legacy_audit_history','location'),
        ('legacy_audit_history','legacy_payload'),
        ('legacy_audit_history','import_payload'),
        ('legacy_audit_history','version'),
        ('legacy_audit_history','created_at'),
        ('legacy_audit_history','updated_at'),
        ('plan_baseline_requests','id'),
        ('plan_baseline_requests','project_id'),
        ('plan_baseline_requests','project_code'),
        ('plan_baseline_requests','record_key'),
        ('plan_baseline_requests','status'),
        ('plan_baseline_requests','existing_baseline'),
        ('plan_baseline_requests','proposed_baseline'),
        ('plan_baseline_requests','reason'),
        ('plan_baseline_requests','impact'),
        ('plan_baseline_requests','requested_by'),
        ('plan_baseline_requests','requested_by_resource_id'),
        ('plan_baseline_requests','legacy_payload'),
        ('plan_baseline_requests','import_payload'),
        ('plan_baseline_requests','version'),
        ('plan_baseline_requests','created_at'),
        ('plan_baseline_requests','updated_at'),
        ('plan_baselines','id'),
        ('plan_baselines','project_id'),
        ('plan_baselines','project_code'),
        ('plan_baselines','record_key'),
        ('plan_baselines','record_version'),
        ('plan_baselines','status'),
        ('plan_baselines','reason'),
        ('plan_baselines','impact'),
        ('plan_baselines','approved_by'),
        ('plan_baselines','approved_by_resource_id'),
        ('plan_baselines','approval_date'),
        ('plan_baselines','approved_at'),
        ('plan_baselines','task_baselines'),
        ('plan_baselines','legacy_payload'),
        ('plan_baselines','import_payload'),
        ('plan_baselines','version'),
        ('plan_baselines','created_at'),
        ('plan_baselines','updated_at'),
        ('project_actions','id'),
        ('project_actions','project_id'),
        ('project_actions','project_code'),
        ('project_actions','record_key'),
        ('project_actions','legacy_payload'),
        ('project_actions','import_payload'),
        ('project_actions','version'),
        ('project_actions','created_at'),
        ('project_actions','updated_at'),
        ('project_benefits','id'),
        ('project_benefits','project_id'),
        ('project_benefits','project_code'),
        ('project_benefits','record_key'),
        ('project_benefits','legacy_payload'),
        ('project_benefits','import_payload'),
        ('project_benefits','version'),
        ('project_benefits','created_at'),
        ('project_benefits','updated_at'),
        ('project_decisions','id'),
        ('project_decisions','project_id'),
        ('project_decisions','project_code'),
        ('project_decisions','record_key'),
        ('project_decisions','status'),
        ('project_decisions','decision_owner'),
        ('project_decisions','decision_owner_resource_id'),
        ('project_decisions','decision_owner_email'),
        ('project_decisions','recommendation'),
        ('project_decisions','options_considered'),
        ('project_decisions','background'),
        ('project_decisions','decision_required'),
        ('project_decisions','required_by_date'),
        ('project_decisions','legacy_payload'),
        ('project_decisions','import_payload'),
        ('project_decisions','version'),
        ('project_decisions','created_at'),
        ('project_decisions','updated_at'),
        ('project_documents','id'),
        ('project_documents','project_id'),
        ('project_documents','project_code'),
        ('project_documents','record_key'),
        ('project_documents','legacy_payload'),
        ('project_documents','import_payload'),
        ('project_documents','version'),
        ('project_documents','created_at'),
        ('project_documents','updated_at'),
        ('project_financials','id'),
        ('project_financials','project_id'),
        ('project_financials','project_code'),
        ('project_financials','record_key'),
        ('project_financials','proposed_budget'),
        ('project_financials','approved_budget'),
        ('project_financials','forecast_cost'),
        ('project_financials','actual_cost'),
        ('project_financials','committed_cost'),
        ('project_financials','remaining_forecast'),
        ('project_financials','contingency'),
        ('project_financials','estimate_at_completion'),
        ('project_financials','budget_variance'),
        ('project_financials','budget_variance_percentage'),
        ('project_financials','budget_variance_percentage_available'),
        ('project_financials','currency'),
        ('project_financials','funding_source'),
        ('project_financials','financial_owner'),
        ('project_financials','financial_owner_resource_id'),
        ('project_financials','financial_owner_email'),
        ('project_financials','financial_commentary'),
        ('project_financials','financial_rag'),
        ('project_financials','budget_approval_status'),
        ('project_financials','approved_budget_version'),
        ('project_financials','last_financial_update_date'),
        ('project_financials','approved_budget_request_id'),
        ('project_financials','approved_at'),
        ('project_financials','approved_by_resource_id'),
        ('project_financials','approved_by'),
        ('project_financials','legacy_payload'),
        ('project_financials','import_payload'),
        ('project_financials','version'),
        ('project_financials','created_at'),
        ('project_financials','updated_at'),
        ('project_milestones','id'),
        ('project_milestones','project_id'),
        ('project_milestones','project_code'),
        ('project_milestones','record_key'),
        ('project_milestones','milestone_name'),
        ('project_milestones','milestone_type'),
        ('project_milestones','percentage_complete'),
        ('project_milestones','baseline_start_date'),
        ('project_milestones','baseline_finish_date'),
        ('project_milestones','forecast_start_date'),
        ('project_milestones','forecast_finish_date'),
        ('project_milestones','notes'),
        ('project_milestones','status'),
        ('project_milestones','status_updated_at'),
        ('project_milestones','legacy_payload'),
        ('project_milestones','import_payload'),
        ('project_milestones','version'),
        ('project_milestones','created_at'),
        ('project_milestones','updated_at'),
        ('project_plans','id'),
        ('project_plans','project_id'),
        ('project_plans','project_code'),
        ('project_plans','record_key'),
        ('project_plans','phase'),
        ('project_plans','task_name'),
        ('project_plans','task_owner'),
        ('project_plans','task_owner_resource_id'),
        ('project_plans','task_owner_email'),
        ('project_plans','duration_days'),
        ('project_plans','allocation_percentage'),
        ('project_plans','baseline_start_date'),
        ('project_plans','baseline_end_date'),
        ('project_plans','forecast_start_date'),
        ('project_plans','forecast_end_date'),
        ('project_plans','status'),
        ('project_plans','percentage_complete'),
        ('project_plans','reason_for_slippage'),
        ('project_plans','return_to_green'),
        ('project_plans','notes'),
        ('project_plans','task_type'),
        ('project_plans','parent_task_id'),
        ('project_plans','deliverable'),
        ('project_plans','supporting_contributor_ids'),
        ('project_plans','priority'),
        ('project_plans','actual_start_date'),
        ('project_plans','actual_end_date'),
        ('project_plans','estimated_effort_hours'),
        ('project_plans','remaining_effort_hours'),
        ('project_plans','dependencies'),
        ('project_plans','critical_path'),
        ('project_plans','slippage_impact'),
        ('project_plans','recovery_not_possible'),
        ('project_plans','mandatory'),
        ('project_plans','legacy_payload'),
        ('project_plans','import_payload'),
        ('project_plans','version'),
        ('project_plans','created_at'),
        ('project_plans','updated_at'),
        ('project_raid','id'),
        ('project_raid','project_id'),
        ('project_raid','project_code'),
        ('project_raid','record_key'),
        ('project_raid','type'),
        ('project_raid','title'),
        ('project_raid','status'),
        ('project_raid','description'),
        ('project_raid','owner'),
        ('project_raid','raised_by'),
        ('project_raid','date_raised'),
        ('project_raid','target_date'),
        ('project_raid','priority'),
        ('project_raid','escalation_status'),
        ('project_raid','last_reviewed_date'),
        ('project_raid','related_tasks'),
        ('project_raid','related_actions'),
        ('project_raid','attachments'),
        ('project_raid','comments'),
        ('project_raid','date_closed'),
        ('project_raid','closure_evidence'),
        ('project_raid','risk_cause'),
        ('project_raid','risk_event'),
        ('project_raid','risk_effect'),
        ('project_raid','inherent_probability'),
        ('project_raid','inherent_impact'),
        ('project_raid','inherent_score'),
        ('project_raid','mitigation'),
        ('project_raid','contingency'),
        ('project_raid','residual_probability'),
        ('project_raid','residual_impact'),
        ('project_raid','residual_score'),
        ('project_raid','risk_appetite_position'),
        ('project_raid','escalation_threshold'),
        ('project_raid','risk_trend'),
        ('project_raid','review_frequency'),
        ('project_raid','date_identified'),
        ('project_raid','business_impact'),
        ('project_raid','delivery_impact'),
        ('project_raid','root_cause'),
        ('project_raid','resolution_plan'),
        ('project_raid','resolution_owner'),
        ('project_raid','expected_resolution_date'),
        ('project_raid','actual_resolution_date'),
        ('project_raid','workaround'),
        ('project_raid','decision_required'),
        ('project_raid','dependency_scope'),
        ('project_raid','dependency_direction'),
        ('project_raid','provider'),
        ('project_raid','recipient'),
        ('project_raid','required_by_date'),
        ('project_raid','dependency_confidence'),
        ('project_raid','impact_if_missed'),
        ('project_raid','related_project'),
        ('project_raid','related_milestone'),
        ('project_raid','acceptance_criteria'),
        ('project_raid','audit_history'),
        ('project_raid','legacy_payload'),
        ('project_raid','import_payload'),
        ('project_raid','version'),
        ('project_raid','created_at'),
        ('project_raid','updated_at'),
        ('rag_history','id'),
        ('rag_history','project_id'),
        ('rag_history','project_code'),
        ('rag_history','record_key'),
        ('rag_history','legacy_payload'),
        ('rag_history','import_payload'),
        ('rag_history','version'),
        ('rag_history','created_at'),
        ('rag_history','updated_at'),
        ('resource_demand','id'),
        ('resource_demand','project_id'),
        ('resource_demand','project_code'),
        ('resource_demand','record_key'),
        ('resource_demand','legacy_payload'),
        ('resource_demand','import_payload'),
        ('resource_demand','version'),
        ('resource_demand','created_at'),
        ('resource_demand','updated_at'),
        ('resource_scenarios','id'),
        ('resource_scenarios','project_id'),
        ('resource_scenarios','project_code'),
        ('resource_scenarios','record_key'),
        ('resource_scenarios','legacy_payload'),
        ('resource_scenarios','import_payload'),
        ('resource_scenarios','version'),
        ('resource_scenarios','created_at'),
        ('resource_scenarios','updated_at'),
        ('stage_gates','id'),
        ('stage_gates','project_id'),
        ('stage_gates','project_code'),
        ('stage_gates','record_key'),
        ('stage_gates','legacy_payload'),
        ('stage_gates','import_payload'),
        ('stage_gates','version'),
        ('stage_gates','created_at'),
        ('stage_gates','updated_at'),
        ('status_reports','id'),
        ('status_reports','project_id'),
        ('status_reports','project_code'),
        ('status_reports','record_key'),
        ('status_reports','legacy_payload'),
        ('status_reports','import_payload'),
        ('status_reports','version'),
        ('status_reports','created_at'),
        ('status_reports','updated_at')
)
select 'Every Stage 9 child column exists' as check,
       case when count(*) = 0 then 'PASS'
            else 'FAIL: missing ' || string_agg(tbl || '.' || col, ', ' order by tbl, col)
       end as result
from expected e
where not exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = e.tbl
       and c.column_name = e.col
);
