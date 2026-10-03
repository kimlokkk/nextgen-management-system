alter table session_templates
add constraint session_templates_unique_schedule
unique (
  branch_id,
  programme_id,
  day_of_week,
  start_time,
  end_time
);