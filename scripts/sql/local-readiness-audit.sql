-- NextGen LOCAL readiness audit: READ-ONLY and AGGREGATE-ONLY.
--
-- * Only SELECT statements. The wrapper (scripts/audit-local-readiness.py) also wraps this
--   file in BEGIN READ ONLY ... ROLLBACK and refuses any non-localhost database.
-- * Output rows contain counts, dates/times, capacities, class/branch codes and md5
--   fingerprints. It NEVER outputs student, parent or guardian names, phones, emails or notes.
-- * status: PASS | FAIL | WARN | INFO | PENDING | UNKNOWN
--     FAIL    = an invariant is violated or a checkpoint differs. Explain it; never hide it.
--     WARN    = needs a human decision / source comparison.
--     PENDING = code on this branch needs a migration not yet applied to this database.
--     UNKNOWN = cannot be decided from the database alone.
-- * Checkpoints come from docs/production-readiness-plan-2026-10-27.md. They are historical
--   snapshots, NOT guarantees about today's data.
with
tz as (select (now() at time zone 'Asia/Kuala_Lumpur') as now_my),
mtdc as (select id from public.branches where lower(name) like '%mtdc%' or lower(coalesce(code, '')) = 'mtdc'),
cyb  as (select id from public.branches where lower(name) like '%cyberjaya%' or lower(coalesce(code, '')) = 'cyberjaya'),
act_students as (select id from public.students where status = 'active'),
act_enr as (select e.* from public.enrollments e where e.status = 'active'),
dup_student_names as (
    select regexp_replace(lower(btrim(full_name)), '\s+', ' ', 'g') as k, count(*) n
    from public.students group by 1 having count(*) > 1),
dup_student_dob as (
    select regexp_replace(lower(btrim(full_name)), '\s+', ' ', 'g') as k, date_of_birth, count(*) n
    from public.students where date_of_birth is not null group by 1, 2 having count(*) > 1),
parent_phones as (
    select regexp_replace(coalesce(nullif(phone, ''), nullif(whatsapp_phone, '')), '\D', '', 'g') as k, id
    from public.parents where coalesce(nullif(phone, ''), nullif(whatsapp_phone, '')) is not null),
dup_parent_phone as (select k, count(*) n from parent_phones where k <> '' group by k having count(*) > 1),
dup_parent_email as (
    select lower(btrim(email)) k, count(*) n from public.parents
    where nullif(btrim(email), '') is not null group by 1 having count(*) > 1),
cls as (
    select c.*, sb.schedule_month, sb.status as batch_status
    from public.class_sessions c join public.schedule_batches sb on sb.id = c.schedule_batch_id),
reg_occ as (
    select c.id, c.class_date, c.start_time, c.regular_capacity as cap, c.schedule_month, c.branch_id,
           count(b.id) filter (where b.booking_type in ('regular', 'reschedule')
                               and b.attendance_status not in ('rescheduled', 'cancelled', 'not_scheduled')) as used
    from cls c left join public.student_bookings b on b.class_session_id = c.id
    group by c.id, c.class_date, c.start_time, c.regular_capacity, c.schedule_month, c.branch_id),
oct_cls as (select * from cls where branch_id in (select id from mtdc) and class_date >= date '2026-10-01' and class_date < date '2026-11-01'),
yellow as (
    select c.id, c.class_date, c.start_time, c.replacement_capacity as cap,
           (select count(*) from public.student_bookings b
             where b.class_session_id = c.id and b.booking_type = 'replacement'
               and b.attendance_status not in ('cancelled', 'not_scheduled'))
           + public.legacy_reserved_yellow_seats(c.id) as used
    from oct_cls c),
nov_cls as (select * from cls where branch_id in (select id from mtdc) and schedule_month = date '2026-11-01'),
nov_bk as (
    select b.*, c.branch_id as c_branch, c.session_template_id as c_tpl
    from public.student_bookings b join nov_cls c on c.id = b.class_session_id),
