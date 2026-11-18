-- ============================================================================
-- ShiftPilot — 0024 Database-level MFA enforcement and upload scan status
--
-- Staff permissions (app.has_permission, used by every staff RLS policy and
-- RPC) only apply on an aal2 session when the user has a verified MFA factor
-- or the agency requires staff MFA. A stolen password-only (aal1) token can
-- therefore no longer read or change staff data through the Data API.
-- ============================================================================

alter table public.agency_settings add column require_staff_mfa boolean not null default false;

create or replace function app.staff_mfa_satisfied(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or (not coalesce((select s.require_staff_mfa from public.agency_settings s where s.agency_id = p_agency_id), false)
          and not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified'))
$$;
grant execute on function app.staff_mfa_satisfied(uuid) to authenticated, service_role;

create or replace function app.has_permission(p_agency_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.agencies a on a.id = ur.agency_id
    where ur.user_id = auth.uid()
      and ur.agency_id = p_agency_id
      and rp.permission_key = p_permission
      and a.status <> 'archived'
  ) and app.staff_mfa_satisfied(p_agency_id)
$$;

create or replace function public.my_permissions(p_agency_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct rp.permission_key
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  where ur.user_id = auth.uid() and ur.agency_id = p_agency_id and app.staff_mfa_satisfied(p_agency_id)
$$;

-- Whether the signed-in user must complete MFA (enrol or verify) for an agency.
create or replace function public.my_mfa_requirement(p_agency_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.staff_mfa_satisfied(p_agency_id) then 'ok'
    when exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified') then 'verify'
    else 'enrol'
  end
$$;
revoke all on function public.my_mfa_requirement(uuid) from public, anon;
grant execute on function public.my_mfa_requirement(uuid) to authenticated;

-- Malware scan result recorded with each stored version. Infected files are
-- rejected before storage, so only 'clean' or 'not_scanned' are stored.
alter table public.document_versions
  add column scan_status text not null default 'not_scanned' check (scan_status in ('clean', 'not_scanned')),
  add column scan_engine text;
