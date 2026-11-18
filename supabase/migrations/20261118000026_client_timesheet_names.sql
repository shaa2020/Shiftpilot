-- ============================================================================
-- ShiftPilot — 0026 Worker names on client timesheets
--
-- Clients cannot read worker records. For timesheets they may see (same rule
-- as the timesheets policy), this returns only the display name used
-- elsewhere in the client portal: first name + last initial.
-- ============================================================================
create or replace function public.client_timesheet_workers(p_timesheet_ids uuid[])
returns table (timesheet_id uuid, worker_display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, coalesce(w.display_name, w.first_name || ' ' || left(w.last_name, 1) || '.')
  from public.timesheets t
  join public.workers w on w.id = t.worker_id
  where t.id = any (p_timesheet_ids)
    and t.status <> 'draft'
    and app.client_location_allowed(t.client_id, t.location_id)
$$;
revoke all on function public.client_timesheet_workers(uuid[]) from public, anon;
grant execute on function public.client_timesheet_workers(uuid[]) to authenticated;
