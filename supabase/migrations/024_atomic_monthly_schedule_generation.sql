-- Atomic schedule generation. Local staging only until release review.
-- One RPC = one Postgres transaction, including batch, sessions, bookings.
-- SECURITY INVOKER keeps existing table RLS in force. No deletion or regeneration.
create function public.generate_monthly_schedule_atomic(
  p_branch_id uuid,
  p_schedule_month date
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $atomic$
declare
  v_actor uuid := auth.uid();
  v_batch uuid;
  v_template public.session_templates%rowtype;
  v_original date;
  v_actual date;
  v_target date;
  v_month_end date;
  v_decision text;
  v_destination_decision text;
  v_week integer;
  v_template_count integer := 0;
  v_class_count integer := 0;
  v_student_count integer;
  v_saved_count integer;
  v_class_id uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id=v_actor and p.is_active=true
      and p.role in ('admin','super_admin')
  ) then
    raise exception 'Only active admins can generate schedules';
  end if;
  if p_branch_id is null or p_schedule_month is null
     or p_schedule_month <> date_trunc('month',p_schedule_month::timestamp)::date then
    raise exception 'Schedule month must be its first calendar day';
  end if;

  -- One generation per branch at a time. The unique(branch_id,schedule_month)
  -- constraint remains the final guard against concurrent direct writers.
  perform 1 from public.branches b
  where b.id=p_branch_id and b.is_active=true
  for update;
  if not found then raise exception 'Branch missing or inactive'; end if;

  if exists (
    select 1 from public.schedule_batches b
    where b.branch_id=p_branch_id and b.schedule_month=p_schedule_month
  ) then
    raise exception 'Schedule already exists for this branch/month; regeneration is disabled';
  end if;

  -- Hold locks on existing enrollment and student/template/calendar records;
  -- no admin should edit planning inputs concurrently with generation.
  perform 1 from public.enrollments e
  where e.branch_id=p_branch_id and e.status='active'
  for share;
  if not found then raise exception 'No active enrollments found for branch'; end if;

  perform 1 from public.session_templates t
  where t.branch_id=p_branch_id and t.is_active=true
  for share;
  if not found then raise exception 'No active session templates found for branch'; end if;

  perform 1 from public.academic_calendar_exceptions c
  where c.branch_id=p_branch_id
    and c.closed_on >= p_schedule_month
    and c.closed_on < (p_schedule_month + interval '1 month')::date
  for share;

  if exists(
    select 1 from public.enrollments e
    left join public.students s on s.id=e.student_id
    left join public.session_templates t on t.id=e.default_session_id
    where e.branch_id=p_branch_id and e.status='active'
      and (s.id is null or s.status<>'active'
        or t.id is null or not t.is_active or t.branch_id<>e.branch_id
        or t.programme_id<>e.programme_id)
  ) then
    raise exception 'Active enrollment has an inactive student or invalid session template';
  end if;

  if exists(
    select 1 from public.enrollments e
    where e.branch_id=p_branch_id and e.status='active'
      and e.frequency_type<>'weekly'
      and not (coalesce(e.preferred_weeks,array[]::smallint[])
               && array[1,2,3,4]::smallint[])
  ) then
    raise exception 'Active non-weekly enrollment has no W1-W4 teaching weeks';
  end if;

  v_month_end := (p_schedule_month + interval '1 month' - interval '1 day')::date;
  insert into public.schedule_batches(
    branch_id,schedule_month,status,generated_by
  ) values (p_branch_id,p_schedule_month,'draft',v_actor)
  returning id into v_batch;

  for v_template in
    select * from public.session_templates t
    where t.branch_id=p_branch_id and t.is_active=true
    order by t.id
  loop
    v_template_count := v_template_count + 1;
    v_week := 0;
    for v_original in
      select d::date from generate_series(
        p_schedule_month::timestamp,
        v_month_end::timestamp,
        interval '1 day'
      ) d
      where extract(dow from d)=v_template.day_of_week
      order by d
    loop
      v_week := v_week + 1;
      exit when v_week > 4;
      v_actual := v_original;

      select c.decision,c.target_on into v_decision,v_target
      from public.academic_calendar_exceptions c
      where c.branch_id=p_branch_id and c.closed_on=v_original;

      if v_decision='pending' then
        raise exception 'Academic Calendar decision pending for %',v_original;
      end if;
      if v_decision='skip' then continue; end if;
      if v_decision='move' then
        if v_target is null or v_target<=v_original
           or v_target<p_schedule_month or v_target>v_month_end
           or extract(dow from v_target)<>v_template.day_of_week then
          raise exception 'Invalid calendar move from % to %',v_original,v_target;
        end if;
        select c.decision into v_destination_decision
        from public.academic_calendar_exceptions c
        where c.branch_id=p_branch_id and c.closed_on=v_target;
        if v_destination_decision is not null
           and v_destination_decision<>'withdrawn' then
          raise exception 'Move destination % already has calendar event',v_target;
        end if;
        v_actual := v_target;
      end if;

      if exists (
        select 1 from public.class_sessions c
        where c.schedule_batch_id=v_batch and c.session_template_id=v_template.id
          and c.class_date=v_actual
      ) then
        raise exception 'Duplicate class date after calendar move: %',v_actual;
      end if;

      insert into public.class_sessions(
        schedule_batch_id,session_template_id,branch_id,programme_id,
        class_date,week_number,start_time,end_time,
        regular_capacity,replacement_capacity,status
      ) values (
        v_batch,v_template.id,p_branch_id,v_template.programme_id,
        v_actual,v_week,v_template.start_time,v_template.end_time,
        v_template.regular_capacity,v_template.replacement_capacity,'scheduled'
      ) returning id into v_class_id;
      v_class_count := v_class_count + 1;

      if exists (
        select 1 from public.enrollments e
        where e.branch_id=p_branch_id and e.status='active'
          and e.default_session_id=v_template.id
          and e.start_date<=v_actual
          and (e.end_date is null or e.end_date>=v_actual)
          and (e.frequency_type='weekly'
            or coalesce(e.preferred_weeks,array[]::smallint[]) @> array[v_week::smallint])
        group by e.student_id
        having count(*)>1
      ) then
        raise exception 'Same student assigned twice to %',v_actual;
      end if;

      select count(*) into v_student_count
      from public.enrollments e
      where e.branch_id=p_branch_id and e.status='active'
        and e.default_session_id=v_template.id
        and e.start_date<=v_actual
        and (e.end_date is null or e.end_date>=v_actual)
        and (e.frequency_type='weekly'
          or coalesce(e.preferred_weeks,array[]::smallint[]) @> array[v_week::smallint]);
      if v_student_count>v_template.regular_capacity then
        raise exception 'Regular class capacity exceeded on %: %/%',
          v_actual,v_student_count,v_template.regular_capacity;
      end if;

      insert into public.student_bookings(
        class_session_id,student_id,enrollment_id,booking_type,attendance_status
      )
      select v_class_id,e.student_id,e.id,'regular','upcoming'
      from public.enrollments e
      where e.branch_id=p_branch_id and e.status='active'
        and e.default_session_id=v_template.id
        and e.start_date<=v_actual
        and (e.end_date is null or e.end_date>=v_actual)
        and (e.frequency_type='weekly'
          or coalesce(e.preferred_weeks,array[]::smallint[]) @> array[v_week::smallint]);
      get diagnostics v_saved_count = row_count;
      if v_saved_count<>v_student_count then
        raise exception 'Concurrent enrollment change detected; draft rolled back';
      end if;
    end loop;
  end loop;

  if v_template_count=0 or v_class_count=0 then
    raise exception 'No class sessions generated for this month';
  end if;
  return v_batch;
  -- Any exception aborts this entire function call/transaction. There is no
  -- exception handler that could accidentally commit partial records.
end;
$atomic$;

revoke all on function public.generate_monthly_schedule_atomic(uuid,date)
from public,anon,authenticated;
grant execute on function public.generate_monthly_schedule_atomic(uuid,date)
to authenticated;

comment on function public.generate_monthly_schedule_atomic(uuid,date) is
'Admin-only, security-invoker atomic monthly schedule generation. No overwrites. All statements roll back on any error.';
