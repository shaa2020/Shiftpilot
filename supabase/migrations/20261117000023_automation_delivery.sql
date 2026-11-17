-- ============================================================================
-- ShiftPilot — 0023 Notification delivery queue and scheduled automations
--
-- In-app notifications are always created. Email/push/WhatsApp deliveries are
-- queued from them according to user preferences and dispatched by the
-- service-role cron endpoint. Providers that are not configured are recorded
-- as skipped_unconfigured, never reported as sent.
-- ============================================================================

-- Events that are emailed unless the user turns email off for them.
create or replace function app.default_email_event(p_event text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_event = any (array[
    'shift.invited', 'shift.confirmed', 'shift.cancelled', 'shift.reminder', 'assignment.cancelled', 'assignment.replaced',
    'timesheet.submitted', 'timesheet.disputed', 'invoice.issued', 'invoice.credited', 'invoice.overdue',
    'document.rejected', 'document.expiring', 'document.expired', 'attendance.missing_check_in', 'privacy.request',
    'request.submitted', 'freelancer_invoice.rejected', 'freelancer_invoice.paid'
  ])
$$;

create or replace function app.enqueue_notification_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch text;
  v_enabled boolean;
  v_default boolean;
begin
  foreach ch in array array['email', 'push', 'whatsapp'] loop
    v_default := case ch when 'email' then app.default_email_event(new.event_type) when 'push' then true else false end;
    select p.enabled into v_enabled from public.notification_preferences p
     where p.user_id = new.recipient_user_id and p.agency_id = new.agency_id and p.channel = ch
       and p.event_type in (new.event_type, '*')
     order by (p.event_type = new.event_type) desc limit 1;
    if not coalesce(v_enabled, v_default) then continue; end if;
    if ch = 'push' and not exists (select 1 from public.push_subscriptions s where s.user_id = new.recipient_user_id and s.disabled_at is null) then
      continue;
    end if;
    insert into public.notification_deliveries (agency_id, notification_id, recipient_user_id, channel, template_key, idempotency_key)
    values (new.agency_id, new.id, new.recipient_user_id, ch, new.event_type, new.id || ':' || ch)
    on conflict (idempotency_key) do nothing;
  end loop;
  return new;
end;
$$;
create trigger trg_notifications_enqueue after insert on public.notifications
  for each row execute function app.enqueue_notification_deliveries();

-- Dispatcher result. Failures back off exponentially (2, 4, 8 … minutes) until max_attempts.
create or replace function public.complete_notification_delivery(p_id uuid, p_status text, p_provider text default null,
                                                                 p_message_id text default null, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare d public.notification_deliveries;
begin
  if not app.is_service_role() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_status not in ('sent', 'failed', 'skipped_unconfigured', 'skipped_preference', 'dead') then
    raise exception 'Invalid delivery status' using errcode = 'P0001';
  end if;
  select * into d from public.notification_deliveries where id = p_id for update;
  if d.id is null then raise exception 'Delivery not found' using errcode = 'P0002'; end if;
  update public.notification_deliveries
     set status = case when p_status = 'failed' and d.attempts >= d.max_attempts then 'dead' else p_status end,
         provider = coalesce(p_provider, provider),
         provider_message_id = coalesce(p_message_id, provider_message_id),
         last_error = left(p_error, 1000),
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         next_attempt_at = case when p_status = 'failed' then now() + make_interval(mins => power(2, least(d.attempts, 10))::int) else next_attempt_at end
   where id = p_id;
end;
$$;
revoke all on function public.complete_notification_delivery(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_notification_delivery(uuid, text, text, text, text) to service_role;

-- Delivery context for the dispatcher (service role): recipient, content, active push endpoints.
create or replace function public.delivery_context(p_ids uuid[])
returns table (delivery_id uuid, channel text, email text, phone text, locale text, title text, body text, link_path text,
               agency_name text, push_subscriptions jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_service_role() then raise exception 'Not authorised' using errcode = '42501'; end if;
  return query
  select d.id, d.channel, p.email::text, p.phone, p.locale, n.title, n.body, n.link_path, a.name,
         coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth_secret))
                     from public.push_subscriptions s where s.user_id = d.recipient_user_id and s.disabled_at is null), '[]'::jsonb)
    from public.notification_deliveries d
    left join public.notifications n on n.id = d.notification_id
    left join public.profiles p on p.id = d.recipient_user_id
    join public.agencies a on a.id = d.agency_id
   where d.id = any (p_ids);
end;
$$;
revoke all on function public.delivery_context(uuid[]) from public, anon, authenticated;
grant execute on function public.delivery_context(uuid[]) to service_role;

-- Users manage their own push subscriptions (one row per browser endpoint).
create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'Invalid subscription' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_secret, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth_secret = excluded.auth_secret,
                                       user_agent = excluded.user_agent, disabled_at = null;
end;
$$;
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Scheduled automations (run by the cron endpoint with the service role).
-- Every notification uses an idempotency key, so re-running is safe.
-- ---------------------------------------------------------------------------
create or replace function public.run_scheduled_automations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_reminders int := 0;
  v_missing int := 0;
  v_expiring int := 0;
  v_expired int := 0;
  v_overdue int := 0;
  v_invites int := 0;
  v_user uuid;
  v_retention jsonb;