oct_bk as (select b.* from public.student_bookings b join oct_cls c on c.id = b.class_session_id),
sep_ev as (select * from public.legacy_september_evidence where source_batch = 'mtdc-2026-09'),
oct_rev as (select * from public.legacy_replacement_reviews where source_batch = 'mtdc-2026-10'),
cal_nov as (
    select * from public.academic_calendar_exceptions
    where closed_on >= date '2026-11-01' and closed_on < date '2026-12-01'),
rows_ as (
-- =================== A. Database, security, migration state ===================
select 'A'::text sec, 'A01'::text id, 'public tables present'::text title,
       case when (select count(*) from pg_tables where schemaname = 'public') = 21 then 'PASS' else 'WARN' end status,
       (select count(*) from pg_tables where schemaname = 'public')::text actual, '21'::text expected,
       'Migrations 001-027 define 21 public tables.'::text note
union all
select 'A', 'A02', 'tables WITHOUT row level security',
       case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) = 0 then 'PASS' else 'FAIL' end,
       coalesce((select string_agg(c.relname, ', ' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'none'),
       'none', 'Every public table must have RLS enabled.'
union all
select 'A', 'A03', 'authenticated can UPDATE profiles.role (self-escalation)',
       case when has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') then 'FAIL' else 'PASS' end,
       case when has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') then 'yes' else 'no' end, 'no',
       'FAIL = any signed-in user could make themselves super_admin. Fixed by migration 026.'
union all
select 'A', 'A04', 'authenticated can UPDATE profiles.is_active',
       case when has_column_privilege('authenticated', 'public.profiles', 'is_active', 'UPDATE') then 'FAIL' else 'PASS' end,
       case when has_column_privilege('authenticated', 'public.profiles', 'is_active', 'UPDATE') then 'yes' else 'no' end, 'no',
       'Fixed by migration 026.'
union all
select 'A', 'A05', 'RPCs from migrations 011-024 present (by name)',
       case when cardinality(m) = 0 then 'PASS' else 'FAIL' end,
       case when cardinality(m) = 0 then 'all present' else array_to_string(m, ', ') end, 'all present',
       'A missing function means a migration was not applied to this database.'
from (select array(select f from unnest(array[
        'initiate_replacement_obligation', 'assign_replacement_obligation', 'change_replacement_slot',
        'cancel_replacement', 'complete_replacement', 'record_class_attendance',
        'legacy_reserved_yellow_seats', 'adjust_class_replacement_capacity', 'decide_class_replacement_capacity',
        'record_legacy_replacement_review', 'record_legacy_reconciliation_decision',
        'resolve_missing_student_guardian', 'generate_monthly_schedule_atomic']) f
        where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = f)) as m) x
union all
select 'A', 'A06', 'migrations 025-027 applied (atomic reschedule + profile protection)',
       case when cardinality(m) = 0 then 'PASS' else 'PENDING' end,
       case when cardinality(m) = 0 then 'applied' else 'missing: ' || array_to_string(m, ', ') end, 'applied',
       'App code on this branch calls these RPCs. Apply to LOCAL only after reviewing the migrations.'
from (select array(select f from unnest(array[
        'initiate_reschedule_obligation', 'assign_reschedule_slot',
        'reopen_reschedule_assignment', 'cancel_reschedule', 'guard_profile_privileged_columns']) f
        where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = f)) as m) x
union all
select 'A', 'A07', 'SECURITY DEFINER functions executable by anon',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(p.proname, ', ' order by p.proname), 'none'), 'none',
       'anon must never execute privileged RPCs.'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
  and has_function_privilege('anon', p.oid, 'EXECUTE')
union all
select 'A', 'A08', 'active admin / super_admin accounts',
       case when (select count(*) from public.profiles where is_active and role in ('admin', 'super_admin')) >= 1 then 'INFO' else 'FAIL' end,
       (select count(*) from public.profiles where is_active and role in ('admin', 'super_admin'))::text, '>= 1',
       coalesce((select string_agg(role || '=' || n, ', ' order by role) from
                 (select role, count(*) n from public.profiles where is_active group by role) r), 'no profiles')
