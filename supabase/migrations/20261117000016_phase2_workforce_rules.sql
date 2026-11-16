-- ============================================================================
-- ShiftPilot — 0016 Phase 2 rules: worker numbering, default onboarding,
-- activation gate, public careers listing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Per-agency counters (worker numbers etc.)
-- ---------------------------------------------------------------------------
create table public.agency_counters (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  counter_key text not null check (counter_key ~ '^[a-z_]{2,40}$'),
  value bigint not null default 0,
  primary key (agency_id, counter_key)
);
alter table public.agency_counters enable row level security;
revoke all on public.agency_counters from anon, authenticated;

create or replace function app.next_counter(p_agency_id uuid, p_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint;
begin
  insert into public.agency_counters as c (agency_id, counter_key, value) values (p_agency_id, p_key, 1)
  on conflict (agency_id, counter_key) do update set value = c.value + 1
  returning value into v;
  return v;
end;
$$;

alter table public.workers alter column worker_number drop not null;

create or replace function app.assign_worker_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.worker_number is null or new.worker_number = '' then
    new.worker_number := 'W-' || lpad(app.next_counter(new.agency_id, 'worker')::text, 5, '0');
  end if;
  return new;
end;
$$;
create trigger trg_workers_number before insert on public.workers
  for each row execute function app.assign_worker_number();

-- Re-impose NOT NULL via check (the trigger fills it before constraints run).
alter table public.workers add constraint workers_number_present check (worker_number is not null and worker_number <> '');

-- ---------------------------------------------------------------------------
-- Default onboarding tasks per pathway
-- ---------------------------------------------------------------------------
create or replace function app.create_default_onboarding_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.onboarding_tasks (agency_id, worker_id, task_type, title, is_required, staff_only, sort_order)
  select new.agency_id, new.id, t.task_type, t.title, t.required, t.staff_only, t.sort_order
  from (values
    ('personal_info', 'Complete your personal and emergency contact details', true, false, 10, null::public.engagement_type),
    ('professional_profile', 'Add your skills, languages, experience and availability', true, false, 20, null),
    ('documents', 'Upload required documents and certificates', true, false, 30, null),
    ('identity_check', 'Identity verification by the agency', true, true, 40, null),
    ('work_eligibility', 'Work eligibility verification by the agency', true, true, 50, null),
    ('contract', 'Employment contract signed', true, true, 60, 'employee'),
    ('business_details', 'Register your business details (KvK, VAT, insurance)', true, false, 60, 'freelancer'),
    ('classification_review', 'Freelancer classification review by the agency', true, true, 70, 'freelancer'),
    ('agreement', 'Accept the worker agreement and privacy notice', true, false, 80, null)
  ) as t(task_type, title, required, staff_only, sort_order, only_for)
  where t.only_for is null or t.only_for = new.engagement_type;
  return new;
end;
$$;
create trigger trg_workers_default_tasks after insert on public.workers
  for each row execute function app.create_default_onboarding_tasks();

-- ---------------------------------------------------------------------------
-- Activation gate: a worker can only become 'active' after mandatory checks.
-- Applies to everyone, including administrators (no silent overrides).
-- ---------------------------------------------------------------------------
create or replace function app.worker_activation_blockers(p_worker_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when pd.identity_verification_status <> 'verified' then 'Identity has not been verified' end,
    case when pd.work_eligibility_status <> 'verified' then 'Work eligibility has not been verified' end,
    case when pd.work_eligibility_expires_on is not null and pd.work_eligibility_expires_on < current_date then 'Work eligibility has expired' end,
    case when w.engagement_type = 'freelancer' and coalesce(fb.classification_status::text, 'missing') <> 'approved'
         then 'Freelancer classification review is not approved' end,
    case when w.engagement_type = 'employee' and not exists (
           select 1 from public.employment_contracts c where c.worker_id = w.id and c.status = 'active')
         then 'No active employment contract' end,
    case when w.engagement_type = 'freelancer' and not exists (
           select 1 from public.freelancer_agreements a where a.business_id = fb.id and a.status = 'active')
         then 'No active freelancer agreement' end
  ], null)
  from public.workers w
  join public.worker_private_details pd on pd.worker_id = w.id
  left join public.freelancer_businesses fb on fb.worker_id = w.id
  where w.id = p_worker_id
$$;
grant execute on function app.worker_activation_blockers(uuid) to authenticated, service_role;

create or replace function public.worker_activation_blockers(p_worker_id uuid)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select case when exists (select 1 from public.workers where id = p_worker_id)
              then app.worker_activation_blockers(p_worker_id) end
$$;
revoke all on function public.worker_activation_blockers(uuid) from public, anon;
grant execute on function public.worker_activation_blockers(uuid) to authenticated;

create or replace function app.guard_worker_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blockers text[];
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    if tg_op = 'INSERT' then
      raise exception 'Workers cannot be created as active; complete onboarding first' using errcode = 'P0001';
    end if;
    v_blockers := app.worker_activation_blockers(new.id);
    if cardinality(v_blockers) > 0 then
      raise exception 'Worker cannot be activated: %', array_to_string(v_blockers, '; ') using errcode = 'P0001';
    end if;
    new.activated_at := coalesce(new.activated_at, now());
  end if;
  if new.status = 'archived' and old.status is distinct from 'archived' then
    new.archived_at := coalesce(new.archived_at, now());
  elsif new.status <> 'archived' then
    new.archived_at := null;
  end if;
  return new;
end;
$$;
create trigger trg_workers_activation before insert or update of status on public.workers
  for each row execute function app.guard_worker_activation();

-- Clients: keep archived_at consistent with status.
create or replace function app.client_archive_bookkeeping()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'archived' then
    new.archived_at := coalesce(new.archived_at, now());
  else
    new.archived_at := null;
  end if;
  return new;
end;
$$;
create trigger trg_clients_archive before insert or update of status on public.clients
  for each row execute function app.client_archive_bookkeeping();

-- ---------------------------------------------------------------------------
-- Public careers listing (no access to the agencies table needed)
-- ---------------------------------------------------------------------------
create or replace function public.public_job_openings(p_agency_slug text default null, p_job_slug text default null)
returns table (
  id uuid, agency_id uuid, agency_slug text, agency_name text, title text, slug text, location_city text,
  description text, requirements_text text, hours_indication text, pay_indication text,
  engagement_types public.engagement_type[], published_at timestamptz, closes_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, j.agency_id, a.slug::text, a.name, j.title, j.slug, j.location_city, j.description, j.requirements_text,
         j.hours_indication, j.pay_indication, j.engagement_types, j.published_at, j.closes_at
  from public.job_openings j
  join public.agencies a on a.id = j.agency_id
  where j.status = 'published' and (j.closes_at is null or j.closes_at > now()) and a.status = 'active'
    and (p_agency_slug is null or a.slug = p_agency_slug)
    and (p_job_slug is null or j.slug = p_job_slug)
  order by j.published_at desc
  limit 200
$$;
revoke all on function public.public_job_openings(text, text) from public;
grant execute on function public.public_job_openings(text, text) to anon, authenticated;

-- Applicant documents are uploaded through the server (service role).
-- Recruiters may read application documents.
create policy documents_application_select on public.documents for select to authenticated
  using (owner_type = 'application' and app.has_permission(agency_id, 'recruitment.read'));
