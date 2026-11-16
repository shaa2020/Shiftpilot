-- ============================================================================
-- ShiftPilot — 0017 Scheduling engine
--   * eligibility evaluation with explanations (mandatory failures vs warnings)
--   * client and worker rate resolution + immutable snapshots on confirmation
--   * atomic shift creation (incl. recurrence), request acceptance,
--     invitations, direct assignment, confirmation, cancellation, no-show,
--     replacement requests and replacements
--   * in-app notifications for every scheduling event
-- Overrides are limited to warnings, require `matching.override` and a
-- written reason, and are recorded. Mandatory failures can never be overridden.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Notifications helper
-- ---------------------------------------------------------------------------
create or replace function app.notify(p_agency uuid, p_user uuid, p_event text, p_title text, p_body text,
                                      p_link text, p_entity_type text, p_entity_id uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications (agency_id, recipient_user_id, event_type, title, body, link_path, entity_type, entity_id, idempotency_key)
  values (p_agency, p_user, p_event, left(p_title, 200), left(p_body, 1000), p_link, p_entity_type, p_entity_id, p_key)
  on conflict (recipient_user_id, idempotency_key) do nothing;
end;
$$;

create or replace function app.notify_permission_holders(p_agency uuid, p_permission text, p_event text, p_title text, p_body text,
                                                         p_link text, p_entity_type text, p_entity_id uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in
    select distinct ur.user_id from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.agency_id = p_agency and rp.permission_key = p_permission
  loop
    perform app.notify(p_agency, r.user_id, p_event, p_title, p_body, p_link, p_entity_type, p_entity_id, p_key);
  end loop;
end;
$$;

create or replace function app.notify_client_users(p_client uuid, p_location uuid, p_capability text, p_event text, p_title text, p_body text,
                                                   p_link text, p_entity_type text, p_entity_id uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in
    select m.user_id, m.agency_id from public.client_memberships m
    where m.client_id = p_client and m.status = 'active'
      and (p_capability is null
           or (p_capability = 'request' and m.can_request_staff)
           or (p_capability = 'approve' and m.can_approve_timesheets)
           or (p_capability = 'finance' and m.can_view_finance))
      and (p_location is null
           or not exists (select 1 from public.client_membership_locations l where l.membership_id = m.id)
           or exists (select 1 from public.client_membership_locations l where l.membership_id = m.id and l.location_id = p_location))
  loop
    perform app.notify(r.agency_id, r.user_id, p_event, p_title, p_body, p_link, p_entity_type, p_entity_id, p_key);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.language_rank(p text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p when 'A1' then 1 when 'A2' then 2 when 'B1' then 3 when 'B2' then 4 when 'C1' then 5 when 'C2' then 6 when 'native' then 7 else 0 end
$$;

create or replace function app.haversine_km(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round((6371 * 2 * asin(sqrt(
    power(sin(radians((lat2 - lat1)::float8) / 2), 2) +
    cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lon2 - lon1)::float8) / 2), 2)
  )))::numeric, 1)
$$;

create or replace function app.active_rule_param(p_agency uuid, p_rule_key text, p_param text, p_on date)
returns table (value numeric, severity text)
language sql
stable
security definer
set search_path = ''
as $$
  select (r.parameters ->> p_param)::numeric, r.severity
  from public.compliance_rules r
  where r.agency_id = p_agency and r.rule_key = p_rule_key and r.status = 'active'
    and r.effective_from <= p_on and (r.effective_to is null or r.effective_to >= p_on)
    and r.parameters ? p_param
  order by r.version desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Eligibility
-- ---------------------------------------------------------------------------
create or replace function app.evaluate_eligibility(p_shift_position_id uuid, p_worker_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sp public.shift_positions;
  s public.shifts;
  pos public.job_positions;
  w public.workers;
  pd public.worker_private_details;
  fb public.freelancer_businesses;
  loc public.client_locations;
  tz text;
  local_start timestamp;
  local_end timestamp;
  shift_date date;
  shift_end_date date;
  failures text[] := '{}';
  warnings text[] := '{}';
  notes text[] := '{}';
  score numeric := 50;
  r record;
  met boolean;
  label text;
  v_dist numeric;
  v_rule record;
  v_minutes numeric;
  v_week_minutes numeric;
  v_prev integer;
  v_avail text := 'none';
  v_restrictions jsonb;
begin
  select * into sp from public.shift_positions where id = p_shift_position_id;
  select * into w from public.workers where id = p_worker_id;
  if sp.id is null or w.id is null or sp.agency_id <> w.agency_id then
    return jsonb_build_object('eligible', false, 'failures', jsonb_build_array('Worker or position not found'), 'warnings', '[]'::jsonb, 'score', 0);
  end if;
  select * into s from public.shifts where id = sp.shift_id;
  select * into pos from public.job_positions where id = sp.position_id;
  select * into pd from public.worker_private_details where worker_id = w.id;
  select * into fb from public.freelancer_businesses where worker_id = w.id;
  select * into loc from public.client_locations where id = s.location_id;
  select timezone into tz from public.agencies where id = s.agency_id;
  local_start := s.starts_at at time zone tz;
  local_end := s.ends_at at time zone tz;
  shift_date := local_start::date;
  shift_end_date := local_end::date;

  -- Status and pathway
  if w.status <> 'active' then failures := failures || format('Worker status is %s', w.status); end if;
  if not (w.engagement_type = any (sp.allowed_engagements)) then
    failures := failures || format('This position is not open to %s workers', w.engagement_type);
  end if;
  if w.engagement_type = 'freelancer' then
    if not pos.allows_freelancers then failures := failures || 'Position may not be performed by freelancers'::text; end if;
    if fb.id is null or fb.classification_status = 'pending' or fb.classification_status = 'rejected' then
      failures := failures || 'Freelancer classification review is not approved'::text;
    elsif fb.classification_status = 'restricted' then
      select cr.restrictions into v_restrictions from public.compliance_reviews cr
      where cr.freelancer_business_id = fb.id and cr.review_type = 'freelancer_classification' and cr.status = 'restricted'
      order by cr.decided_at desc limit 1;
      if not coalesce(v_restrictions -> 'positions' ? pos.id::text, false) then
        failures := failures || 'Freelancer classification is restricted and does not cover this position'::text;
      end if;
    end if;
    if not exists (select 1 from public.freelancer_agreements a where a.business_id = fb.id and a.status = 'active'
                   and a.start_date <= shift_date and (a.end_date is null or a.end_date >= shift_end_date)) then
      failures := failures || 'No active freelancer agreement covers the shift date'::text;
    end if;
  else
    if not exists (select 1 from public.employment_contracts c where c.worker_id = w.id and c.status = 'active'
                   and c.start_date <= shift_date and (c.end_date is null or c.end_date >= shift_end_date)) then
      failures := failures || 'No active employment contract covers the shift date'::text;
    end if;
  end if;

  -- Identity and work eligibility
  if pd.identity_verification_status is distinct from 'verified' then failures := failures || 'Identity has not been verified'::text; end if;
  if pd.work_eligibility_status is distinct from 'verified' then
    failures := failures || 'Work eligibility has not been verified'::text;
  elsif pd.work_eligibility_expires_on is not null and pd.work_eligibility_expires_on < shift_end_date then
    failures := failures || 'Work eligibility expires before the shift'::text;
  end if;

  -- Regulated positions always need a specific approved review
  if pos.is_regulated and not exists (
      select 1 from public.compliance_reviews cr
      where cr.worker_id = w.id and cr.position_id = pos.id and cr.review_type = 'regulated_position' and cr.status = 'approved'
        and (cr.valid_until is null or cr.valid_until >= shift_end_date)) then
    failures := failures || 'Regulated position: an approved compliance review for this worker is required'::text;
  end if;

  -- Position requirements
  for r in
    select pr.*, sk.name as skill_name, ce.name as cert_name, q.name as qual_name
    from public.position_requirements pr
    left join public.skills sk on sk.id = pr.skill_id
    left join public.certificates ce on ce.id = pr.certificate_id
    left join public.qualifications q on q.id = pr.qualification_id
    where pr.position_id = pos.id
  loop
    met := true;
    case r.requirement_type
      when 'certificate' then
        met := exists (select 1 from public.worker_certificates wc where wc.worker_id = w.id and wc.certificate_id = r.certificate_id
                       and wc.status = 'verified' and (wc.expires_on is null or wc.expires_on >= shift_end_date));
        label := format('valid, verified certificate "%s"', r.cert_name);
      when 'skill' then
        met := exists (select 1 from public.worker_skills ws where ws.worker_id = w.id and ws.skill_id = r.skill_id);
        label := format('skill "%s"', r.skill_name);
      when 'qualification' then
        met := exists (select 1 from public.worker_qualifications wq where wq.worker_id = w.id and wq.qualification_id = r.qualification_id
                       and wq.status = 'verified' and (wq.expires_on is null or wq.expires_on >= shift_end_date));
        label := format('verified qualification "%s"', r.qual_name);
      when 'language' then
        met := exists (select 1 from public.worker_languages wl where wl.worker_id = w.id and wl.language_code = r.language_code
                       and app.language_rank(wl.level) >= app.language_rank(coalesce(r.min_language_level, 'A1')));
        label := format('language %s%s', upper(r.language_code), coalesce(' at level ' || r.min_language_level, ''));
      when 'experience' then
        met := coalesce((select sum(((coalesce(e.end_date, current_date) - e.start_date) / 30.4)::integer) from public.worker_experience e where e.worker_id = w.id), 0) >= r.min_experience_months;
        label := format('%s months of experience', r.min_experience_months);
      when 'engagement' then
        met := w.engagement_type = r.engagement_type;
        label := format('%s pathway', r.engagement_type);
      else
        met := null;  -- safety requirements cannot be verified automatically
        label := r.description;
    end case;

    if met is null then
      notes := notes || format('Confirm safety requirement: %s', label);
    elsif not met and r.is_mandatory then
      failures := failures || format('Missing required %s', label);
    elsif not met then
      notes := notes || format('Preferred requirement not met: %s', label);
      score := score - 5;
    elsif not r.is_mandatory then
      score := score + 5;
    end if;
  end loop;

  -- Shift-specific requirements
  if exists (select 1 from unnest(sp.required_skill_ids) sid
             where not exists (select 1 from public.worker_skills ws where ws.worker_id = w.id and ws.skill_id = sid)) then
    failures := failures || 'Missing a skill required for this shift'::text;
  end if;
  if sp.required_language_code is not null and not exists (
      select 1 from public.worker_languages wl where wl.worker_id = w.id and wl.language_code = sp.required_language_code) then
    failures := failures || format('Does not speak the required language (%s)', upper(sp.required_language_code));
  end if;

  -- Existing commitments
  if exists (select 1 from public.shift_assignments a
             where a.worker_id = w.id and a.shift_id <> s.id
               and a.status in ('accepted', 'confirmed', 'checked_in', 'checked_out', 'completed', 'replacement_requested', 'disputed')
               and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(s.starts_at, s.ends_at, '[)')) then
    failures := failures || 'Already booked at an overlapping time'::text;
  end if;
  if exists (select 1 from public.worker_availability av
             where av.worker_id = w.id and av.kind = 'unavailable'
               and shift_date between av.date_from and av.date_to
               and (av.start_time is null or (av.start_time < local_end::time and av.end_time > local_start::time))) then
    failures := failures || 'Marked as unavailable on this date'::text;
  end if;

  -- Working-time rules (configured by the agency; none are assumed)
  select * into v_rule from app.active_rule_param(s.agency_id, 'working_time.min_rest', 'min_rest_minutes', shift_date);
  if v_rule.value is not null and exists (
      select 1 from public.shift_assignments a
      where a.worker_id = w.id and a.shift_id <> s.id
        and a.status in ('accepted', 'confirmed', 'checked_in', 'checked_out', 'completed', 'replacement_requested', 'disputed')
        and tstzrange(a.starts_at - make_interval(mins => v_rule.value::int), a.ends_at + make_interval(mins => v_rule.value::int), '[)')
            && tstzrange(s.starts_at, s.ends_at, '[)')) then
    if v_rule.severity = 'blocking' then failures := failures || format('Less than %s hours rest between shifts', round(v_rule.value / 60, 1));
    else warnings := warnings || format('Less than %s hours rest between shifts', round(v_rule.value / 60, 1)); end if;
  end if;

  v_minutes := extract(epoch from (s.ends_at - s.starts_at)) / 60 - s.break_minutes;
  select * into v_rule from app.active_rule_param(s.agency_id, 'working_time.max_shift', 'max_shift_minutes', shift_date);
  if v_rule.value is not null and v_minutes > v_rule.value then
    if v_rule.severity = 'blocking' then failures := failures || format('Shift exceeds the maximum of %s hours', round(v_rule.value / 60, 1));
    else warnings := warnings || format('Shift exceeds the maximum of %s hours', round(v_rule.value / 60, 1)); end if;
  end if;

  select coalesce(sum(extract(epoch from (a.ends_at - a.starts_at)) / 60), 0) into v_week_minutes
  from public.shift_assignments a
  where a.worker_id = w.id and a.shift_id <> s.id
    and a.status in ('accepted', 'confirmed', 'checked_in', 'checked_out', 'completed', 'replacement_requested', 'disputed')
    and date_trunc('week', a.starts_at at time zone tz) = date_trunc('week', local_start);
  select * into v_rule from app.active_rule_param(s.agency_id, 'working_time.max_weekly', 'max_weekly_minutes', shift_date);
  if v_rule.value is not null and v_week_minutes + v_minutes > v_rule.value then
    if v_rule.severity = 'blocking' then failures := failures || format('Would exceed %s hours this week', round(v_rule.value / 60, 1));
    else warnings := warnings || format('Would exceed %s hours this week', round(v_rule.value / 60, 1)); end if;
  end if;

  -- Soft factors
  if w.home_latitude is not null and loc.latitude is not null then
    v_dist := app.haversine_km(w.home_latitude, w.home_longitude, loc.latitude, loc.longitude);
    if w.max_travel_km is not null and v_dist > w.max_travel_km then
      warnings := warnings || format('Location is %s km away (worker maximum %s km)', v_dist, w.max_travel_km);
    end if;
    score := score + greatest(0, 15 - v_dist / 3);
  end if;

  if exists (select 1 from public.worker_availability av where av.worker_id = w.id and av.kind = 'available'
             and shift_date between av.date_from and av.date_to
             and (av.start_time is null or (av.start_time <= local_start::time and av.end_time >= local_end::time))) then
    v_avail := 'declared_period'; score := score + 15;
  elsif exists (select 1 from public.worker_availability av where av.worker_id = w.id and av.kind = 'recurring'
                and av.day_of_week = extract(isodow from local_start)::int
                and av.start_time <= local_start::time and av.end_time >= local_end::time) then
    v_avail := 'weekly_pattern'; score := score + 10;
  else
    notes := notes || 'No declared availability for this time'::text;
  end if;

  select count(*) into v_prev from public.shift_assignments a join public.shifts s2 on s2.id = a.shift_id
  where a.worker_id = w.id and s2.client_id = s.client_id and a.status = 'completed';
  score := score + least(10, v_prev * 2);
  if v_prev > 0 then notes := notes || format('Worked %s shift(s) for this client before', v_prev); end if;

  return jsonb_build_object(
    'eligible', cardinality(failures) = 0,
    'failures', to_jsonb(failures),
    'warnings', to_jsonb(warnings),
    'notes', to_jsonb(notes),
    'score', round(greatest(0, least(100, score)), 1),
    'explanation', jsonb_build_object('distance_km', v_dist, 'availability', v_avail, 'week_minutes_before', v_week_minutes,
                                      'shift_minutes', v_minutes, 'previous_shifts_at_client', v_prev),
    'rules_version', '2026-11'
  );
end;
$$;

-- Callable by staff with shifts.read, or by the worker for themself.
create or replace function public.evaluate_worker_eligibility(p_shift_position_id uuid, p_worker_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_agency uuid;
begin
  select agency_id into v_agency from public.shift_positions where id = p_shift_position_id;
  if not (app.is_service_role() or app.has_permission(v_agency, 'shifts.read') or app.is_worker_self(p_worker_id)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return app.evaluate_eligibility(p_shift_position_id, p_worker_id);
end;
$$;
revoke all on function public.evaluate_worker_eligibility(uuid, uuid) from public, anon;
grant execute on function public.evaluate_worker_eligibility(uuid, uuid) to authenticated;

create or replace function public.find_eligible_workers(p_shift_position_id uuid, p_include_ineligible boolean default false, p_limit integer default 50)
returns table (worker_id uuid, full_name text, worker_number text, engagement_type public.engagement_type, eligible boolean,
               score numeric, failures jsonb, warnings jsonb, notes jsonb, explanation jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agency uuid;
  w record;
  e jsonb;
begin
  select agency_id into v_agency from public.shift_positions where id = p_shift_position_id;
  if v_agency is null or not (app.is_service_role() or app.has_permission(v_agency, 'shifts.assign')) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  for w in
    select x.id, x.first_name || ' ' || x.last_name as name, x.worker_number, x.engagement_type
    from public.workers x
    where x.agency_id = v_agency and x.status = 'active'
      and not exists (select 1 from public.shift_assignments a join public.shift_positions sp on sp.id = p_shift_position_id
                      where a.shift_id = sp.shift_id and a.worker_id = x.id and a.status not in ('declined', 'cancelled', 'replaced'))
  loop
    e := app.evaluate_eligibility(p_shift_position_id, w.id);
    if p_include_ineligible or (e ->> 'eligible')::boolean then
      worker_id := w.id; full_name := w.name; worker_number := w.worker_number; engagement_type := w.engagement_type;
      eligible := (e ->> 'eligible')::boolean; score := (e ->> 'score')::numeric;
      failures := e -> 'failures'; warnings := e -> 'warnings'; notes := e -> 'notes'; explanation := e -> 'explanation';
      return next;
    end if;
  end loop;
end;
$$;
revoke all on function public.find_eligible_workers(uuid, boolean, integer) from public, anon;
grant execute on function public.find_eligible_workers(uuid, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Rate resolution
-- ---------------------------------------------------------------------------
create or replace function app.resolve_client_rate(p_client uuid, p_position uuid, p_location uuid, p_on date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_card public.client_rate_cards;
  v_base public.client_rate_rules;
  v_rules jsonb;
begin
  select * into v_card from public.client_rate_cards c
  where c.client_id = p_client and c.status = 'active' and c.effective_from <= p_on and (c.effective_to is null or c.effective_to >= p_on)
  order by c.effective_from desc limit 1;
  if v_card.id is null then return null; end if;

  select * into v_base from public.client_rate_rules r
  where r.rate_card_id = v_card.id and r.rule_kind = 'base'
    and (r.position_id is null or r.position_id = p_position) and (r.location_id is null or r.location_id = p_location)
  order by (r.position_id is not null) desc, (r.location_id is not null) desc, r.priority
  limit 1;
  if v_base.id is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object('kind', r.rule_kind, 'hourly_rate', r.hourly_rate, 'multiplier', r.multiplier,
           'days_of_week', r.days_of_week, 'time_from', r.time_from, 'time_to', r.time_to, 'priority', r.priority) order by r.priority), '[]'::jsonb)
    into v_rules
  from public.client_rate_rules r
  where r.rate_card_id = v_card.id and r.rule_kind <> 'base'
    and (r.position_id is null or r.position_id = p_position) and (r.location_id is null or r.location_id = p_location);

  return jsonb_build_object('rate_card_id', v_card.id, 'currency', v_card.currency, 'base_rate', v_base.hourly_rate, 'rules', v_rules);
end;
$$;

create or replace function app.resolve_worker_rate(p_worker uuid, p_position uuid, p_on date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.workers;
  v record;
  v_cost numeric;
begin
  select * into w from public.workers where id = p_worker;
  if w.engagement_type = 'employee' then
    select wr.id, wr.hourly_gross, wr.contract_id into v from public.wage_rates wr
    where wr.worker_id = p_worker and wr.effective_from <= p_on and (wr.effective_to is null or wr.effective_to >= p_on)
      and (wr.position_id is null or wr.position_id = p_position)
    order by (wr.position_id is not null) desc limit 1;
    if v.id is null then return null; end if;
    select coalesce(
      (select ecp.cost_percentage from public.employment_terms et join public.employer_cost_profiles ecp on ecp.id = et.employer_cost_profile_id
       where et.contract_id = v.contract_id),
      (select ecp.cost_percentage from public.employer_cost_profiles ecp
       where ecp.agency_id = w.agency_id and ecp.effective_from <= p_on and (ecp.effective_to is null or ecp.effective_to >= p_on)
       order by ecp.effective_from desc limit 1)) into v_cost;
    return jsonb_build_object('basis', 'employee_wage', 'wage_rate_id', v.id, 'hourly', v.hourly_gross, 'employer_cost_percentage', v_cost);
  else
    select fra.id, fra.hourly_rate, fra.fixed_fee into v from public.freelancer_rate_agreements fra
    join public.freelancer_agreements a on a.id = fra.agreement_id
    join public.freelancer_businesses b on b.id = a.business_id
    where b.worker_id = p_worker and a.status = 'active'
      and fra.effective_from <= p_on and (fra.effective_to is null or fra.effective_to >= p_on)
      and (fra.position_id is null or fra.position_id = p_position)
    order by (fra.position_id is not null) desc limit 1;
    if v.id is null then return null; end if;
    return jsonb_build_object('basis', 'freelancer_rate', 'freelancer_rate_agreement_id', v.id, 'hourly', v.hourly_rate, 'fixed_fee', v.fixed_fee);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shift creation (with optional weekly recurrence)
-- p: {client_id, location_id, title, starts_at, ends_at, break_minutes, dress_code, instructions, status,
--     shift_request_id, positions:[{position_id, headcount, allowed_engagements[], required_skill_ids[],
--     required_language_code, min_experience_months, notes}], recurrence:{days:[1..7], until:'YYYY-MM-DD'}}
-- ---------------------------------------------------------------------------
create or replace function app.create_shifts(p jsonb, p_actor uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_loc public.client_locations;
  v_tz text;
  v_start timestamptz := (p ->> 'starts_at')::timestamptz;
  v_end timestamptz := (p ->> 'ends_at')::timestamptz;
  v_local_start timestamp;
  v_duration interval;
  v_days int[];
  v_until date;
  v_group uuid;
  v_day date;
  v_ids uuid[] := '{}';
  v_shift uuid;
  v_pos jsonb;
  v_status public.shift_status := coalesce(p ->> 'status', 'open')::public.shift_status;
begin
  if v_status not in ('draft', 'open') then raise exception 'New shifts start as draft or open' using errcode = 'P0001'; end if;
  select * into v_client from public.clients where id = (p ->> 'client_id')::uuid;
  if v_client.id is null then raise exception 'Client not found' using errcode = 'P0002'; end if;
  if v_client.status in ('archived', 'on_hold') then raise exception 'Shifts cannot be created for a client that is %', v_client.status using errcode = 'P0001'; end if;
  select * into v_loc from public.client_locations where id = (p ->> 'location_id')::uuid and client_id = v_client.id;
  if v_loc.id is null then raise exception 'Location not found for this client' using errcode = 'P0002'; end if;
  if v_loc.status <> 'active' then raise exception 'This location is not active' using errcode = 'P0001'; end if;
  if jsonb_array_length(coalesce(p -> 'positions', '[]'::jsonb)) = 0 then raise exception 'Add at least one position' using errcode = 'P0001'; end if;
  if v_start < now() - interval '1 hour' then raise exception 'Shifts cannot start in the past' using errcode = 'P0001'; end if;

  select timezone into v_tz from public.agencies where id = v_client.agency_id;
  v_local_start := v_start at time zone v_tz;
  v_duration := v_end - v_start;

  if p ? 'recurrence' and jsonb_typeof(p -> 'recurrence') = 'object' then
    select array_agg(x::int) into v_days from jsonb_array_elements_text(p -> 'recurrence' -> 'days') x;
    v_until := (p -> 'recurrence' ->> 'until')::date;
    if v_until is null or v_days is null then raise exception 'Recurrence needs days and an end date' using errcode = 'P0001'; end if;
    if v_until > v_local_start::date + 366 then raise exception 'Recurring series are limited to one year' using errcode = 'P0001'; end if;
    v_group := gen_random_uuid();
  else
    v_days := array[extract(isodow from v_local_start)::int];
    v_until := v_local_start::date;
  end if;

  v_day := v_local_start::date;
  while v_day <= v_until loop
    if extract(isodow from v_day)::int = any (v_days) then
      if cardinality(v_ids) >= 120 then raise exception 'A series can contain at most 120 shifts' using errcode = 'P0001'; end if;
      insert into public.shifts (agency_id, client_id, location_id, shift_request_id, title, starts_at, ends_at, break_minutes, status,
                                 dress_code, instructions, recurrence_group_id, created_by)
      values (v_client.agency_id, v_client.id, v_loc.id, nullif(p ->> 'shift_request_id', '')::uuid, p ->> 'title',
              (v_day + v_local_start::time) at time zone v_tz,
              ((v_day + v_local_start::time) at time zone v_tz) + v_duration,
              coalesce((p ->> 'break_minutes')::int, 0), v_status, nullif(p ->> 'dress_code', ''), nullif(p ->> 'instructions', ''), v_group, p_actor)
      returning id into v_shift;
      for v_pos in select * from jsonb_array_elements(p -> 'positions') loop
        insert into public.shift_positions (agency_id, shift_id, position_id, headcount, allowed_engagements, required_skill_ids,
                                            required_language_code, min_experience_months, notes)
        values (v_client.agency_id, v_shift, (v_pos ->> 'position_id')::uuid, coalesce((v_pos ->> 'headcount')::int, 1),
                coalesce((select array_agg(x::public.engagement_type) from jsonb_array_elements_text(v_pos -> 'allowed_engagements') x), array['employee']::public.engagement_type[]),
                coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(v_pos -> 'required_skill_ids') x), '{}'),
                nullif(v_pos ->> 'required_language_code', ''), nullif(v_pos ->> 'min_experience_months', '')::int, nullif(v_pos ->> 'notes', ''));
      end loop;
      v_ids := v_ids || v_shift;
    end if;
    v_day := v_day + 1;
  end loop;
  if cardinality(v_ids) = 0 then raise exception 'The recurrence pattern produced no shifts' using errcode = 'P0001'; end if;
  return v_ids;
end;
$$;

create or replace function public.create_shifts(p jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare v_agency uuid;
begin
  select agency_id into v_agency from public.clients where id = (p ->> 'client_id')::uuid;
  if v_agency is null or not app.has_permission(v_agency, 'shifts.write') then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return app.create_shifts(p, auth.uid());
end;
$$;
revoke all on function public.create_shifts(jsonb) from public, anon;
grant execute on function public.create_shifts(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Staffing request review
-- ---------------------------------------------------------------------------
create or replace function public.accept_shift_request(p_request_id uuid, p_title text default null)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.shift_requests;
  v_pos public.job_positions;
  v_ids uuid[];
begin
  select * into r from public.shift_requests where id = p_request_id for update;
  if r.id is null or not app.has_permission(r.agency_id, 'requests.review') or not app.has_permission(r.agency_id, 'shifts.write') then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if r.status not in ('submitted', 'under_review') then raise exception 'Only submitted requests can be accepted' using errcode = 'P0001'; end if;
  select * into v_pos from public.job_positions where id = r.position_id;
  v_ids := app.create_shifts(jsonb_strip_nulls(jsonb_build_object(
    'client_id', r.client_id, 'location_id', r.location_id, 'shift_request_id', r.id,
    'title', coalesce(nullif(p_title, ''), v_pos.name), 'starts_at', r.starts_at, 'ends_at', r.ends_at,
    'break_minutes', r.break_minutes, 'instructions', r.instructions, 'status', 'open', 'recurrence', r.recurrence,
    'positions', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
       'position_id', r.position_id, 'headcount', r.headcount,
       'allowed_engagements', case when v_pos.allows_freelancers then '["employee","freelancer"]'::jsonb else '["employee"]'::jsonb end,
       'required_skill_ids', to_jsonb(r.required_skill_ids), 'required_language_code', r.required_language_code,
       'min_experience_months', r.min_experience_months))))), auth.uid());
  update public.shift_requests set status = 'accepted', reviewed_by = auth.uid(), reviewed_at = now() where id = r.id;
  perform app.notify(r.agency_id, r.requested_by, 'request.accepted', 'Staffing request accepted',
                     format('%s shift(s) have been scheduled. We will confirm the workers.', cardinality(v_ids)),
                     '/client/requests', 'shift_request', r.id, 'request-accepted-' || r.id);
  return v_ids;
end;
$$;
revoke all on function public.accept_shift_request(uuid, text) from public, anon;
grant execute on function public.accept_shift_request(uuid, text) to authenticated;

create or replace function public.reject_shift_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.shift_requests;
begin
  select * into r from public.shift_requests where id = p_request_id for update;
  if r.id is null or not app.has_permission(r.agency_id, 'requests.review') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Give a reason for the rejection' using errcode = 'P0001'; end if;
  update public.shift_requests set status = 'rejected', rejection_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now() where id = r.id;
  perform app.notify(r.agency_id, r.requested_by, 'request.rejected', 'Staffing request could not be accepted', p_reason,
                     '/client/requests', 'shift_request', r.id, 'request-rejected-' || r.id);
end;
$$;
revoke all on function public.reject_shift_request(uuid, text) from public, anon;
grant execute on function public.reject_shift_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Invitations and assignment
-- ---------------------------------------------------------------------------
create or replace function app.check_override(p_agency uuid, p_eval jsonb, p_reason text)
returns boolean  -- true = override used
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (p_eval ->> 'eligible')::boolean then
    raise exception 'Not eligible: %', (select string_agg(x, '; ') from jsonb_array_elements_text(p_eval -> 'failures') x) using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_eval -> 'warnings') = 0 then return false; end if;
  if not app.has_permission(p_agency, 'matching.override') then
    raise exception 'Warnings require an authorised override: %', (select string_agg(x, '; ') from jsonb_array_elements_text(p_eval -> 'warnings') x) using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then
    raise exception 'An override reason of at least 10 characters is required: %', (select string_agg(x, '; ') from jsonb_array_elements_text(p_eval -> 'warnings') x) using errcode = 'P0001';
  end if;
  return true;
end;
$$;

create or replace function public.invite_workers(p_shift_position_id uuid, p_worker_ids uuid[], p_expires_at timestamptz default null, p_override_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sp public.shift_positions;
  s public.shifts;
  v_worker uuid;
  e jsonb;
  v_inv uuid;
  v_invited int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_user uuid;
  v_override boolean;
begin
  select * into sp from public.shift_positions where id = p_shift_position_id;
  if sp.id is null or not app.has_permission(sp.agency_id, 'shifts.assign') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into s from public.shifts where id = sp.shift_id;
  if s.status not in ('open', 'offered', 'partially_filled', 'filled') then
    raise exception 'Invitations can only be sent for open shifts (status: %)', s.status using errcode = 'P0001';
  end if;
  foreach v_worker in array p_worker_ids loop
    e := app.evaluate_eligibility(p_shift_position_id, v_worker);
    begin
      v_override := app.check_override(sp.agency_id, e, p_override_reason);
      insert into public.shift_invitations (agency_id, shift_id, shift_position_id, worker_id, expires_at, invited_by)
      values (sp.agency_id, s.id, sp.id, v_worker, p_expires_at, auth.uid())
      returning id into v_inv;
      insert into public.assignment_eligibility (agency_id, shift_position_id, worker_id, invitation_id, is_eligible, mandatory_failures, warnings, score, explanation, rules_version, evaluated_by)
      values (sp.agency_id, sp.id, v_worker, v_inv, true, e -> 'failures', e -> 'warnings', (e ->> 'score')::numeric,
              (e -> 'explanation') || jsonb_build_object('override_reason', case when v_override then p_override_reason end), e ->> 'rules_version', auth.uid());
      select user_id into v_user from public.workers where id = v_worker;
      perform app.notify(sp.agency_id, v_user, 'shift.invitation', 'New shift offer',
                         format('%s · %s', s.title, to_char(s.starts_at at time zone 'Europe/Amsterdam', 'Dy DD Mon HH24:MI')),
                         '/worker/offers', 'shift_invitation', v_inv, 'invitation-' || v_inv);
      v_invited := v_invited + 1;
    exception
      when unique_violation then
        v_skipped := v_skipped || jsonb_build_object('worker_id', v_worker, 'reason', 'Already invited');
      when raise_exception then
        v_skipped := v_skipped || jsonb_build_object('worker_id', v_worker, 'reason', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('invited', v_invited, 'skipped', v_skipped);
end;
$$;
revoke all on function public.invite_workers(uuid, uuid[], timestamptz, text) from public, anon;
grant execute on function public.invite_workers(uuid, uuid[], timestamptz, text) to authenticated;

create or replace function app.assign_worker(p_shift_position_id uuid, p_worker_id uuid, p_override_reason text, p_replaces uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sp public.shift_positions;
  s public.shifts;
  e jsonb;
  v_override boolean;
  v_id uuid;
  v_user uuid;
begin
  select * into sp from public.shift_positions where id = p_shift_position_id;
  if sp.id is null or not app.has_permission(sp.agency_id, 'shifts.assign') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into s from public.shifts where id = sp.shift_id;
  e := app.evaluate_eligibility(p_shift_position_id, p_worker_id);
  v_override := app.check_override(sp.agency_id, e, p_override_reason);
  insert into public.shift_assignments (agency_id, shift_id, shift_position_id, worker_id, status, starts_at, ends_at, invited_at,
                                        replaces_assignment_id, override_reason, override_by, created_by)
  values (sp.agency_id, s.id, sp.id, p_worker_id, 'invited', s.starts_at, s.ends_at, now(), p_replaces,
          case when v_override then p_override_reason end, case when v_override then auth.uid() end, auth.uid())
  returning id into v_id;
  insert into public.assignment_eligibility (agency_id, shift_position_id, worker_id, assignment_id, is_eligible, mandatory_failures, warnings, score, explanation, rules_version, evaluated_by)
  values (sp.agency_id, sp.id, p_worker_id, v_id, true, e -> 'failures', e -> 'warnings', (e ->> 'score')::numeric,
          (e -> 'explanation') || jsonb_build_object('override_reason', case when v_override then p_override_reason end), e ->> 'rules_version', auth.uid());
  select user_id into v_user from public.workers where id = p_worker_id;
  perform app.notify(sp.agency_id, v_user, 'shift.assigned', 'You have been assigned a shift',
                     format('%s · %s — please accept or decline', s.title, to_char(s.starts_at at time zone 'Europe/Amsterdam', 'Dy DD Mon HH24:MI')),
                     '/worker/offers', 'shift_assignment', v_id, 'assigned-' || v_id);
  return v_id;
exception
  when unique_violation then raise exception 'This worker is already on this shift' using errcode = 'P0001';
  when exclusion_violation then raise exception 'This worker is already booked at an overlapping time' using errcode = 'P0001';
end;
$$;

create or replace function public.assign_worker(p_shift_position_id uuid, p_worker_id uuid, p_override_reason text default null)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select app.assign_worker(p_shift_position_id, p_worker_id, p_override_reason, null)
$$;
revoke all on function public.assign_worker(uuid, uuid, text) from public, anon;
grant execute on function public.assign_worker(uuid, uuid, text) to authenticated;

create or replace function public.withdraw_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare i public.shift_invitations;
begin
  select * into i from public.shift_invitations where id = p_invitation_id for update;
  if i.id is null or not app.has_permission(i.agency_id, 'shifts.assign') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if i.status <> 'pending' then raise exception 'Only pending invitations can be withdrawn' using errcode = 'P0001'; end if;
  update public.shift_invitations set status = 'withdrawn' where id = i.id;
end;
$$;
revoke all on function public.withdraw_invitation(uuid) from public, anon;
grant execute on function public.withdraw_invitation(uuid) to authenticated;

-- Confirmation re-checks eligibility and freezes the commercial terms.
create or replace function public.confirm_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.shift_assignments;
  s public.shifts;
  sp public.shift_positions;
  e jsonb;
  cr jsonb;
  wr jsonb;
  v_date date;
  v_user uuid;
begin
  select * into a from public.shift_assignments where id = p_assignment_id for update;
  if a.id is null or not app.has_permission(a.agency_id, 'shifts.assign') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if a.status <> 'accepted' then raise exception 'Only assignments accepted by the worker can be confirmed (status: %)', a.status using errcode = 'P0001'; end if;
  select * into s from public.shifts where id = a.shift_id;
  select * into sp from public.shift_positions where id = a.shift_position_id;
  v_date := (s.starts_at at time zone (select timezone from public.agencies where id = s.agency_id))::date;

  e := app.evaluate_eligibility(a.shift_position_id, a.worker_id);
  if not (e ->> 'eligible')::boolean then
    raise exception 'Worker is no longer eligible: %', (select string_agg(x, '; ') from jsonb_array_elements_text(e -> 'failures') x) using errcode = 'P0001';
  end if;
  cr := app.resolve_client_rate(s.client_id, sp.position_id, s.location_id, v_date);
  if cr is null then raise exception 'No active client rate card covers this position on %', v_date using errcode = 'P0001'; end if;
  wr := app.resolve_worker_rate(a.worker_id, sp.position_id, v_date);
  if wr is null then raise exception 'No wage or freelancer rate is set for this worker on %', v_date using errcode = 'P0001'; end if;

  insert into public.assignment_eligibility (agency_id, shift_position_id, worker_id, assignment_id, is_eligible, mandatory_failures, warnings, score, explanation, rules_version, evaluated_by)
  values (a.agency_id, a.shift_position_id, a.worker_id, a.id, true, e -> 'failures', e -> 'warnings', (e ->> 'score')::numeric, e -> 'explanation', e ->> 'rules_version', auth.uid());

  insert into public.shift_rate_snapshots (agency_id, assignment_id, currency, client_hourly_rate, client_rate_rules, client_rate_card_id,
                                           worker_pay_basis, worker_hourly_amount, worker_fixed_fee, wage_rate_id, freelancer_rate_agreement_id,
                                           employer_cost_percentage, created_by)
  values (a.agency_id, a.id, coalesce(cr ->> 'currency', 'EUR'), (cr ->> 'base_rate')::numeric, cr -> 'rules', (cr ->> 'rate_card_id')::uuid,
          wr ->> 'basis', (wr ->> 'hourly')::numeric, (wr ->> 'fixed_fee')::numeric, (wr ->> 'wage_rate_id')::uuid,
          (wr ->> 'freelancer_rate_agreement_id')::uuid, (wr ->> 'employer_cost_percentage')::numeric, auth.uid());

  update public.shift_assignments set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid() where id = a.id;

  select user_id into v_user from public.workers where id = a.worker_id;
  perform app.notify(a.agency_id, v_user, 'assignment.confirmed', 'Shift confirmed',
                     format('%s · %s', s.title, to_char(s.starts_at at time zone 'Europe/Amsterdam', 'Dy DD Mon HH24:MI')),
                     '/worker/schedule', 'shift_assignment', a.id, 'confirmed-' || a.id);
  perform app.notify_client_users(s.client_id, s.location_id, null, 'assignment.confirmed', 'Worker confirmed for a shift',
                                  s.title, '/client/shifts/' || s.id, 'shift', s.id, 'client-confirmed-' || a.id);
end;
$$;
revoke all on function public.confirm_assignment(uuid) from public, anon;
grant execute on function public.confirm_assignment(uuid) to authenticated;

create or replace function public.cancel_assignment(p_assignment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.shift_assignments;
  v_user uuid;
begin
  select * into a from public.shift_assignments where id = p_assignment_id for update;
  if a.id is null or not app.has_permission(a.agency_id, 'shifts.assign') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Give a reason for the cancellation' using errcode = 'P0001'; end if;
  perform set_config('shiftpilot.transition_reason', left(p_reason, 500), true);
  update public.shift_assignments set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason where id = a.id;
  select user_id into v_user from public.workers where id = a.worker_id;
  perform app.notify(a.agency_id, v_user, 'shift.cancelled', 'Shift cancelled', p_reason, '/worker/schedule', 'shift_assignment', a.id, 'assignment-cancelled-' || a.id);
end;
$$;
revoke all on function public.cancel_assignment(uuid, text) from public, anon;
grant execute on function public.cancel_assignment(uuid, text) to authenticated;

create or replace function public.mark_no_show(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare a public.shift_assignments;
begin
  select * into a from public.shift_assignments where id = p_assignment_id for update;
  if a.id is null or not (app.has_permission(a.agency_id, 'shifts.assign') or app.has_permission(a.agency_id, 'attendance.correct')) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if a.starts_at > now() then raise exception 'A no-show can only be recorded after the shift has started' using errcode = 'P0001'; end if;
  update public.shift_assignments set status = 'no_show' where id = a.id;
end;
$$;
revoke all on function public.mark_no_show(uuid) from public, anon;
grant execute on function public.mark_no_show(uuid) to authenticated;

-- Client users (request capability), the worker, or staff may request a replacement.
create or replace function public.request_replacement(p_assignment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.shift_assignments;
  s public.shifts;
begin
  select * into a from public.shift_assignments where id = p_assignment_id for update;
  if a.id is null then raise exception 'Assignment not found' using errcode = 'P0002'; end if;
  select * into s from public.shifts where id = a.shift_id;
  if not (app.has_permission(a.agency_id, 'shifts.assign') or app.is_worker_self(a.worker_id)
          or (app.client_can(s.client_id, 'request') and app.client_location_allowed(s.client_id, s.location_id))) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Give a reason' using errcode = 'P0001'; end if;
  if a.status <> 'confirmed' then raise exception 'Only confirmed assignments can be replaced' using errcode = 'P0001'; end if;
  perform set_config('shiftpilot.transition_reason', left(p_reason, 500), true);
  update public.shift_assignments set status = 'replacement_requested' where id = a.id;
  perform app.notify_permission_holders(a.agency_id, 'shifts.assign', 'assignment.replacement_requested', 'Replacement requested',
                                        format('%s: %s', s.title, p_reason), '/admin/shifts/' || s.id, 'shift', s.id, 'replacement-' || a.id);
end;
$$;
revoke all on function public.request_replacement(uuid, text) from public, anon;
grant execute on function public.request_replacement(uuid, text) to authenticated;

create or replace function public.replace_assignment(p_assignment_id uuid, p_new_worker_id uuid, p_override_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.shift_assignments;
  v_user uuid;
begin
  select * into a from public.shift_assignments where id = p_assignment_id for update;
  if a.id is null or not app.has_permission(a.agency_id, 'shifts.assign') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if a.status = 'confirmed' then
    update public.shift_assignments set status = 'replacement_requested' where id = a.id;
  elsif a.status <> 'replacement_requested' then
    raise exception 'Only confirmed assignments can be replaced (status: %)', a.status using errcode = 'P0001';
  end if;
  update public.shift_assignments set status = 'replaced' where id = a.id;
  select user_id into v_user from public.workers where id = a.worker_id;
  perform app.notify(a.agency_id, v_user, 'shift.cancelled', 'You have been replaced on a shift', 'The agency has arranged a replacement.',
                     '/worker/schedule', 'shift_assignment', a.id, 'replaced-' || a.id);
  return app.assign_worker(a.shift_position_id, p_new_worker_id, p_override_reason, a.id);
end;
$$;
revoke all on function public.replace_assignment(uuid, uuid, text) from public, anon;
grant execute on function public.replace_assignment(uuid, uuid, text) to authenticated;

-- Notify assigned workers and clients when a shift is rescheduled or cancelled.
create or replace function app.notify_shift_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    for r in select a.id, w.user_id from public.shift_assignments a join public.workers w on w.id = a.worker_id
             -- runs before trg_shifts_sync_assignments cancels them (trigger names sort alphabetically)
             where a.shift_id = new.id and a.status in ('invited', 'accepted', 'confirmed', 'replacement_requested') loop
      perform app.notify(new.agency_id, r.user_id, 'shift.cancelled', 'Shift cancelled', new.title || ': ' || new.cancellation_reason,
                         '/worker/schedule', 'shift', new.id, 'shift-cancelled-' || new.id || '-' || r.id);
    end loop;
    perform app.notify_client_users(new.client_id, new.location_id, null, 'shift.cancelled', 'Shift cancelled', new.title,
                                    '/client/shifts/' || new.id, 'shift', new.id, 'client-shift-cancelled-' || new.id);
  elsif new.starts_at <> old.starts_at or new.ends_at <> old.ends_at then
    for r in select a.id, w.user_id from public.shift_assignments a join public.workers w on w.id = a.worker_id
             where a.shift_id = new.id and a.status in ('invited', 'accepted', 'confirmed') loop
      perform app.notify(new.agency_id, r.user_id, 'shift.changed', 'Shift time changed',
                         format('%s now starts %s', new.title, to_char(new.starts_at at time zone 'Europe/Amsterdam', 'Dy DD Mon HH24:MI')),
                         '/worker/schedule', 'shift', new.id, 'shift-changed-' || new.id || '-' || extract(epoch from new.starts_at)::bigint || '-' || r.id);
    end loop;
  end if;
  return new;
end;
$$;
create trigger trg_shifts_notify after update on public.shifts
  for each row execute function app.notify_shift_change();

-- Notify the agency when a worker responds.
create or replace function app.notify_assignment_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare s public.shifts;
begin
  if new.status in ('accepted', 'declined') and old.status is distinct from new.status then
    select * into s from public.shifts where id = new.shift_id;
    perform app.notify_permission_holders(new.agency_id, 'shifts.assign', 'assignment.' || new.status,
                                          case when new.status = 'accepted' then 'Shift accepted — please confirm' else 'Shift declined' end,
                                          s.title, '/admin/shifts/' || s.id, 'shift', s.id, 'assignment-' || new.status || '-' || new.id);
  end if;
  return new;
end;
$$;
create trigger trg_shift_assignments_notify after update of status on public.shift_assignments
  for each row execute function app.notify_assignment_response();

-- New client requests notify reviewers.
create or replace function app.notify_new_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted') then
    perform app.notify_permission_holders(new.agency_id, 'requests.review', 'request.submitted',
      case when new.is_urgent then 'URGENT staffing request' else 'New staffing request' end,
      format('%s worker(s) requested', new.headcount), '/admin/requests/' || new.id, 'shift_request', new.id, 'request-submitted-' || new.id);
  end if;
  return new;
end;
$$;
create trigger trg_shift_requests_notify after insert or update of status on public.shift_requests
  for each row execute function app.notify_new_request();

-- Workers may only see their own eligibility rows; clients none.
create policy assignment_eligibility_worker_select on public.assignment_eligibility for select to authenticated
  using (app.is_worker_self(worker_id));