union all
select 'A', 'A09', 'auth users without a profile row',
       case when (select count(*) from auth.users u left join public.profiles p on p.id = u.id where p.id is null) = 0 then 'PASS' else 'FAIL' end,
       (select count(*) from auth.users u left join public.profiles p on p.id = u.id where p.id is null)::text, '0',
       'handle_new_user should create a profile for every user.'
union all
select 'A', 'A10', 'Auth hardening (open signup, leaked-password protection, admin MFA)',
       'UNKNOWN', 'not visible from SQL', 'verify in the Supabase dashboard',
       'Local config.toml enables signup. The company project must be invite-only.'
-- =================== B. Directory completeness (counts only) ===================
union all
select 'B', 'B01', 'students (total / by status)', case when (select count(*) from public.students) = 0 then 'FAIL' else 'INFO' end, (select count(*) from public.students)::text, 'compare with signed-off sources',
       coalesce((select string_agg(status || '=' || n, ', ' order by status) from (select status, count(*) n from public.students group by status) s), 'none')
union all
select 'B', 'B02', 'parents (total)', case when (select count(*) from public.parents) = 0 then 'FAIL' else 'INFO' end, (select count(*) from public.parents)::text, 'compare with signed-off sources', ''
union all
select 'B', 'B03', 'active students with NO guardian link',
       case when (select count(*) from act_students s where not exists (select 1 from public.student_guardians g where g.student_id = s.id)) = 0 then 'PASS' else 'WARN' end,
       (select count(*) from act_students s where not exists (select 1 from public.student_guardians g where g.student_id = s.id))::text,
       '0 (each has a NO_GUARDIAN / NOT_IN_DIRECTORY notice for the admin)',
       'Resolve only via /readiness/guardians with independent evidence. Never guess a relationship.'
union all
select 'B', 'B04', 'students with more than one PRIMARY guardian',
       case when (select count(*) from (select student_id from public.student_guardians where is_primary group by student_id having count(*) > 1) x) = 0 then 'PASS' else 'FAIL' end,
       (select count(*) from (select student_id from public.student_guardians where is_primary group by student_id having count(*) > 1) x)::text, '0', ''
union all
select 'B', 'B05', 'students with guardians but no primary guardian',
       case when (select count(distinct g.student_id) from public.student_guardians g
                  where not exists (select 1 from public.student_guardians p where p.student_id = g.student_id and p.is_primary)) = 0 then 'PASS' else 'WARN' end,
       (select count(distinct g.student_id) from public.student_guardians g
        where not exists (select 1 from public.student_guardians p where p.student_id = g.student_id and p.is_primary))::text, '0', ''
union all
select 'B', 'B06', 'parents linked to no student',
       case when (select count(*) from public.parents p where not exists (select 1 from public.student_guardians g where g.parent_id = p.id)) = 0 then 'PASS' else 'WARN' end,
       (select count(*) from public.parents p where not exists (select 1 from public.student_guardians g where g.parent_id = p.id))::text, '0',
       'Orphan parents: leftover or incomplete import.'
union all
select 'B', 'B07', 'parents with no phone and no WhatsApp number',
       case when (select count(*) from public.parents where coalesce(nullif(btrim(phone), ''), nullif(btrim(whatsapp_phone), '')) is null) = 0 then 'PASS' else 'WARN' end,
       (select count(*) from public.parents where coalesce(nullif(btrim(phone), ''), nullif(btrim(whatsapp_phone), '')) is null)::text, '0',
       'Needed for the manual WhatsApp interim process.'
