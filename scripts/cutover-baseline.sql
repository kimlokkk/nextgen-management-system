-- Read-only, aggregate-only cutover evidence. Never exports student identities.
-- It intentionally fails if staging migrations/data are incomplete.
select jsonb_pretty(jsonb_build_object(
 'students', (select count(*) from public.students),
 'parents', (select count(*) from public.parents),
 'active_enrollments', (select count(*) from public.enrollments where status='active'),
 'september_source_rows', (select count(*) from public.legacy_september_evidence where source_batch='mtdc-2026-09'),
 'october_source_rows', (select count(*) from public.legacy_replacement_reviews where source_batch='mtdc-2026-10'),
 'october_capacity_sessions', (
   select count(*) from (
     select s.id from public.class_sessions s
     join public.branches br on br.id=s.branch_id
     left join public.legacy_replacement_reviews l
       on l.target_class_id=s.id and l.source_batch='mtdc-2026-10' and l.review_state<>'excluded'
     where (lower(br.name) like '%mtdc%' or lower(coalesce(br.code,''))='mtdc')
       and s.class_date>='2026-10-01' and s.class_date<'2026-11-01'
     group by s.id,s.replacement_capacity
     having count(l.id) > s.replacement_capacity
   ) overfull
 ),
 'november_batches', (
    select count(*) from public.schedule_batches b
    join public.branches br on br.id=b.branch_id
    where (lower(br.name) like '%mtdc%' or lower(coalesce(br.code,''))='mtdc')
      and b.schedule_month='2026-11-01'
 ),
 'november_classes', (
    select count(*) from public.class_sessions s
    join public.schedule_batches b on b.id=s.schedule_batch_id
    join public.branches br on br.id=b.branch_id
    where (lower(br.name) like '%mtdc%' or lower(coalesce(br.code,''))='mtdc')
      and b.schedule_month='2026-11-01'
 ),
 'november_bookings', (
    select count(*) from public.student_bookings bk
    join public.class_sessions s on s.id=bk.class_session_id
    join public.schedule_batches b on b.id=s.schedule_batch_id
    join public.branches br on br.id=b.branch_id
    where (lower(br.name) like '%mtdc%' or lower(coalesce(br.code,''))='mtdc')
      and b.schedule_month='2026-11-01'
 ),
 'atomic_rpc_present',
    to_regprocedure('public.generate_monthly_schedule_atomic(uuid,date)') is not null
))::text;
