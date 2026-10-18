-- Run only against the ephemeral replacement fixture, never production.
-- The fixture already creates auth schema, active admin and sample branches.
create table auth.users (id uuid primary key);
insert into auth.users values ('00000000-0000-4000-8000-000000000001');

-- Fixture's batch table is deliberately minimal; add the calendar's
-- required month key for this isolated schema test.
alter table public.schedule_batches
add column schedule_month date not null default '2026-09-01';

\i supabase/migrations/016_academic_calendar.sql

do $$
declare
    event_id uuid;
begin
    insert into academic_calendar_exceptions
        (branch_id, closed_on, title, event_type, decision, created_by)
    values
        ('10000000-0000-4000-8000-000000000001', '2026-10-24',
         'NextGen event', 'event', 'pending',
         '00000000-0000-4000-8000-000000000001')
    returning id into event_id;

    update academic_calendar_exceptions
       set decision = 'move', target_on = '2026-10-31'
     where id = event_id;

    if not exists (
        select 1 from academic_calendar_exceptions
        where id = event_id and decision = 'move' and target_on = '2026-10-31'
    ) then
        raise exception 'Calendar move not persisted';
    end if;

    -- Invalid move date: Friday instead of Saturday.
    begin
        update academic_calendar_exceptions
           set target_on = '2026-10-30' where id = event_id;
        raise exception 'Expected same-weekday check to reject Friday';
    exception
        when check_violation then null;
    end;

    -- Second event for same branch/date must not be possible.
    begin
        insert into academic_calendar_exceptions
            (branch_id, closed_on, title, event_type)
        values
            ('10000000-0000-4000-8000-000000000001',
             '2026-10-24', 'Duplicate event', 'holiday');
        raise exception 'Expected one event per date constraint';
    exception
        when unique_violation then null;
    end;

    -- Withdrawal keeps the audit record and clears target date.
    update academic_calendar_exceptions
       set decision = 'withdrawn', target_on = null
     where id = event_id;

    -- Freeze when October schedule becomes approved / locked.
    insert into schedule_batches(id, branch_id, status, schedule_month)
    values ('60000000-0000-4000-8000-000000000003',
            '10000000-0000-4000-8000-000000000001',
            'approved', '2026-10-01');

    begin
        update academic_calendar_exceptions
           set decision = 'skip', target_on = null
         where id = event_id;
        raise exception 'Expected guard to freeze approved month';
    exception
        when raise_exception then
            if SQLERRM not like '%Calendar is frozen%' then
                raise;
            end if;
    end;

    begin
        delete from academic_calendar_exceptions where id = event_id;
        raise exception 'Expected deletion guard';
    exception
        when raise_exception then
            if SQLERRM not like '%Withdraw calendar events%' then
                raise;
            end if;
    end;
end;
$$;

select 'Academic calendar schema guards passed' as result;
