-- ============================================================================
-- ShiftPilot — 0028 Engagement and branding
--   * agency_branding: brand colour, logo, portal welcome texts, invoice footer
--   * messaging RPCs (start / send / read) on the existing conversation tables
--   * client feedback: worker ratings and preferred / blocked workers, used by
--     matching (blocked = ineligible for that client, preferred ranks higher)
--   * announcements from the agency to workers, clients and staff
--   * personal calendar (ICS) feeds for workers
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Branding
-- ---------------------------------------------------------------------------
create table public.agency_branding (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  brand_color text check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_data text check (logo_data is null or length(logo_data) <= 400000),
  logo_mime text check (logo_mime in ('image/png', 'image/jpeg')),
  logo_updated_at timestamptz,
  worker_welcome text check (length(worker_welcome) <= 500),
  client_welcome text check (length(client_welcome) <= 500),
  invoice_footer text check (length(invoice_footer) <= 300),
  updated_at timestamptz not null default now(),
  check ((logo_data is null) = (logo_mime is null))
);
alter table public.agency_branding enable row level security;
select app.attach_standard_triggers('public.agency_branding');
create policy agency_branding_select on public.agency_branding for select to authenticated
  using (app.is_agency_participant(agency_id));
create policy agency_branding_insert on public.agency_branding for insert to authenticated
  with check (app.has_permission(agency_id, 'agency.settings.manage'));
create policy agency_branding_update on public.agency_branding for update to authenticated
  using (app.has_permission(agency_id, 'agency.settings.manage'))
  with check (app.has_permission(agency_id, 'agency.settings.manage'));
grant select, insert, update on public.agency_branding to authenticated;

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column worker_id uuid references public.workers(id) on delete cascade,
  add column client_id uuid references public.clients(id) on delete cascade,
  add constraint conversations_party_chk check (num_nonnulls(worker_id, client_id) <= 1);
create index conversations_agency_updated_idx on public.conversations (agency_id, updated_at desc);

-- Participants are only ever added by the messaging functions below (or staff).
drop policy if exists conversation_participants_insert on public.conversation_participants;
create policy conversation_participants_insert on public.conversation_participants for insert to authenticated
  with check (app.has_permission(agency_id, 'shifts.read'));

-- Portal link for a recipient: staff → Admin HQ, worker → worker portal, else client portal.
create or replace function app.message_link(p_agency uuid, p_user uuid, p_conversation uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.user_roles ur where ur.agency_id = p_agency and ur.user_id = p_user) then '/admin/messages/'
    when exists (select 1 from public.workers w where w.agency_id = p_agency and w.user_id = p_user and w.status <> 'archived') then '/worker/messages/'
    else '/client/messages/' end || p_conversation::text
$$;

create or replace function app.notify_new_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages;
  c public.conversations;
  v_sender text;
  r record;
  v_staff_present boolean;
begin
  select * into m from public.messages where id = p_message_id;
  select * into c from public.conversations where id = m.conversation_id;
  select coalesce(p.full_name, 'Someone') into v_sender from public.profiles p where p.id = m.sender_user_id;
  for r in
    select cp.user_id from public.conversation_participants cp
    where cp.conversation_id = c.id and cp.user_id <> m.sender_user_id
      and (not m.is_internal or exists (select 1 from public.user_roles ur where ur.agency_id = c.agency_id and ur.user_id = cp.user_id))
  loop
    perform app.notify(c.agency_id, r.user_id, 'message.received', 'New message from ' || v_sender,
                       left(m.body, 200), app.message_link(c.agency_id, r.user_id, c.id), 'conversation', c.id, 'msg:' || m.id);
  end loop;
  -- A worker or client wrote and no staff member has joined yet: tell the team.
  select exists (select 1 from public.conversation_participants cp join public.user_roles ur
                 on ur.user_id = cp.user_id and ur.agency_id = c.agency_id
                 where cp.conversation_id = c.id) into v_staff_present;
  if not v_staff_present and not m.is_internal then
    perform app.notify_permission_holders(c.agency_id, 'shifts.read', 'message.received', 'New message from ' || v_sender,
                                          left(m.body, 200), '/admin/messages/' || c.id, 'conversation', c.id, 'msg:' || m.id);
  end if;
end;
$$;

