-- ============================================================================
-- ShiftPilot — 0027 Corrections are billed and exported exactly once
--
-- Billing and payroll classify minutes from actual_start/actual_end and used
-- to add every 'adjustment' entry on top. A correction made before approval
-- updates the times AND records an adjustment (for the audit ledger), so the
-- difference was counted twice. Now only the part of the ledger that the
-- times do not already contain is added.
-- ============================================================================
create or replace function app.classify_minutes(p_timesheet_id uuid, p_weekend_days int[], p_night_from time, p_night_to time, p_use_holidays boolean)
returns table (category text, minutes integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
  tz text;
  cur timestamptz;
  loc timestamp;
  c_holiday int := 0; c_weekend int := 0; c_night int := 0; c_regular int := 0;
  brk int; d int; adj int; v_ledger int; v_entries int;
begin
  select * into t from public.timesheets where id = p_timesheet_id;
  if t.actual_start is null or t.actual_end is null then return; end if;
  select timezone into tz from public.agencies where id = t.agency_id;
  cur := date_trunc('minute', t.actual_start);
  while cur < date_trunc('minute', t.actual_end) loop
    loc := cur at time zone tz;
    if p_use_holidays and exists (select 1 from public.public_holidays h where h.agency_id = t.agency_id and h.holiday_date = loc::date) then
      c_holiday := c_holiday + 1;
    elsif extract(isodow from loc)::int = any (coalesce(p_weekend_days, '{}'::int[])) then
      c_weekend := c_weekend + 1;
    elsif app.in_window(loc::time, p_night_from, p_night_to) then
      c_night := c_night + 1;
    else
      c_regular := c_regular + 1;
    end if;
    cur := cur + interval '1 minute';
  end loop;
  brk := t.break_minutes;
  d := least(brk, c_regular); c_regular := c_regular - d; brk := brk - d;
  d := least(brk, c_night); c_night := c_night - d; brk := brk - d;
  d := least(brk, c_weekend); c_weekend := c_weekend - d; brk := brk - d;
  d := least(brk, c_holiday); c_holiday := c_holiday - d;
  -- The entries ledger (frozen lines + adjustments) always totals the true worked
  -- minutes. Only the part not already reflected in actual_start/actual_end is
  -- added: corrections made after approval (times frozen). Corrections before
  -- approval update the times themselves and must not be counted again.
  select coalesce(sum(e.minutes), 0), count(*) into v_ledger, v_entries from public.timesheet_entries e where e.timesheet_id = t.id;
  adj := case when v_entries = 0 then 0 else v_ledger - coalesce(t.worked_minutes, 0) end;
  category := 'public_holiday'; minutes := c_holiday; return next;
  category := 'weekend'; minutes := c_weekend; return next;
  category := 'night'; minutes := c_night; return next;
  category := 'regular'; minutes := greatest(0, c_regular + adj); return next;
end;
$$;