union all
select 'B', 'B08', 'active enrollments (total / by branch)', case when (select count(*) from act_enr) = 0 then 'FAIL' else 'INFO' end, (select count(*) from act_enr)::text, 'compare with signed-off sources',
       coalesce((select string_agg(coalesce(b.code, b.name) || '=' || n, ', ' order by coalesce(b.code, b.name))
                 from (select branch_id, count(*) n from act_enr group by branch_id) e join public.branches b on b.id = e.branch_id), 'none')
union all
select 'B', 'B09', 'DISTINCT students with an active enrollment (bookings are NOT students)', 'INFO',
       (select count(distinct student_id) from act_enr)::text, 'compare with signed-off sources', ''
union all
select 'B', 'B10', 'active students with no active enrollment',
       case when (select count(*) from act_students s where not exists (select 1 from act_enr e where e.student_id = s.id)) = 0 then 'PASS' else 'WARN' end,
       (select count(*) from act_students s where not exists (select 1 from act_enr e where e.student_id = s.id))::text, '0', ''
union all
select 'B', 'B11', 'active enrollments whose student is not active',
       case when (select count(*) from act_enr e join public.students s on s.id = e.student_id where s.status <> 'active') = 0 then 'PASS' else 'FAIL' end,
       (select count(*) from act_enr e join public.students s on s.id = e.student_id where s.status <> 'active')::text, '0', ''
union all
select 'B', 'B12', 'active enrollments with no default session',
       case when (select count(*) from act_enr where default_session_id is null) = 0 then 'PASS' else 'WARN' end,
       (select count(*) from act_enr where default_session_id is null)::text, '0', 'Cannot be scheduled without a default session.'
union all
select 'B', 'B13', 'active enrollments whose default session is in another branch/programme',
       case when (select count(*) from act_enr e join public.session_templates t on t.id = e.default_session_id
                  where t.branch_id <> e.branch_id or t.programme_id <> e.programme_id) = 0 then 'PASS' else 'FAIL' end,
       (select count(*) from act_enr e join public.session_templates t on t.id = e.default_session_id
        where t.branch_id <> e.branch_id or t.programme_id <> e.programme_id)::text, '0', ''
union all
select 'B', 'B14', 'students sharing a name (groups / rows) - duplicate CANDIDATES',
       case when (select count(*) from dup_student_names) = 0 then 'PASS' else 'WARN' end,
       (select count(*) from dup_student_names)::text || ' groups / ' || coalesce((select sum(n) from dup_student_names), 0)::text || ' rows', '0',
       'Siblings or twins can share names. Merge only with independent evidence, never by name.'
union all
select 'B', 'B15', 'students sharing name AND date of birth (strong duplicate candidates)',
       case when (select count(*) from dup_student_dob) = 0 then 'PASS' else 'FAIL' end,
       (select count(*) from dup_student_dob)::text, '0', ''
union all
select 'B', 'B16', 'parents sharing a phone number (groups)',
       case when (select count(*) from dup_parent_phone) = 0 then 'PASS' else 'WARN' end,
       (select count(*) from dup_parent_phone)::text, '0', 'May be legitimate (two parents, one number). Review manually.'
union all
select 'B', 'B17', 'parents sharing an email (groups)',
       case when (select count(*) from dup_parent_email) = 0 then 'PASS' else 'WARN' end,
       (select count(*) from dup_parent_email)::text, '0', ''
union all
select 'B', 'B18', 'source-verified status of directory records', 'UNKNOWN', 'no verified flag in the schema',
       'compare with the signed-off MTDC / Cyberjaya source sheets',
       'The database cannot prove records match the source. Compare counts and a sample against the sheets.'
union all
select 'B', 'B19', 'Cyberjaya coverage (active enrollments / active templates / schedule batches)', 'INFO',
       (select count(*) from act_enr where branch_id in (select id from cyb))::text || ' / ' ||
       (select count(*) from public.session_templates where is_active and branch_id in (select id from cyb))::text || ' / ' ||
       (select count(*) from public.schedule_batches where branch_id in (select id from cyb))::text,
       'compare with the Cyberjaya source sheet',
       'Audited independently of MTDC. Completeness is UNKNOWN until compared with its source.'