/**
 * Starts a conversation.
 *  - Staff (shifts.read) start it with one worker (p_worker_id) or with a client's portal users (p_client_id).
 *  - A worker starts it with their agency (no party arguments needed).
 *  - A client user starts it with the agency for their client (p_client_id).
 */
create or replace function public.start_conversation(p_agency_id uuid, p_subject text, p_body text,
                                                     p_worker_id uuid default null, p_client_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
  v_msg uuid;
  v_worker public.workers;
  v_staff boolean;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if length(coalesce(trim(p_body), '')) = 0 then raise exception 'Write a message' using errcode = '22023'; end if;
  if num_nonnulls(p_worker_id, p_client_id) > 1 then raise exception 'Choose a worker or a client, not both' using errcode = '22023'; end if;
  v_staff := app.has_permission(p_agency_id, 'shifts.read');

  if v_staff then
    if p_worker_id is not null then
      select * into v_worker from public.workers where id = p_worker_id and agency_id = p_agency_id;
      if v_worker.id is null then raise exception 'Worker not found' using errcode = 'P0002'; end if;
      if v_worker.user_id is null then raise exception 'This worker has no portal account yet — invite them first' using errcode = '22023'; end if;
    elsif p_client_id is not null then
      if not exists (select 1 from public.clients where id = p_client_id and agency_id = p_agency_id) then
        raise exception 'Client not found' using errcode = 'P0002';
      end if;
      if not exists (select 1 from public.client_memberships where client_id = p_client_id and status = 'active') then
        raise exception 'This client has no portal users yet' using errcode = '22023';
      end if;
    else
      raise exception 'Choose a worker or a client' using errcode = '22023';
    end if;
  elsif exists (select 1 from public.workers w where w.agency_id = p_agency_id and w.user_id = v_uid and w.status <> 'archived') then
    if p_client_id is not null then raise exception 'Not allowed' using errcode = '42501'; end if;
    select * into v_worker from public.workers w where w.agency_id = p_agency_id and w.user_id = v_uid and w.status <> 'archived' limit 1;
    p_worker_id := v_worker.id;
  elsif p_client_id is not null and app.is_client_member(p_client_id)
        and exists (select 1 from public.clients where id = p_client_id and agency_id = p_agency_id) then
    p_worker_id := null;
  else
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  insert into public.conversations (agency_id, subject, context_type, created_by, worker_id, client_id)
  values (p_agency_id, nullif(left(trim(coalesce(p_subject, '')), 160), ''), 'general', v_uid, p_worker_id, p_client_id)
  returning id into v_conv;

  insert into public.conversation_participants (conversation_id, agency_id, user_id, last_read_at)
  values (v_conv, p_agency_id, v_uid, now());
  if v_staff and p_worker_id is not null then
    insert into public.conversation_participants (conversation_id, agency_id, user_id) values (v_conv, p_agency_id, v_worker.user_id)
    on conflict do nothing;
  elsif p_client_id is not null then
    insert into public.conversation_participants (conversation_id, agency_id, user_id)
    select v_conv, p_agency_id, m.user_id from public.client_memberships m where m.client_id = p_client_id and m.status = 'active'
    on conflict do nothing;
  end if;

  insert into public.messages (agency_id, conversation_id, sender_user_id, body)
  values (p_agency_id, v_conv, v_uid, left(trim(p_body), 5000)) returning id into v_msg;
  perform app.notify_new_message(v_msg);
  return v_conv;
end;
$$;

create or replace function public.send_message(p_conversation_id uuid, p_body text, p_internal boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.conversations;
  v_msg uuid;
  v_staff boolean;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if length(coalesce(trim(p_body), '')) = 0 then raise exception 'Write a message' using errcode = '22023'; end if;
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null then raise exception 'Conversation not found' using errcode = 'P0002'; end if;
  v_staff := app.has_permission(c.agency_id, 'shifts.read');
  if not v_staff and not app.is_conversation_participant(c.id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_internal and not v_staff then raise exception 'Only agency staff can write internal notes' using errcode = '42501'; end if;
  if v_staff then
    insert into public.conversation_participants (conversation_id, agency_id, user_id) values (c.id, c.agency_id, v_uid)
    on conflict do nothing;
  end if;
  insert into public.messages (agency_id, conversation_id, sender_user_id, body, is_internal)
  values (c.agency_id, c.id, v_uid, left(trim(p_body), 5000), coalesce(p_internal, false)) returning id into v_msg;
  update public.conversations set updated_at = now() where id = c.id;
  update public.conversation_participants set last_read_at = now() where conversation_id = c.id and user_id = v_uid;
  perform app.notify_new_message(v_msg);
  return v_msg;
end;
$$;

-- Opening a thread marks it read. Staff who open a thread join it, so they
-- are notified of replies.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_agency uuid;
begin
  select agency_id into v_agency from public.conversations where id = p_conversation_id;
  if v_agency is null then return; end if;
  if app.has_permission(v_agency, 'shifts.read') then
    insert into public.conversation_participants (conversation_id, agency_id, user_id, last_read_at)
    values (p_conversation_id, v_agency, auth.uid(), now())
    on conflict (conversation_id, user_id) do update set last_read_at = now();
  else
    update public.conversation_participants set last_read_at = now()
    where conversation_id = p_conversation_id and user_id = auth.uid();
  end if;
end;
$$;

-- Inbox for the caller. SECURITY INVOKER: row-level security decides what is listed.
create or replace function public.my_conversations(p_agency_id uuid)
returns table (id uuid, subject text, worker_id uuid, client_id uuid, party_name text, updated_at timestamptz,
               last_body text, last_sender text, last_at timestamptz, unread boolean, is_participant boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.subject, c.worker_id, c.client_id,
         coalesce((select coalesce(w.display_name, w.first_name || ' ' || w.last_name) from public.workers w where w.id = c.worker_id),
                  (select cl.name from public.clients cl where cl.id = c.client_id)),
         c.updated_at, lm.body, lm.sender, lm.created_at,
         -- Unread: a newer message from someone else. For staff who have not joined the
         -- thread, only messages from the worker / client count (they await a reply).
         coalesce(lm.created_at > coalesce(me.last_read_at, '-infinity'::timestamptz)
                  and lm.sender_user_id is distinct from auth.uid()
                  and (me.user_id is not null
                       or not exists (select 1 from public.user_roles ur where ur.user_id = lm.sender_user_id and ur.agency_id = c.agency_id)), false),
         me.user_id is not null
  from public.conversations c
  left join public.conversation_participants me on me.conversation_id = c.id and me.user_id = auth.uid()
  left join lateral (
    select m.body, m.created_at, m.sender_user_id, p.full_name as sender
    from public.messages m left join public.profiles p on p.id = m.sender_user_id
    where m.conversation_id = c.id order by m.created_at desc limit 1
  ) lm on true
  where c.agency_id = p_agency_id
  order by coalesce(lm.created_at, c.updated_at) desc
  limit 200
$$;

-- Sender names for a conversation's messages (profiles are otherwise private).
create or replace function public.conversation_senders(p_conversation_id uuid)
returns table (user_id uuid, full_name text, is_staff boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select cp.user_id, coalesce(p.full_name, p.email::text), exists (select 1 from public.user_roles ur where ur.user_id = cp.user_id and ur.agency_id = c.agency_id)
  from public.conversations c
  join public.conversation_participants cp on cp.conversation_id = c.id
  left join public.profiles p on p.id = cp.user_id
  where c.id = p_conversation_id
    and (app.is_conversation_participant(c.id) or app.has_permission(c.agency_id, 'shifts.read'))
$$;

revoke all on function public.start_conversation(uuid, text, text, uuid, uuid) from public, anon;
revoke all on function public.send_message(uuid, text, boolean) from public, anon;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
revoke all on function public.my_conversations(uuid) from public, anon;
revoke all on function public.conversation_senders(uuid) from public, anon;
revoke all on function app.notify_new_message(uuid) from public, anon, authenticated;
grant execute on function public.start_conversation(uuid, text, text, uuid, uuid) to authenticated;
grant execute on function public.send_message(uuid, text, boolean) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.my_conversations(uuid) to authenticated;
grant execute on function public.conversation_senders(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Client feedback: ratings and preferred / blocked workers
-- ---------------------------------------------------------------------------
create table public.worker_ratings (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  assignment_id uuid not null unique references public.shift_assignments(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (length(comment) <= 1000),
  rated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index worker_ratings_worker_idx on public.worker_ratings (worker_id);
alter table public.worker_ratings enable row level security;
select app.attach_standard_triggers('public.worker_ratings');
create policy worker_ratings_select on public.worker_ratings for select to authenticated
  using (app.has_permission(agency_id, 'workers.read') or app.is_client_member(client_id) or app.is_worker_self(worker_id));
grant select on public.worker_ratings to authenticated;

create table public.client_worker_preferences (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  kind text not null check (kind in ('preferred', 'blocked')),
  reason text check (length(reason) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, worker_id)
);
alter table public.client_worker_preferences enable row level security;
select app.attach_standard_triggers('public.client_worker_preferences');
-- Workers never see these rows.
create policy client_worker_preferences_select on public.client_worker_preferences for select to authenticated
  using (app.has_permission(agency_id, 'clients.read') or app.is_client_member(client_id));
create policy client_worker_preferences_delete on public.client_worker_preferences for delete to authenticated
  using (app.has_permission(agency_id, 'clients.write') or app.client_can(client_id, 'request'));
grant select, delete on public.client_worker_preferences to authenticated;

-- A client may rate a worker for an assignment at its own location once the shift is done.
create or replace function public.rate_assignment(p_assignment_id uuid, p_rating integer, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.shift_assignments;
  s public.shifts;
begin
  select * into a from public.shift_assignments where id = p_assignment_id;
  if a.id is null then raise exception 'Assignment not found' using errcode = 'P0002'; end if;
  select * into s from public.shifts where id = a.shift_id;
  if not app.client_location_allowed(s.client_id, s.location_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if a.status not in ('checked_out', 'completed') then raise exception 'You can rate a worker once the shift is finished' using errcode = '22023'; end if;
  if p_rating not between 1 and 5 then raise exception 'Rating must be between 1 and 5' using errcode = '22023'; end if;
  insert into public.worker_ratings (agency_id, assignment_id, client_id, worker_id, rating, comment, rated_by)
  values (a.agency_id, a.id, s.client_id, a.worker_id, p_rating, nullif(left(trim(coalesce(p_comment, '')), 1000), ''), auth.uid())
  on conflict (assignment_id) do update set rating = excluded.rating, comment = excluded.comment, rated_by = excluded.rated_by;
end;
$$;

-- Staff (clients.write) or a client user who may request staff marks a worker as
-- preferred or blocked. Clients can only choose workers who have worked for them.
create or replace function public.set_worker_preference(p_client_id uuid, p_worker_id uuid, p_kind text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency uuid;
  v_staff boolean;
begin
  select agency_id into v_agency from public.clients where id = p_client_id;
  if v_agency is null then raise exception 'Client not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.workers where id = p_worker_id and agency_id = v_agency) then
    raise exception 'Worker not found' using errcode = 'P0002';
  end if;
  v_staff := app.has_permission(v_agency, 'clients.write');
  if not v_staff then
    if not app.client_can(p_client_id, 'request') then raise exception 'Not allowed' using errcode = '42501'; end if;
    if not exists (select 1 from public.shift_assignments a join public.shifts s on s.id = a.shift_id
                   where a.worker_id = p_worker_id and s.client_id = p_client_id
                     and a.status in ('confirmed', 'checked_in', 'checked_out', 'completed', 'disputed')) then
      raise exception 'You can only choose workers who have worked for you' using errcode = '42501';
    end if;
  end if;
  if p_kind is null then
    delete from public.client_worker_preferences where client_id = p_client_id and worker_id = p_worker_id;
    return;
  end if;
  if p_kind not in ('preferred', 'blocked') then raise exception 'Unknown preference' using errcode = '22023'; end if;
  insert into public.client_worker_preferences (agency_id, client_id, worker_id, kind, reason, created_by)
  values (v_agency, p_client_id, p_worker_id, p_kind, nullif(left(trim(coalesce(p_reason, '')), 500), ''), auth.uid())
  on conflict (client_id, worker_id) do update set kind = excluded.kind, reason = excluded.reason, created_by = excluded.created_by;
end;
$$;

-- Workers who have worked for a client, as the client sees them (display name only).
create or replace function public.client_worker_overview(p_client_id uuid)
returns table (worker_id uuid, display_name text, shifts_worked integer, last_worked_at timestamptz,
               average_rating numeric, preference text, preference_reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, coalesce(w.display_name, w.first_name || ' ' || left(w.last_name, 1) || '.'),
         count(distinct a.id)::int, max(a.starts_at),
         (select round(avg(r.rating), 1) from public.worker_ratings r where r.worker_id = w.id and r.client_id = p_client_id),
         cp.kind, cp.reason
  from public.shift_assignments a
  join public.shifts s on s.id = a.shift_id
  join public.workers w on w.id = a.worker_id
  left join public.client_worker_preferences cp on cp.client_id = p_client_id and cp.worker_id = w.id
  where s.client_id = p_client_id
    and a.status in ('confirmed', 'checked_in', 'checked_out', 'completed', 'disputed')
    and app.is_client_member(p_client_id)
    and app.client_location_allowed(s.client_id, s.location_id)
  group by w.id, w.display_name, w.first_name, w.last_name, cp.kind, cp.reason
  order by max(a.starts_at) desc
$$;

-- Finished assignments at the client's (permitted) locations in the last 60 days, for rating.
create or replace function public.client_recent_assignments(p_client_id uuid)
returns table (assignment_id uuid, worker_id uuid, display_name text, shift_title text, location_name text,
               starts_at timestamptz, rating smallint, comment text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, w.id, coalesce(w.display_name, w.first_name || ' ' || left(w.last_name, 1) || '.'), s.title, loc.name,
         a.starts_at, r.rating, r.comment
  from public.shift_assignments a
  join public.shifts s on s.id = a.shift_id
  join public.client_locations loc on loc.id = s.location_id
  join public.workers w on w.id = a.worker_id
  left join public.worker_ratings r on r.assignment_id = a.id
  where s.client_id = p_client_id
    and a.status in ('checked_out', 'completed')
    and a.starts_at > now() - interval '60 days'
    and app.client_location_allowed(s.client_id, s.location_id)
  order by a.starts_at desc
  limit 100
$$;
revoke all on function public.client_recent_assignments(uuid) from public, anon;
grant execute on function public.client_recent_assignments(uuid) to authenticated;

revoke all on function public.rate_assignment(uuid, integer, text) from public, anon;
revoke all on function public.set_worker_preference(uuid, uuid, text, text) from public, anon;
revoke all on function public.client_worker_overview(uuid) from public, anon;
grant execute on function public.rate_assignment(uuid, integer, text) to authenticated;
grant execute on function public.set_worker_preference(uuid, uuid, text, text) to authenticated;
grant execute on function public.client_worker_overview(uuid) to authenticated;

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
  v_pref text;
  v_rating numeric;
  v_ratings integer;
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

  -- Client preferences: a blocked worker is never offered to that client;
  -- preferred workers and well-rated workers rank higher.
  select cp.kind into v_pref from public.client_worker_preferences cp where cp.client_id = s.client_id and cp.worker_id = w.id;
  if v_pref = 'blocked' then
    failures := failures || 'The client has asked not to receive this worker'::text;
  elsif v_pref = 'preferred' then
    score := score + 20; notes := notes || 'Preferred by this client'::text;
  end if;
  select avg(wr.rating), count(*) into v_rating, v_ratings from public.worker_ratings wr where wr.worker_id = w.id;
  if v_ratings > 0 then
    score := score + (v_rating - 3) * 4;
    notes := notes || format('Average client rating %s/5 (%s)', round(v_rating, 1), v_ratings);
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
                                      'shift_minutes', v_minutes, 'previous_shifts_at_client', v_prev,
                                      'client_preference', v_pref, 'average_rating', round(v_rating, 1)),
    'rules_version', '2026-11'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  title text not null check (length(title) between 1 and 160),
  body text not null check (length(body) between 1 and 5000),
  audience text not null check (audience in ('everyone', 'workers', 'clients', 'staff')),
  pinned boolean not null default false,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > published_at)
);
create index announcements_agency_idx on public.announcements (agency_id, published_at desc);
alter table public.announcements enable row level security;
select app.attach_standard_triggers('public.announcements');

create or replace function app.announcement_visible(p_agency uuid, p_audience text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_audience
    when 'everyone' then app.is_agency_participant(p_agency)
    when 'staff' then app.is_agency_member(p_agency)
    when 'workers' then exists (select 1 from public.workers w where w.agency_id = p_agency and w.user_id = auth.uid() and w.status <> 'archived')
                        or app.is_agency_member(p_agency)
    when 'clients' then exists (select 1 from public.client_memberships m where m.agency_id = p_agency and m.user_id = auth.uid() and m.status = 'active')
                        or app.is_agency_member(p_agency)
    else false end
$$;
grant execute on function app.announcement_visible(uuid, text) to authenticated;

create policy announcements_select on public.announcements for select to authenticated
  using (app.has_permission(agency_id, 'notifications.manage')
         or (published_at <= now() and (expires_at is null or expires_at > now()) and app.announcement_visible(agency_id, audience)));
create policy announcements_insert on public.announcements for insert to authenticated
  with check (app.has_permission(agency_id, 'notifications.manage') and created_by = auth.uid());
create policy announcements_update on public.announcements for update to authenticated
  using (app.has_permission(agency_id, 'notifications.manage'))
  with check (app.has_permission(agency_id, 'notifications.manage'));
create policy announcements_delete on public.announcements for delete to authenticated
  using (app.has_permission(agency_id, 'notifications.manage'));
grant select, insert, update, delete on public.announcements to authenticated;

-- Notify the audience when an announcement is published.
create or replace function app.notify_announcement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in
    select distinct u.user_id, u.link from (
      select ur.user_id, '/admin/announcements' as link from public.user_roles ur
        where ur.agency_id = new.agency_id and new.audience in ('everyone', 'staff')
      union all
      select w.user_id, '/worker' from public.workers w
        where w.agency_id = new.agency_id and w.user_id is not null and w.status = 'active' and new.audience in ('everyone', 'workers')
      union all
      select m.user_id, '/client' from public.client_memberships m
        where m.agency_id = new.agency_id and m.status = 'active' and new.audience in ('everyone', 'clients')
    ) u
    where u.user_id is distinct from new.created_by
  loop
    perform app.notify(new.agency_id, r.user_id, 'announcement.published', new.title, left(new.body, 300), r.link,
                       'announcement', new.id, 'announcement:' || new.id);
  end loop;
  return new;
end;
$$;
create trigger trg_announcements_notify after insert on public.announcements
  for each row execute function app.notify_announcement();

-- ---------------------------------------------------------------------------
-- Calendar feeds (ICS). The app stores only a SHA-256 hash of the secret token.
-- ---------------------------------------------------------------------------
create table public.calendar_feeds (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.calendar_feeds enable row level security;
create policy calendar_feeds_own on public.calendar_feeds for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.calendar_feeds to authenticated;

-- Called by the calendar route without a session; the token hash is the credential.
create or replace function public.calendar_feed_events(p_token_hash text)
returns table (assignment_id uuid, status text, starts_at timestamptz, ends_at timestamptz, title text, position_name text,
               client_name text, location_name text, location_address text, instructions text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then return; end if;
  select f.user_id into v_user from public.calendar_feeds f where f.token_hash = p_token_hash;
  if v_user is null then return; end if;
  update public.calendar_feeds set last_used_at = now() where user_id = v_user and (last_used_at is null or last_used_at < now() - interval '1 hour');
  return query
    select a.id, a.status::text, a.starts_at, a.ends_at, s.title, jp.name, cl.name, loc.name,
           concat_ws(', ', loc.address_line1, concat_ws(' ', loc.postal_code, loc.city)), s.instructions,
           greatest(a.updated_at, s.updated_at)
    from public.shift_assignments a
    join public.workers w on w.id = a.worker_id
    join public.shifts s on s.id = a.shift_id
    join public.shift_positions sp on sp.id = a.shift_position_id
    join public.job_positions jp on jp.id = sp.position_id
    join public.clients cl on cl.id = s.client_id
    join public.client_locations loc on loc.id = s.location_id
    where w.user_id = v_user and w.status <> 'archived'
      and a.status in ('accepted', 'confirmed', 'checked_in', 'checked_out', 'completed', 'replacement_requested', 'disputed')
      and a.starts_at > now() - interval '60 days' and a.starts_at < now() + interval '180 days'
    order by a.starts_at;
end;
$$;
revoke all on function public.calendar_feed_events(text) from public;
grant execute on function public.calendar_feed_events(text) to anon, authenticated;

-- None of the new tables are for anonymous visitors.
revoke all on public.agency_branding, public.worker_ratings, public.client_worker_preferences,
              public.announcements, public.calendar_feeds from anon;
