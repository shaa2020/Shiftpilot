-- ============================================================================
-- ShiftPilot — 0019 Attendance and timesheet engine
--   * record_attendance(): server-authoritative, idempotent check-in/out and
--     breaks; offline events keep their device time and are flagged; location
--     is stored only when the agency enabled verification
--   * timesheets generated at check-out and submitted to the client
--   * client approval / dispute, agency approval, corrections (adjustments
--     after approval — never silent edits)
--   * shift lifecycle follows attendance (in_progress → completed →
--     awaiting_approval → approved)
--   * client and worker projections (no wages to clients, own pay to workers)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Timesheet calculation
-- ---------------------------------------------------------------------------
create or replace function app.recalculate_timesheet(p_timesheet_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
  v_scheduled_worked integer;
  v_worked integer;
  v_threshold integer;
begin
  select * into t from public.timesheets where id = p_timesheet_id;
  if t.actual_start is null or t.actual_end is null then return; end if;
  select late_threshold_minutes into v_threshold from public.agency_settings where agency_id = t.agency_id;
  v_scheduled_worked := (extract(epoch from (t.scheduled_end - t.scheduled_start)) / 60)::int - t.scheduled_break_minutes;
  v_worked := greatest(0, (extract(epoch from (t.actual_end - t.actual_start)) / 60)::int - t.break_minutes);
  update public.timesheets set
    worked_minutes = v_worked,
    overtime_minutes = greatest(0, v_worked - v_scheduled_worked),
    late_minutes = case when (extract(epoch from (t.actual_start - t.scheduled_start)) / 60)::int > coalesce(v_threshold, 0)
                        then (extract(epoch from (t.actual_start - t.scheduled_start)) / 60)::int else 0 end,
    early_departure_minutes = greatest(0, (extract(epoch from (t.scheduled_end - t.actual_end)) / 60)::int)
  where id = t.id;
  if t.status = 'draft' then
    delete from public.timesheet_entries where timesheet_id = t.id;
    insert into public.timesheet_entries (agency_id, timesheet_id, entry_kind, minutes)
    values (t.agency_id, t.id, 'regular', least(v_worked, v_scheduled_worked));
    if v_worked > v_scheduled_worked then
      insert into public.timesheet_entries (agency_id, timesheet_id, entry_kind, minutes) values (t.agency_id, t.id, 'overtime', v_worked - v_scheduled_worked);
    end if;
  end if;
end;
$$;

create or replace function app.build_timesheet(p_assignment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.shift_assignments;
  s public.shifts;
  v_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_breaks integer;
  v_has_breaks boolean;
  v_offline boolean;
begin
  select * into a from public.shift_assignments where id = p_assignment_id;
  select * into s from public.shifts where id = a.shift_id;
  -- Offline events count from the device time (flagged for review); online events from server time.
  select min(case when e.is_offline_sync then e.device_recorded_at else e.server_recorded_at end) into v_start
  from public.attendance_events e where e.assignment_id = a.id and e.event_type = 'check_in';
  select max(case when e.is_offline_sync then e.device_recorded_at else e.server_recorded_at end) into v_end
  from public.attendance_events e where e.assignment_id = a.id and e.event_type = 'check_out';
  select bool_or(e.is_offline_sync) into v_offline from public.attendance_events e where e.assignment_id = a.id;
  select coalesce(sum(minutes), 0), count(*) > 0 into v_breaks, v_has_breaks from public.break_records where assignment_id = a.id and ended_at is not null;

  insert into public.timesheets (agency_id, assignment_id, shift_id, worker_id, client_id, location_id, status, scheduled_start, scheduled_end,
                                 scheduled_break_minutes, actual_start, actual_end, break_minutes, has_offline_events)
  values (a.agency_id, a.id, s.id, a.worker_id, s.client_id, s.location_id, 'draft', s.starts_at, s.ends_at, s.break_minutes,
          v_start, v_end, case when v_has_breaks then v_breaks else s.break_minutes end, coalesce(v_offline, false))
  on conflict (assignment_id) do update set actual_start = excluded.actual_start, actual_end = excluded.actual_end,
    break_minutes = excluded.break_minutes, has_offline_events = excluded.has_offline_events
  returning id into v_id;
  perform app.recalculate_timesheet(v_id);
  update public.timesheets set status = 'submitted', submitted_at = now() where id = v_id and status = 'draft';
  perform app.notify_client_users(s.client_id, s.location_id, 'approve', 'timesheet.pending', 'Timesheet ready for approval',
                                  s.title, '/client/timesheets', 'timesheet', v_id, 'timesheet-pending-' || v_id);
  return v_id;
end;
$$;

-- Shift status follows its assignments.
create or replace function app.refresh_shift_progress(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
  v_live integer;
  v_open integer;
  v_ts_total integer;
  v_ts_submitted integer;
  v_ts_approved integer;
begin
  select * into s from public.shifts where id = p_shift_id for update;
  select count(*) filter (where status not in ('declined', 'cancelled', 'replaced', 'no_show')),
         count(*) filter (where status in ('confirmed', 'checked_in', 'replacement_requested'))
    into v_live, v_open
  from public.shift_assignments where shift_id = p_shift_id;
  select count(*), count(*) filter (where status <> 'draft'), count(*) filter (where status in ('agency_approved', 'locked'))
    into v_ts_total, v_ts_submitted, v_ts_approved
  from public.timesheets where shift_id = p_shift_id;

  if s.status in ('open', 'offered', 'partially_filled', 'filled')
     and exists (select 1 from public.shift_assignments where shift_id = p_shift_id and status = 'checked_in') then
    update public.shifts set status = 'in_progress' where id = s.id;
    s.status := 'in_progress';
  end if;
  if s.status = 'in_progress' and v_open = 0 and v_live > 0 then
    update public.shifts set status = 'completed' where id = s.id;
    s.status := 'completed';
  end if;
  if s.status = 'completed' and v_ts_total > 0 and v_ts_submitted = v_ts_total then
    update public.shifts set status = 'awaiting_approval' where id = s.id;
    s.status := 'awaiting_approval';
  end if;
  if s.status = 'awaiting_approval' and v_ts_total > 0 and v_ts_approved = v_ts_total then
    update public.shifts set status = 'approved' where id = s.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Attendance recording (worker)
-- ---------------------------------------------------------------------------
create or replace function app.insert_attendance(a public.shift_assignments, p_type text, p_device_time timestamptz, p_offline boolean,
                                                 p_lat numeric, p_lng numeric, p_accuracy numeric, p_key text, p_source text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.agency_settings;
  loc public.client_locations;
  v_id uuid;
  v_verified boolean;
  v_lat numeric := p_lat;
  v_lng numeric := p_lng;
  v_effective timestamptz := case when p_offline then p_device_time else now() end;
  v_open_break uuid;
begin
  select * into st from public.agency_settings where agency_id = a.agency_id;
  select l.* into loc from public.client_locations l join public.shifts s on s.location_id = l.id where s.id = a.shift_id;

  if p_offline and (p_device_time is null or p_device_time > now() + interval '5 minutes' or p_device_time < now() - interval '48 hours') then
    raise exception 'Offline events must be synchronised within 48 hours and cannot be in the future' using errcode = 'P0001';
  end if;
  if not st.location_verification_enabled then
    v_lat := null; v_lng := null;  -- never store location unless the agency enabled it
  elsif v_lat is not null and loc.latitude is not null and loc.geofence_radius_m is not null and not p_offline then
    v_verified := app.haversine_km(v_lat, v_lng, loc.latitude, loc.longitude) * 1000 <= loc.geofence_radius_m + coalesce(p_accuracy, 0);
  end if;

  case p_type
    when 'check_in' then
      if a.status <> 'confirmed' then raise exception 'You can only check in to a confirmed shift' using errcode = 'P0001'; end if;
      if v_effective < a.starts_at - interval '2 hours' then raise exception 'Check-in opens two hours before the shift starts' using errcode = 'P0001'; end if;
      if v_effective > a.ends_at then raise exception 'This shift has already ended; ask the agency to record your attendance' using errcode = 'P0001'; end if;
    when 'check_out' then
      if a.status <> 'checked_in' then raise exception 'You need to be checked in to check out' using errcode = 'P0001'; end if;
    when 'break_start' then
      if a.status <> 'checked_in' then raise exception 'You need to be checked in to start a break' using errcode = 'P0001'; end if;
      if exists (select 1 from public.break_records where assignment_id = a.id and ended_at is null) then raise exception 'A break is already running' using errcode = 'P0001'; end if;
    when 'break_end' then
      select id into v_open_break from public.break_records where assignment_id = a.id and ended_at is null;
      if v_open_break is null then raise exception 'No break is running' using errcode = 'P0001'; end if;
    else
      raise exception 'Unknown attendance event' using errcode = 'P0001';
  end case;

  insert into public.attendance_events (agency_id, assignment_id, worker_id, event_type, device_recorded_at, is_offline_sync, source,
                                        latitude, longitude, location_accuracy_m, location_verified, idempotency_key, recorded_by, note)
  values (a.agency_id, a.id, a.worker_id, p_type, p_device_time, p_offline, p_source, v_lat, v_lng,
          case when v_lat is null then null else p_accuracy end, v_verified, p_key, auth.uid(), p_note)
  returning id into v_id;

  if p_type = 'check_in' then
    update public.shift_assignments set status = 'checked_in' where id = a.id;
  elsif p_type = 'break_start' then
    insert into public.break_records (agency_id, assignment_id, started_at, start_event_id) values (a.agency_id, a.id, v_effective, v_id);
  elsif p_type = 'break_end' then
    update public.break_records set ended_at = greatest(started_at, v_effective), end_event_id = v_id where id = v_open_break;
  elsif p_type = 'check_out' then
    update public.break_records set ended_at = greatest(started_at, v_effective) where assignment_id = a.id and ended_at is null;
    update public.shift_assignments set status = 'checked_out' where id = a.id;
    perform app.build_timesheet(a.id);
  end if;
  perform app.refresh_shift_progress(a.shift_id);
  return v_id;
end;
$$;

create or replace function public.record_attendance(p_assignment_id uuid, p_event_type text, p_idempotency_key text,
                                                    p_device_time timestamptz default null, p_offline boolean default false,
                                                    p_latitude numeric default null, p_longitude numeric default null, p_accuracy_m numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.shift_assignments;
  v_existing uuid;
  v_id uuid;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 100 then
    raise exception 'A client-generated idempotency key is required' using errcode = 'P0001';
  end if;
  select * into a from public.shift_assignments where id = p_assignment_id for update;
  if a.id is null or not app.is_worker_self(a.worker_id) then raise exception 'Assignment not found' using errcode = 'P0002'; end if;
  select id into v_existing from public.attendance_events where worker_id = a.worker_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return jsonb_build_object('event_id', v_existing, 'duplicate', true, 'status', a.status);
  end if;
  v_id := app.insert_attendance(a, p_event_type, p_device_time, coalesce(p_offline, false), p_latitude, p_longitude, p_accuracy_m,
                                p_idempotency_key, 'worker_app', null);
  return jsonb_build_object('event_id', v_id, 'duplicate', false, 'status', (select status from public.shift_assignments where id = a.id));
end;
$$;
revoke all on function public.record_attendance(uuid, text, text, timestamptz, boolean, numeric, numeric, numeric) from public, anon;
grant execute on function public.record_attendance(uuid, text, text, timestamptz, boolean, numeric, numeric, numeric) to authenticated;

-- Staff entry (e.g. worker without a phone). Recorded as admin_entry with the staff member as recorder.
create or replace function public.staff_record_attendance(p_assignment_id uuid, p_event_type text, p_occurred_at timestamptz, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare a public.shift_assignments;
begin
  select * into a from public.shift_assignments where id = p_assignment_id for update;
  if a.id is null or not app.has_permission(a.agency_id, 'attendance.correct') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Explain why attendance is entered by staff' using errcode = 'P0001'; end if;
  if p_occurred_at > now() + interval '5 minutes' then raise exception 'Attendance cannot be recorded in the future' using errcode = 'P0001'; end if;
  -- Staff entries carry the stated time as device time and are flagged like offline events.
  return app.insert_attendance(a, p_event_type, p_occurred_at, true, null, null, null, 'staff-' || gen_random_uuid(), 'admin_entry', p_note);
end;
$$;
revoke all on function public.staff_record_attendance(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.staff_record_attendance(uuid, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Timesheet approval workflow
-- ---------------------------------------------------------------------------
create or replace function public.client_review_timesheet(p_timesheet_id uuid, p_approve boolean, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare t public.timesheets;
begin
  select * into t from public.timesheets where id = p_timesheet_id for update;
  if t.id is null or not (app.client_can(t.client_id, 'approve') and app.client_location_allowed(t.client_id, t.location_id)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if t.status <> 'submitted' then raise exception 'This timesheet is not awaiting your approval' using errcode = 'P0001'; end if;
  if not p_approve and coalesce(length(trim(p_comment)), 0) < 5 then raise exception 'Explain what is incorrect' using errcode = 'P0001'; end if;
  insert into public.timesheet_approvals (agency_id, timesheet_id, approver_type, decision, comment, decided_by)
  values (t.agency_id, t.id, 'client', case when p_approve then 'approved' else 'disputed' end, nullif(trim(p_comment), ''), auth.uid());
  if p_approve then
    update public.timesheets set status = 'client_approved', client_approved_at = now(), client_approved_by = auth.uid() where id = t.id;
  else
    update public.timesheets set status = 'disputed' where id = t.id;
    update public.shift_assignments set status = 'disputed' where id = t.assignment_id and status in ('checked_out', 'completed');
    perform app.notify_permission_holders(t.agency_id, 'timesheets.approve', 'timesheet.disputed', 'Timesheet disputed by client', p_comment,
                                          '/admin/timesheets/' || t.id, 'timesheet', t.id, 'timesheet-disputed-' || t.id || '-' || extract(epoch from now())::bigint);
  end if;
end;
$$;
revoke all on function public.client_review_timesheet(uuid, boolean, text) from public, anon;
grant execute on function public.client_review_timesheet(uuid, boolean, text) to authenticated;

create or replace function public.agency_approve_timesheet(p_timesheet_id uuid, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
  v_user uuid;
begin
  select * into t from public.timesheets where id = p_timesheet_id for update;
  if t.id is null or not app.has_permission(t.agency_id, 'timesheets.approve') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if t.status <> 'client_approved' then raise exception 'The client must approve the timesheet first (status: %)', t.status using errcode = 'P0001'; end if;
  insert into public.timesheet_approvals (agency_id, timesheet_id, approver_type, decision, comment, decided_by)
  values (t.agency_id, t.id, 'agency', 'approved', nullif(trim(p_comment), ''), auth.uid());
  update public.timesheets set status = 'agency_approved', agency_approved_at = now(), agency_approved_by = auth.uid() where id = t.id;
  update public.shift_assignments set status = 'completed' where id = t.assignment_id and status = 'checked_out';
  perform app.refresh_shift_progress(t.shift_id);
  select user_id into v_user from public.workers where id = t.worker_id;
  perform app.notify(t.agency_id, v_user, 'timesheet.approved', 'Hours approved',
                     format('%s:%s hours approved', t.worked_minutes / 60, lpad((t.worked_minutes % 60)::text, 2, '0')),
                     '/worker/timesheets', 'timesheet', t.id, 'timesheet-approved-' || t.id);
end;
$$;
revoke all on function public.agency_approve_timesheet(uuid, text) from public, anon;
grant execute on function public.agency_approve_timesheet(uuid, text) to authenticated;

-- Correct a disputed (not yet approved) timesheet and resubmit it to the client.
create or replace function public.resolve_timesheet_dispute(p_timesheet_id uuid, p_actual_start timestamptz, p_actual_end timestamptz,
                                                            p_break_minutes integer, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare t public.timesheets;
begin
  select * into t from public.timesheets where id = p_timesheet_id for update;
  if t.id is null or not app.has_permission(t.agency_id, 'attendance.correct') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if t.status <> 'disputed' then raise exception 'Only disputed timesheets can be corrected this way' using errcode = 'P0001'; end if;
  if coalesce(length(trim(p_note)), 0) < 5 then raise exception 'Describe the correction' using errcode = 'P0001'; end if;
  insert into public.attendance_corrections (agency_id, timesheet_id, requested_by, requester_type, proposed_start, proposed_end,
                                             proposed_break_minutes, reason, status, decided_by, decided_at, decision_note)
  values (t.agency_id, t.id, auth.uid(), 'agency', p_actual_start, p_actual_end, p_break_minutes, p_note, 'approved', auth.uid(), now(), 'Dispute resolution');
  update public.timesheets set actual_start = p_actual_start, actual_end = p_actual_end, break_minutes = p_break_minutes, status = 'submitted', submitted_at = now()
  where id = t.id;
  -- Entries were frozen at submission: replace via adjustment entries.
  perform app.recalculate_timesheet(t.id);
  insert into public.timesheet_entries (agency_id, timesheet_id, entry_kind, minutes, correction_id, note, created_by)
  select t.agency_id, t.id, 'adjustment',
         (select worked_minutes from public.timesheets where id = t.id) - coalesce((select sum(minutes) from public.timesheet_entries where timesheet_id = t.id), 0),
         (select id from public.attendance_corrections where timesheet_id = t.id order by created_at desc limit 1), p_note, auth.uid()
  where (select worked_minutes from public.timesheets where id = t.id) <> coalesce((select sum(minutes) from public.timesheet_entries where timesheet_id = t.id), 0);
  update public.shift_assignments set status = 'completed' where id = t.assignment_id and status = 'disputed';
  perform app.notify_client_users(t.client_id, t.location_id, 'approve', 'timesheet.pending', 'Corrected timesheet ready for approval', p_note,
                                  '/client/timesheets', 'timesheet', t.id, 'timesheet-resubmitted-' || t.id || '-' || extract(epoch from now())::bigint);
end;
$$;
revoke all on function public.resolve_timesheet_dispute(uuid, timestamptz, timestamptz, integer, text) from public, anon;
grant execute on function public.resolve_timesheet_dispute(uuid, timestamptz, timestamptz, integer, text) to authenticated;

-- Decide a correction requested by a worker or client.
create or replace function public.decide_attendance_correction(p_correction_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.attendance_corrections;
  t public.timesheets;
  v_before integer;
  v_after integer;
begin
  select * into c from public.attendance_corrections where id = p_correction_id for update;
  if c.id is null or not app.has_permission(c.agency_id, 'attendance.correct') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if c.status <> 'pending' then raise exception 'This correction has already been decided' using errcode = 'P0001'; end if;
  select * into t from public.timesheets where id = c.timesheet_id for update;
  update public.attendance_corrections set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = c.id;
  if not p_approve then return; end if;
  if t.status = 'locked' then raise exception 'The timesheet is locked (invoiced or exported); issue a credit note instead' using errcode = 'P0001'; end if;

  v_before := t.worked_minutes;
  if t.status in ('draft', 'submitted', 'disputed') then
    update public.timesheets set actual_start = coalesce(c.proposed_start, actual_start), actual_end = coalesce(c.proposed_end, actual_end),
           break_minutes = coalesce(c.proposed_break_minutes, break_minutes) where id = t.id;
    perform app.recalculate_timesheet(t.id);
    select worked_minutes into v_after from public.timesheets where id = t.id;
  else
    -- Approved timesheets are immutable: record the difference as an adjustment.
    v_after := greatest(0, (extract(epoch from (coalesce(c.proposed_end, t.actual_end) - coalesce(c.proposed_start, t.actual_start))) / 60)::int
                           - coalesce(c.proposed_break_minutes, t.break_minutes));
  end if;
  if t.status <> 'draft' and v_after is distinct from v_before then
    insert into public.timesheet_entries (agency_id, timesheet_id, entry_kind, minutes, correction_id, note, created_by)
    values (t.agency_id, t.id, 'adjustment', v_after - v_before, c.id, coalesce(p_note, c.reason), auth.uid());
  end if;
end;
$$;
revoke all on function public.decide_attendance_correction(uuid, boolean, text) from public, anon;
grant execute on function public.decide_attendance_correction(uuid, boolean, text) to authenticated;

-- Notify staff of new correction requests.
create or replace function app.notify_correction_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify_permission_holders(new.agency_id, 'attendance.correct', 'timesheet.correction_requested', 'Attendance correction requested',
                                        new.reason, '/admin/timesheets/' || new.timesheet_id, 'timesheet', new.timesheet_id, 'correction-' || new.id);
  return new;
end;
$$;
create trigger trg_attendance_corrections_notify after insert on public.attendance_corrections
  for each row execute function app.notify_correction_request();

-- ---------------------------------------------------------------------------
-- Alerts: missing check-ins and late arrivals (for dashboards and automation)
-- ---------------------------------------------------------------------------
create or replace function public.attendance_alerts(p_agency_id uuid)
returns table (assignment_id uuid, shift_id uuid, worker_id uuid, worker_name text, shift_title text, client_name text,
               starts_at timestamptz, alert text, minutes_late integer)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, s.id, w.id, w.first_name || ' ' || w.last_name, s.title, c.name, s.starts_at,
         'missing_check_in', (extract(epoch from (now() - s.starts_at)) / 60)::int
  from public.shift_assignments a
  join public.shifts s on s.id = a.shift_id
  join public.workers w on w.id = a.worker_id
  join public.clients c on c.id = s.client_id
  join public.agency_settings st on st.agency_id = a.agency_id
  where a.agency_id = p_agency_id and app.has_permission(p_agency_id, 'attendance.read')
    and a.status = 'confirmed' and now() > s.starts_at + make_interval(mins => st.missing_checkin_alert_minutes) and now() < s.ends_at
  union all
  select a.id, s.id, w.id, w.first_name || ' ' || w.last_name, s.title, c.name, s.starts_at,
         'late_check_in', (extract(epoch from (e.server_recorded_at - s.starts_at)) / 60)::int
  from public.shift_assignments a
  join public.shifts s on s.id = a.shift_id
  join public.workers w on w.id = a.worker_id
  join public.clients c on c.id = s.client_id
  join public.agency_settings st on st.agency_id = a.agency_id
  join lateral (select min(server_recorded_at) server_recorded_at from public.attendance_events where assignment_id = a.id and event_type = 'check_in') e on true
  where a.agency_id = p_agency_id and app.has_permission(p_agency_id, 'attendance.read')
    and a.status = 'checked_in' and e.server_recorded_at > s.starts_at + make_interval(mins => st.late_threshold_minutes)
$$;
revoke all on function public.attendance_alerts(uuid) from public, anon;
grant execute on function public.attendance_alerts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Worker-facing functions
-- ---------------------------------------------------------------------------
-- Open positions this worker is eligible for (no pending offer or assignment yet).
create or replace function public.worker_available_shifts(p_worker_id uuid)
returns table (shift_position_id uuid, shift_id uuid, title text, position_name text, client_name text, location_name text, city text,
               starts_at timestamptz, ends_at timestamptz, break_minutes integer, open_slots integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare r record;
begin
  if not app.is_worker_self(p_worker_id) then raise exception 'Not authorised' using errcode = '42501'; end if;
  for r in
    select sp.id spid, s.id sid, s.title, jp.name pname, c.name cname, l.name lname, l.city, s.starts_at, s.ends_at, s.break_minutes, sp.headcount - sp.filled_count slots
    from public.shift_positions sp
    join public.shifts s on s.id = sp.shift_id
    join public.job_positions jp on jp.id = sp.position_id
    join public.clients c on c.id = s.client_id
    join public.client_locations l on l.id = s.location_id
    join public.workers w on w.id = p_worker_id and w.agency_id = s.agency_id
    where s.status in ('open', 'offered', 'partially_filled') and s.starts_at > now() and sp.filled_count < sp.headcount
      and not exists (select 1 from public.shift_assignments a where a.shift_id = s.id and a.worker_id = p_worker_id and a.status not in ('declined', 'cancelled', 'replaced'))
      and not exists (select 1 from public.shift_invitations i where i.shift_position_id = sp.id and i.worker_id = p_worker_id and i.status in ('pending', 'declined'))
    order by s.starts_at
    limit 100
  loop
    if (app.evaluate_eligibility(r.spid, p_worker_id) ->> 'eligible')::boolean then
      shift_position_id := r.spid; shift_id := r.sid; title := r.title; position_name := r.pname; client_name := r.cname; location_name := r.lname;
      city := r.city; starts_at := r.starts_at; ends_at := r.ends_at; break_minutes := r.break_minutes; open_slots := r.slots;
      return next;
    end if;
  end loop;
end;
$$;
revoke all on function public.worker_available_shifts(uuid) from public, anon;
grant execute on function public.worker_available_shifts(uuid) to authenticated;

create or replace function public.express_shift_interest(p_shift_position_id uuid, p_worker_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sp public.shift_positions;
  s public.shifts;
  w public.workers;
begin
  if not app.is_worker_self(p_worker_id) then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into sp from public.shift_positions where id = p_shift_position_id;
  select * into s from public.shifts where id = sp.shift_id;
  select * into w from public.workers where id = p_worker_id;
  if not (app.evaluate_eligibility(p_shift_position_id, p_worker_id) ->> 'eligible')::boolean then
    raise exception 'You are not eligible for this shift' using errcode = 'P0001';
  end if;
  perform app.notify_permission_holders(s.agency_id, 'shifts.assign', 'shift.interest', 'Worker interested in a shift',
                                        format('%s %s · %s', w.first_name, w.last_name, s.title), '/admin/shifts/' || s.id || '?match=' || sp.id,
                                        'shift', s.id, 'interest-' || sp.id || '-' || p_worker_id);
end;
$$;
revoke all on function public.express_shift_interest(uuid, uuid) from public, anon;
grant execute on function public.express_shift_interest(uuid, uuid) to authenticated;

create or replace function public.request_invitation_clarification(p_invitation_id uuid, p_question text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare i public.shift_invitations;
begin
  select * into i from public.shift_invitations where id = p_invitation_id for update;
  if i.id is null or not app.is_worker_self(i.worker_id) then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  if i.status <> 'pending' then raise exception 'This invitation is no longer open' using errcode = 'P0001'; end if;
  if coalesce(length(trim(p_question)), 0) < 5 then raise exception 'Write your question' using errcode = 'P0001'; end if;
  update public.shift_invitations set clarification_request = left(p_question, 1000) where id = i.id;
  perform app.notify_permission_holders(i.agency_id, 'shifts.assign', 'invitation.clarification', 'Question about a shift offer', p_question,
                                        '/admin/shifts/' || i.shift_id, 'shift', i.shift_id, 'clarify-' || i.id || '-' || extract(epoch from now())::bigint);
end;
$$;
revoke all on function public.request_invitation_clarification(uuid, text) from public, anon;
grant execute on function public.request_invitation_clarification(uuid, text) to authenticated;

-- The worker's own pay terms for an assignment (never exposed to clients).
create or replace function public.my_assignment_pay(p_assignment_id uuid)
returns table (pay_basis text, hourly_amount numeric, fixed_fee numeric, currency text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.worker_pay_basis, r.worker_hourly_amount, r.worker_fixed_fee, r.currency
  from public.shift_rate_snapshots r join public.shift_assignments a on a.id = r.assignment_id
  where a.id = p_assignment_id and app.is_worker_self(a.worker_id)
$$;
revoke all on function public.my_assignment_pay(uuid) from public, anon;
grant execute on function public.my_assignment_pay(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Client-facing projections
-- ---------------------------------------------------------------------------
drop function if exists public.client_shift_staff(uuid);
create or replace function public.client_shift_staff(p_shift_id uuid)
returns table (assignment_id uuid, worker_display_name text, position_name text, status public.assignment_status,
               checked_in_at timestamptz, checked_out_at timestamptz, professional_summary text, certificates text[], languages text[])
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
         coalesce(w.display_name, w.first_name || ' ' || left(w.last_name, 1) || '.'),
         jp.name,
         a.status,
         (select min(server_recorded_at) from public.attendance_events e where e.assignment_id = a.id and e.event_type = 'check_in'),
         (select max(server_recorded_at) from public.attendance_events e where e.assignment_id = a.id and e.event_type = 'check_out'),
         w.professional_summary,
         -- only certificates relevant to this position's requirements
         array(select ce.name from public.worker_certificates wc join public.certificates ce on ce.id = wc.certificate_id
               join public.position_requirements pr on pr.certificate_id = wc.certificate_id and pr.position_id = sp.position_id
               where wc.worker_id = w.id and wc.status = 'verified' and (wc.expires_on is null or wc.expires_on >= current_date)),
         array(select upper(wl.language_code) || ' ' || wl.level from public.worker_languages wl where wl.worker_id = w.id)
  from public.shift_assignments a
  join public.shifts s on s.id = a.shift_id
  join public.workers w on w.id = a.worker_id
  join public.shift_positions sp on sp.id = a.shift_position_id
  join public.job_positions jp on jp.id = sp.position_id
  where a.shift_id = p_shift_id
    and a.status in ('accepted', 'confirmed', 'checked_in', 'checked_out', 'completed', 'replacement_requested', 'disputed', 'no_show')
    and (app.client_location_allowed(s.client_id, s.location_id) or app.has_permission(s.agency_id, 'shifts.read'))
$$;
revoke all on function public.client_shift_staff(uuid) from public, anon;
grant execute on function public.client_shift_staff(uuid) to authenticated;

-- Workers on duty right now for the client's permitted locations.
create or replace function public.client_on_duty(p_client_id uuid)
returns table (shift_id uuid, shift_title text, location_name text, worker_display_name text, checked_in_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, l.name, coalesce(w.display_name, w.first_name || ' ' || left(w.last_name, 1) || '.'),
         (select min(server_recorded_at) from public.attendance_events e where e.assignment_id = a.id and e.event_type = 'check_in')
  from public.shift_assignments a
  join public.shifts s on s.id = a.shift_id
  join public.client_locations l on l.id = s.location_id
  join public.workers w on w.id = a.worker_id
  where s.client_id = p_client_id and a.status = 'checked_in' and app.client_location_allowed(s.client_id, s.location_id)
$$;
revoke all on function public.client_on_duty(uuid) from public, anon;
grant execute on function public.client_on_duty(uuid) to authenticated;

-- Every assignment change also advances the shift lifecycle (no-shows, cancellations…).
create or replace function app.after_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.refresh_shift_fill(coalesce(new.shift_id, old.shift_id));
  if tg_table_name = 'shift_assignments' then
    perform app.refresh_shift_progress(coalesce(new.shift_id, old.shift_id));
  end if;
  return null;
end;
$$;

-- Workers need the attendance policy (not the rest of the agency settings).
create or replace function public.my_attendance_policy(p_worker_id uuid)
returns table (location_verification_enabled boolean, location_privacy_notice text, timezone text)
language sql
stable
security definer
set search_path = ''
as $$
  select st.location_verification_enabled, st.location_privacy_notice, a.timezone
  from public.workers w join public.agency_settings st on st.agency_id = w.agency_id join public.agencies a on a.id = w.agency_id
  where w.id = p_worker_id and app.is_worker_self(p_worker_id)
$$;
revoke all on function public.my_attendance_policy(uuid) from public, anon;
grant execute on function public.my_attendance_policy(uuid) to authenticated;
