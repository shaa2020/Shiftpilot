-- ============================================================================
-- ShiftPilot — 0020 Client portal helpers
-- Client users cannot read the agencies table; expose just the agency name
-- (for invitation emails) and the catalogue needed for request forms.
-- ============================================================================
create or replace function public.client_agency_name(p_client_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.name from public.clients c join public.agencies a on a.id = c.agency_id
  where c.id = p_client_id and app.is_client_member(p_client_id)
$$;
revoke all on function public.client_agency_name(uuid) from public, anon;
grant execute on function public.client_agency_name(uuid) to authenticated;

-- Team list for client users who may manage users (names/emails of colleagues only).
create or replace function public.client_team(p_client_id uuid)
returns table (membership_id uuid, full_name text, email text, role public.client_member_role, status public.record_status,
               can_request_staff boolean, can_approve_timesheets boolean, can_view_finance boolean, can_manage_users boolean, is_self boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, p.full_name, p.email::text, m.role, m.status, m.can_request_staff, m.can_approve_timesheets, m.can_view_finance, m.can_manage_users,
         m.user_id = auth.uid()
  from public.client_memberships m join public.profiles p on p.id = m.user_id
  where m.client_id = p_client_id and app.client_can(p_client_id, 'manage_users')
  order by p.full_name
$$;
revoke all on function public.client_team(uuid) from public, anon;
grant execute on function public.client_team(uuid) to authenticated;