union all
select 'B', 'B20', 'MTDC branch and Cyberjaya branch rows found',
       case when (select count(*) from mtdc) = 1 and (select count(*) from cyb) = 1 then 'PASS' else 'FAIL' end,
       (select count(*) from mtdc)::text || ' / ' || (select count(*) from cyb)::text, '1 / 1',
       'If 0, the branch name/code did not match; all MTDC/Cyberjaya checks below are then invalid.'
-- =================== C. Historical records and November draft ===================
union all
select 'C', 'C01', 'September evidence rows (total)',
       case when (select count(*) from sep_ev) = 622 then 'PASS' else 'FAIL' end,
       (select count(*) from sep_ev)::text, '622', 'Checkpoint = 492 regular roster + 130 legacy replacement.'
union all
select 'C', 'C02', 'September evidence: regular roster / legacy replacement',
       case when (select count(*) from sep_ev where evidence_kind = 'regular_roster') = 492
             and (select count(*) from sep_ev where evidence_kind = 'legacy_replacement') = 130 then 'PASS' else 'FAIL' end,
       (select count(*) from sep_ev where evidence_kind = 'regular_roster')::text || ' / ' || (select count(*) from sep_ev where evidence_kind = 'legacy_replacement')::text,
       '492 / 130', 'Roster presence and module text are not attendance.'
union all
select 'C', 'C03', 'October MTDC regular sessions',
       case when (select count(*) from oct_cls) = 48 then 'PASS' else 'FAIL' end, (select count(*) from oct_cls)::text, '48', ''
union all
select 'C', 'C04', 'October MTDC regular bookings',
       case when (select count(*) from oct_bk where booking_type = 'regular') = (select coalesce(sum(case when e.frequency_type = 'weekly' then 4 else cardinality(e.preferred_weeks) end), 0) from public.enrollments e join public.branches b on b.id = e.branch_id where e.status = 'active' and (lower(b.name) like '%mtdc%' or lower(coalesce(b.code, '')) = 'mtdc')) then 'PASS' else 'WARN' end,
       (select count(*) from oct_bk where booking_type = 'regular')::text, (select coalesce(sum(case when e.frequency_type = 'weekly' then 4 else cardinality(e.preferred_weeks) end), 0) from public.enrollments e join public.branches b on b.id = e.branch_id where e.status = 'active' and (lower(b.name) like '%mtdc%' or lower(coalesce(b.code, '')) = 'mtdc'))::text,
       'Expected = 4 per active weekly enrollment + preferred weeks per twice-monthly one. WARN after deliberate admin changes is normal.'
union all
select 'C', 'C05', 'October legacy yellow-seat source rows (total)',
       case when (select count(*) from oct_rev) = 81 then 'PASS' else 'FAIL' end, (select count(*) from oct_rev)::text, '81', ''
union all
select 'C', 'C06', 'October legacy review queue breakdown (technical_status)',
       case when (select count(*) from oct_rev) = 81 and (select count(*) filter (where technical_status = 'ORIGINAL_DATE_UNPARSED') from oct_rev) = 0 then 'PASS' else 'WARN' end,
       coalesce((select string_agg(technical_status || '=' || n, ', ' order by technical_status) from (select technical_status, count(*) n from oct_rev group by 1) t), 'none'),
       'all 81 source rows classified, none unparsed',
       'STUDENT_NOT_IN_LOCAL and MISSING_OCTOBER_ROSTER_IDENTITY rows need an admin look; the split depends on the refreshed sheets.'
