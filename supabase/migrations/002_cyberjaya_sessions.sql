-- =====================================================
-- CYBERJAYA SESSION CONFIGURATION
-- Saturday = 6
-- =====================================================

insert into session_templates (
    branch_id,
    programme_id,
    name,
    day_of_week,
    start_time,
    end_time,
    regular_capacity,
    replacement_capacity
)
select
    b.id,
    p.id,
    'Saturday 9:00 AM - Junior Maker',
    6,
    '09:00',
    '10:30',
    10,
    5
from branches b
join programmes p on p.code = 'JR_MAKER'
where b.code = 'CYBERJAYA';


insert into session_templates (
    branch_id,
    programme_id,
    name,
    day_of_week,
    start_time,
    end_time,
    regular_capacity,
    replacement_capacity
)
select
    b.id,
    p.id,
    'Saturday 9:00 AM - Young Coder',
    6,
    '09:00',
    '10:30',
    10,
    5
from branches b
join programmes p on p.code = 'YOUNG_CODER'
where b.code = 'CYBERJAYA';


insert into session_templates (
    branch_id,
    programme_id,
    name,
    day_of_week,
    start_time,
    end_time,
    regular_capacity,
    replacement_capacity
)
select
    b.id,
    p.id,
    'Saturday 11:00 AM - Junior Maker',
    6,
    '11:00',
    '12:30',
    11,
    4
from branches b
join programmes p on p.code = 'JR_MAKER'
where b.code = 'CYBERJAYA';


insert into session_templates (
    branch_id,
    programme_id,
    name,
    day_of_week,
    start_time,
    end_time,
    regular_capacity,
    replacement_capacity
)
select
    b.id,
    p.id,
    'Saturday 11:00 AM - Young Coder',
    6,
    '11:00',
    '12:30',
    10,
    5
from branches b
join programmes p on p.code = 'YOUNG_CODER'
where b.code = 'CYBERJAYA';


insert into session_templates (
    branch_id,
    programme_id,
    name,
    day_of_week,
    start_time,
    end_time,
    regular_capacity,
    replacement_capacity
)
select
    b.id,
    p.id,
    'Saturday 2:00 PM - Junior Maker',
    6,
    '14:00',
    '15:30',
    10,
    5
from branches b
join programmes p on p.code = 'JR_MAKER'
where b.code = 'CYBERJAYA';


insert into session_templates (
    branch_id,
    programme_id,
    name,
    day_of_week,
    start_time,
    end_time,
    regular_capacity,
    replacement_capacity
)
select
    b.id,
    p.id,
    'Saturday 2:00 PM - Young Coder',
    6,
    '14:00',
    '15:30',
    10,
    5
from branches b
join programmes p on p.code = 'YOUNG_CODER'
where b.code = 'CYBERJAYA';