begin
  if not app.is_service_role() then raise exception 'Not authorised' using errcode = '42501'; end if;

  -- 1. Shift reminders: confirmed assignments starting within the next 24 hours.
  for r in
    select a.id, a.agency_id, a.starts_at, w.user_id, s.title, l.name as location_name, ag.timezone tz
      from public.shift_assignments a join public.workers w on w.id = a.worker_id join public.shifts s on s.id = a.shift_id
      left join public.client_locations l on l.id = s.location_id join public.agencies ag on ag.id = a.agency_id
     where a.status = 'confirmed' and a.starts_at > now() and a.starts_at <= now() + interval '24 hours' and w.user_id is not null
  loop
    perform app.notify(r.agency_id, r.user_id, 'shift.reminder', 'Shift reminder: ' || r.title,
                       'Starts ' || to_char(r.starts_at at time zone r.tz, 'Dy DD Mon HH24:MI') || coalesce(' at ' || r.location_name, ''),
                       '/worker/shifts/' || r.id, 'assignment', r.id, 'shift-reminder-' || r.id);
    v_reminders := v_reminders + 1;
  end loop;

  -- 2. Missing check-ins: confirmed but not checked in 15+ minutes after the start, while the shift is running.
  for r in
    select a.id, a.agency_id, a.shift_id, w.user_id, w.first_name || ' ' || w.last_name as worker_name, s.title
      from public.shift_assignments a join public.workers w on w.id = a.worker_id join public.shifts s on s.id = a.shift_id
     where a.status = 'confirmed' and a.starts_at < now() - interval '15 minutes' and a.ends_at > now()
  loop
    perform app.notify_permission_holders(r.agency_id, 'attendance.correct', 'attendance.missing_check_in', 'Missing check-in: ' || r.worker_name,
                                          r.title, '/admin/attendance', 'assignment', r.id, 'missing-checkin-' || r.id);
    perform app.notify(r.agency_id, r.user_id, 'attendance.missing_check_in', 'You have not checked in', r.title,
                       '/worker/shifts/' || r.id, 'assignment', r.id, 'missing-checkin-worker-' || r.id);
    v_missing := v_missing + 1;
  end loop;

  -- 3. Expiring documents (30 and 7 days ahead) and expiry of lapsed evidence.
  for r in
    select d.id, d.agency_id, d.title, d.expires_on, w.user_id, (d.expires_on - current_date) as days_left
      from public.documents d join public.workers w on w.id = d.worker_id
     where d.status = 'verified' and d.archived_at is null and d.expires_on - current_date in (30, 7)
  loop
    perform app.notify(r.agency_id, r.user_id, 'document.expiring', r.title || ' expires in ' || r.days_left || ' days',
                       'Upload a renewed document before ' || r.expires_on, '/worker/documents', 'document', r.id, 'doc-expiring-' || r.id || '-' || r.days_left);
    perform app.notify_permission_holders(r.agency_id, 'documents.verify', 'document.expiring', r.title || ' expires in ' || r.days_left || ' days',
                                          null, '/admin/compliance', 'document', r.id, 'doc-expiring-staff-' || r.id || '-' || r.days_left);
    v_expiring := v_expiring + 1;
  end loop;
  for r in
    update public.documents d set status = 'expired' where d.status = 'verified' and d.expires_on < current_date and d.archived_at is null
    returning d.id, d.agency_id, d.title, d.worker_id
  loop
    select user_id into v_user from public.workers where id = r.worker_id;
    perform app.notify(r.agency_id, v_user, 'document.expired', r.title || ' has expired', 'Upload a renewed document to stay eligible for shifts.',
                       '/worker/documents', 'document', r.id, 'doc-expired-' || r.id);
    v_expired := v_expired + 1;
  end loop;
  update public.worker_certificates set status = 'expired' where status = 'verified' and expires_on < current_date;
  update public.worker_qualifications set status = 'expired' where status = 'verified' and expires_on < current_date;

  -- 4. Overdue client invoices (notify finance once per invoice).
  for r in
    select i.id, i.agency_id, i.invoice_number, i.total - i.amount_paid as open_amount, c.name as client_name
      from public.invoices i join public.clients c on c.id = i.client_id
     where i.kind = 'invoice' and i.status in ('issued', 'partially_paid') and i.due_date < current_date
  loop
    perform app.notify_permission_holders(r.agency_id, 'finance.read', 'invoice.overdue', 'Invoice ' || r.invoice_number || ' is overdue',
                                          r.client_name || ' — € ' || to_char(r.open_amount, 'FM999G999G990D00') || ' open', '/admin/invoices/' || r.id,
                                          'invoice', r.id, 'invoice-overdue-' || r.id);
    v_overdue := v_overdue + 1;
  end loop;

  -- 5. Lapsed shift invitations.
  update public.shift_invitations set status = 'expired' where status = 'pending' and expires_at < now();
  get diagnostics v_invites = row_count;

  -- 6. Data retention.
  v_retention := public.apply_retention();

  return jsonb_build_object('shift_reminders', v_reminders, 'missing_check_ins', v_missing, 'documents_expiring', v_expiring,
                            'documents_expired', v_expired, 'invoices_overdue', v_overdue, 'invitations_expired', v_invites,
                            'retention', v_retention);
end;
$$;
revoke all on function public.run_scheduled_automations() from public, anon, authenticated;
grant execute on function public.run_scheduled_automations() to service_role;