union all
select 'C', 'C07', 'October MTDC classes where yellow usage exceeds replacement capacity',
       case when (select count(*) from yellow where used > cap) = 5 then 'WARN'
            when (select count(*) from yellow where used > cap) = 0 then 'PASS' else 'FAIL' end,
       (select count(*) from yellow where used > cap)::text, '5 known historical cases (6/5)',
       coalesce((select string_agg(to_char(class_date, 'YYYY-MM-DD') || ' ' || to_char(start_time, 'HH24:MI') || ' ' || used || '/' || cap, '; ' order by class_date, start_time)
                 from yellow where used > cap), 'none') ||
       ' | Needs real room + facilitator confirmation. Never auto-approve.'
union all
select 'C', 'C08', 'regular capacity exceeded in any class (all months)',
       case when (select count(*) from reg_occ where used > cap) = 0 then 'PASS' else 'FAIL' end,
       (select count(*) from reg_occ where used > cap)::text, '0',
       coalesce((select string_agg(to_char(class_date, 'YYYY-MM-DD') || ' ' || to_char(start_time, 'HH24:MI') || ' ' || used || '/' || cap, '; ' order by class_date, start_time)
                 from reg_occ where used > cap), '')
union all
select 'C', 'C09', 'attendance already recorded for a class that has not ended yet',
       case when (select count(*) from public.student_bookings b join public.class_sessions c on c.id = b.class_session_id, tz
                  where b.attendance_status in ('present', 'absent') and (c.class_date + c.end_time) > tz.now_my) = 0 then 'PASS' else 'FAIL' end,
       (select count(*) from public.student_bookings b join public.class_sessions c on c.id = b.class_session_id, tz
        where b.attendance_status in ('present', 'absent') and (c.class_date + c.end_time) > tz.now_my)::text, '0',
       'Future attendance must never exist.'
union all
select 'C', 'C10', 'October MTDC bookings with attendance already marked present/absent', 'INFO',
       (select count(*) from oct_bk where attendance_status in ('present', 'absent'))::text, 'review: history only',
       'Do not mark or change historical attendance to obtain a green audit.'
union all
select 'C', 'C11', 'replacement / reschedule obligations (total; by type and status)', 'INFO',
       (select count(*) from public.makeup_obligations)::text, 'none created from legacy rows',
       coalesce((select string_agg(obligation_type || ':' || status || '=' || n, ', ' order by obligation_type, status) from
                 (select obligation_type, status, count(*) n from public.makeup_obligations group by 1, 2) o), 'none')
union all
select 'C', 'C12', 'obligations whose SOURCE booking is in a pre-November MTDC class',
       case when (select count(*) from public.makeup_obligations m join public.student_bookings b on b.id = m.source_booking_id
                  join cls c on c.id = b.class_session_id
                  where c.branch_id in (select id from mtdc) and c.class_date < date '2026-11-01') = 0 then 'PASS' else 'WARN' end,
       (select count(*) from public.makeup_obligations m join public.student_bookings b on b.id = m.source_booking_id
        join cls c on c.id = b.class_session_id
        where c.branch_id in (select id from mtdc) and c.class_date < date '2026-11-01')::text, '0',
       'Legacy history must not be turned into replacement entitlement automatically.'
union all
select 'C', 'C13', 'November 2026 MTDC schedule batches',
       case (select count(*) from public.schedule_batches where branch_id in (select id from mtdc) and schedule_month = date '2026-11-01') when 0 then 'INFO' when 1 then 'PASS' else 'FAIL' end,
       (select count(*) from public.schedule_batches where branch_id in (select id from mtdc) and schedule_month = date '2026-11-01')::text, '0 (admin drafts it later) or 1',
       'Status: ' || coalesce((select string_agg(status, ',') from public.schedule_batches where branch_id in (select id from mtdc) and schedule_month = date '2026-11-01'), 'none') ||
       ' | If a draft exists do not regenerate it; if none, the admin generates it from Class schedule when ready.'
union all
select 'C', 'C14', 'November MTDC classes',
       case when (select count(*) from nov_cls) = 0 then 'INFO' when (select count(*) from nov_cls) = 48 then 'PASS' else 'WARN' end, (select count(*) from nov_cls)::text, '0 (no draft yet) or 48', ''
