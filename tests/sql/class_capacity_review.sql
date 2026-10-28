-- Isolated PostgreSQL fixture ONLY; run after migration 019.
set test.actor='00000000-0000-4000-8000-000000000001';
select public.decide_class_replacement_capacity(
  '70000000-0000-4000-8000-000000000001',2,0,
  'retain',null,false,false,'','Operations to resolve manually; no room approval'
);
do $t$
begin
  if (select replacement_capacity from public.class_sessions
      where id='70000000-0000-4000-8000-000000000001')<>2 then
    raise exception 'Keep decision changed capacity';
  end if;
  if (select count(*) from public.class_replacement_capacity_reviews where decision='retain')<>1 then
    raise exception 'Retain decision missing';
  end if;
  begin
    perform public.decide_class_replacement_capacity(
      '70000000-0000-4000-8000-000000000001',2,1,
      'retain',null,false,false,'','Stale occupancy should be rejected'
    );
    raise exception 'Stale occupancy accepted';
  exception when raise_exception then
    if SQLERRM not like '%Yellow occupancy changed%' then raise; end if;
  end;
  begin
    perform public.decide_class_replacement_capacity(
      '70000000-0000-4000-8000-000000000001',2,0,
      'expand',3,true,false,'Operations','Room confirmed but facilitator not verified'
    );
    raise exception 'Unverified expansion accepted';
  exception when raise_exception then
    if SQLERRM not like '%Verify room%' then raise; end if;
  end;
end;
$t$;
select public.decide_class_replacement_capacity(
  '70000000-0000-4000-8000-000000000001',2,0,
  'expand',3,true,true,'Operations','Room and facilitator independently verified'
);
do $t$
begin
  if (select replacement_capacity from public.class_sessions
      where id='70000000-0000-4000-8000-000000000001')<>3 then
    raise exception 'Verified capacity expansion failed';
  end if;
  if (select replacement_capacity from public.class_sessions
      where id='70000000-0000-4000-8000-000000000002')<>1 then
    raise exception 'Sibling capacity modified';
  end if;
  if (select count(*) from public.class_replacement_capacity_reviews where decision='expand')<>1 then
    raise exception 'Expansion decision not audited';
  end if;
  if (select count(*) from public.class_replacement_capacity_audit
      where class_session_id='70000000-0000-4000-8000-000000000001')<>2 then
    raise exception 'Legacy capacity audit not updated';
  end if;
  begin
    perform public.decide_class_replacement_capacity(
      '70000000-0000-4000-8000-000000000003',2,1,
      'retain',null,false,false,'','Locked class should reject review'
    );
    raise exception 'Locked class review accepted';
  exception when raise_exception then
    if SQLERRM not like '%Only scheduled classes in a draft batch%' then raise; end if;
  end;
end;
$t$;
set test.actor='00000000-0000-4000-8000-000000000002';
do $t$
begin
  begin
    perform public.decide_class_replacement_capacity(
      '70000000-0000-4000-8000-000000000001',3,0,
      'retain',null,false,false,'','Non-admin should not review decisions'
    );
    raise exception 'Parent decided capacity';
  exception when raise_exception then
    if SQLERRM not like '%Only active admins%' then raise; end if;
  end;
end;
$t$;
set test.actor='00000000-0000-4000-8000-000000000001';
set role authenticated;
do $t$
begin
  if (select count(*) from public.class_replacement_capacity_reviews)<>2 then
    raise exception 'Admin cannot read decision audit';
  end if;
  begin
    perform public.adjust_class_replacement_capacity(
      '70000000-0000-4000-8000-000000000001',3,4,'Legacy bypass attempt'
    );
    raise exception 'Unverified legacy capacity RPC still accessible';
  exception when insufficient_privilege then null;
  end;
end;
$t$;
set test.actor='00000000-0000-4000-8000-000000000002';
do $t$
begin
  if exists(select 1 from public.class_replacement_capacity_reviews) then
    raise exception 'Non-admin can read decisions';
  end if;
end;
$t$;
reset role;
select 'Capacity retain/expand decisions, RLS, and old RPC bypass guard passed' as result;
