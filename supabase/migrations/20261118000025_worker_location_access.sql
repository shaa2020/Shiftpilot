-- ============================================================================
-- ShiftPilot — 0025 Workers can read the location and client of their shifts
--
-- The worker app shows where and for whom a shift is (address, arrival and
-- parking instructions, site contact). Workers may read a client location and
-- the client row only while they hold an active assignment or a pending
-- invitation for a shift there. Nothing else about clients becomes visible.
-- ============================================================================

create or replace function app.worker_has_shift_at(p_location_id uuid, p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shifts s
    join public.workers w on w.user_id = auth.uid() and w.agency_id = s.agency_id
    where (p_location_id is null or s.location_id = p_location_id)
      and (p_client_id is null or s.client_id = p_client_id)
      and (
        exists (select 1 from public.shift_assignments a where a.shift_id = s.id and a.worker_id = w.id
                  and a.status not in ('declined', 'cancelled', 'replaced'))
        or exists (select 1 from public.shift_invitations i where i.shift_id = s.id and i.worker_id = w.id and i.status = 'pending')
      )
  )
$$;
grant execute on function app.worker_has_shift_at(uuid, uuid) to authenticated;

create policy client_locations_select_worker on public.client_locations for select to authenticated
  using (app.worker_has_shift_at(id, null));
create policy clients_select_worker on public.clients for select to authenticated
  using (app.worker_has_shift_at(null, id));