union all
select 'C', 'C15', 'November MTDC bookings',
       case when (select count(*) from nov_cls) = 0 then 'INFO' when (select count(*) from nov_bk) = (select coalesce(sum(case when e.frequency_type = 'weekly' then 4 else cardinality(e.preferred_weeks) end), 0) from public.enrollments e join public.branches b on b.id = e.branch_id where e.status = 'active' and (lower(b.name) like '%mtdc%' or lower(coalesce(b.code, '')) = 'mtdc')) then 'PASS' else 'WARN' end, (select count(*) from nov_bk)::text, (select coalesce(sum(case when e.frequency_type = 'weekly' then 4 else cardinality(e.preferred_weeks) end), 0) from public.enrollments e join public.branches b on b.id = e.branch_id where e.status = 'active' and (lower(b.name) like '%mtdc%' or lower(coalesce(b.code, '')) = 'mtdc'))::text,
       'Bookings, not students. Same rule as C04.'
union all
select 'C', 'C16', 'November MTDC DISTINCT students booked', 'INFO', (select count(distinct student_id) from nov_bk)::text, 'compare with active MTDC enrollments', ''
union all
select 'C', 'C17', 'November bookings with no enrollment',
       case when (select count(*) from nov_bk where enrollment_id is null) = 0 then 'PASS' else 'FAIL' end,
       (select count(*) from nov_bk where enrollment_id is null)::text, '0', ''
union all
select 'C', 'C18', 'November bookings whose enrollment belongs to a different student',
       case when (select count(*) from nov_bk b join public.enrollments e on e.id = b.enrollment_id where e.student_id <> b.student_id) = 0 then 'PASS' else 'FAIL' end,
       (select count(*) from nov_bk b join public.enrollments e on e.id = b.enrollment_id where e.student_id <> b.student_id)::text, '0', ''
union all
select 'C', 'C19', 'November bookings whose enrollment is not active, or in another branch',
       case when (select count(*) from nov_bk b join public.enrollments e on e.id = b.enrollment_id where e.status <> 'active' or e.branch_id <> b.c_branch) = 0 then 'PASS' else 'FAIL' end,
       (select count(*) from nov_bk b join public.enrollments e on e.id = b.enrollment_id where e.status <> 'active' or e.branch_id <> b.c_branch)::text, '0', ''
union all
select 'C', 'C20', 'November regular bookings in a class that is not the enrollment default session',
       case when (select count(*) from nov_bk b join public.enrollments e on e.id = b.enrollment_id
                  where b.booking_type = 'regular' and e.default_session_id is distinct from b.c_tpl) = 0 then 'PASS' else 'FAIL' end,
       (select count(*) from nov_bk b join public.enrollments e on e.id = b.enrollment_id
        where b.booking_type = 'regular' and e.default_session_id is distinct from b.c_tpl)::text, '0',
       'Every booking must match its enrollment, not only the totals.'
union all
select 'C', 'C21', 'November bookings for a student who is not active',
       case when (select count(*) from nov_bk b join public.students s on s.id = b.student_id where s.status <> 'active') = 0 then 'PASS' else 'FAIL' end,
       (select count(*) from nov_bk b join public.students s on s.id = b.student_id where s.status <> 'active')::text, '0', ''
union all
select 'C', 'C22', 'active MTDC enrollments NOT booked into the November draft', 'INFO',
       case when (select count(*) from nov_cls) = 0 then 'n/a (no November draft)' else (select count(*) from act_enr e where e.branch_id in (select id from mtdc)
          and not exists (select 1 from nov_bk b where b.enrollment_id = e.id))::text end,
       'explain every difference', 'Should be explainable (paused, twice-monthly, new). Unexplained gaps are a blocker.'
union all
select 'C', 'C23', 'pending academic-calendar decisions in November 2026',
       case when (select count(*) from cal_nov where decision = 'pending') = 0 then 'PASS' else 'WARN' end,
       (select count(*) from cal_nov where decision = 'pending')::text, '0', 'Holidays/closures need a decision before approving the schedule.'
-- =================== D. Human-decision tracking (counts of recorded decisions) ===================
union all
select 'D', 'D01', 'historical reconciliation decisions recorded (by disposition)', 'INFO',
       (select count(*) from public.legacy_reconciliation_decisions)::text, 'human review progress',
       coalesce((select string_agg(disposition || '=' || n, ', ' order by disposition) from
                 (select disposition, count(*) n from public.legacy_reconciliation_decisions group by 1) d), 'none recorded')
union all
select 'D', 'D02', 'yellow-capacity decisions recorded', 'INFO',
       (select count(*) from public.class_replacement_capacity_reviews)::text, 'one per confirmed 6/5 case', ''
union all
select 'D', 'D03', 'guardian-link corrections recorded', 'INFO',
       (select count(*) from public.student_guardian_link_audit)::text, 'human review progress', ''
-- =================== E. Fingerprints (hashes only, no PII) ===================
union all
select 'E', 'E01', 'fingerprint: directory (students, parents, guardians, enrollments)', 'INFO',
       md5(coalesce((select string_agg(id::text || status, ',' order by id) from public.students), '') || '#' ||
           coalesce((select string_agg(id::text, ',' order by id) from public.parents), '') || '#' ||
           coalesce((select string_agg(id::text || student_id::text || parent_id::text || is_primary::text, ',' order by id) from public.student_guardians), '') || '#' ||
           coalesce((select string_agg(id::text || student_id::text || status || coalesce(default_session_id::text, '') || start_date::text || coalesce(end_date::text, ''), ',' order by id) from public.enrollments), '')),
       'identical at sign-off and cutover', 'Changes if any directory record changes.'
union all
select 'E', 'E02', 'fingerprint: September evidence', 'INFO',
       md5(coalesce((select string_agg(source_ref || class_date::text || start_time::text || evidence_kind || coalesce(attendance_raw, '') || md5(student_name), ',' order by id) from sep_ev), '')),
       'identical at sign-off and cutover', 'September must stay historical evidence.'
union all
select 'E', 'E03', 'fingerprint: October MTDC classes, bookings and legacy review queue', 'INFO',
       md5(coalesce((select string_agg(c.id::text || c.class_date::text || c.start_time::text || c.status || coalesce(b.id::text, '') || coalesce(b.student_id::text, '') || coalesce(b.booking_type, '') || coalesce(b.attendance_status, ''), ',' order by c.id, b.id)
                     from oct_cls c left join public.student_bookings b on b.class_session_id = c.id), '') || '#' ||
           coalesce((select string_agg(source_ref || coalesce(original_booking_id::text, '') || coalesce(target_class_id::text, '') || review_state || technical_status, ',' order by id) from oct_rev), '')),
       'identical at sign-off and cutover', 'October must stay historical.'
union all
select 'E', 'E04', 'fingerprint: November MTDC draft (classes + bookings)', 'INFO',
       md5(coalesce((select string_agg(c.id::text || c.class_date::text || c.start_time::text || c.status || coalesce(b.id::text, '') || coalesce(b.student_id::text, '') || coalesce(b.enrollment_id::text, '') || coalesce(b.booking_type, '') || coalesce(b.attendance_status, ''), ',' order by c.id, b.id)
                     from nov_cls c left join public.student_bookings b on b.class_session_id = c.id), '')),
       'identical until the admin changes it deliberately', 'Proves the saved draft was not regenerated or altered.'
union all
select 'F', 'F01', 'what this audit cannot show', 'UNKNOWN',
       'comparison with the signed-off source sheets; company GitHub/Supabase/Vercel; browser UAT; real-data restore; room and facilitator confirmation',
       'human sign-off', 'A clean run is NOT production readiness.'
)
select sec, id, title, status, actual, expected, note from rows_ order by sec, id;
