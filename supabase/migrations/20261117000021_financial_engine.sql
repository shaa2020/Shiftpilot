-- ============================================================================
-- ShiftPilot — 0021 Financial engine
--   * public holiday calendar (agency-configured; none assumed)
--   * per-minute classification of worked time in the agency time zone
--     (public holiday > weekend > night > regular); breaks deducted from
--     regular time first; approved adjustments added to regular time
--   * client billing from the immutable rate snapshot (+ overtime surcharge)
--   * invoice generation, issuing (gapless numbers, billing snapshot,
--     timesheet locking), credit notes
--   * payroll export: hours by category only — no statutory calculations
--   * freelancer purchase invoices matched against approved timesheets
--   * financial summary with an ESTIMATED contribution margin
-- ============================================================================

create table public.public_holidays (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (agency_id, holiday_date)
);
alter table public.public_holidays enable row level security;
create policy public_holidays_select on public.public_holidays for select to authenticated using (app.is_agency_participant(agency_id));
create policy public_holidays_write on public.public_holidays for all to authenticated
  using (app.has_permission(agency_id, 'rates.write')) with check (app.has_permission(agency_id, 'rates.write'));
select app.attach_audit('public.public_holidays');

alter table public.agency_settings
  add column payroll_night_from time not null default '22:00',
  add column payroll_night_to time not null default '06:00';

-- ---------------------------------------------------------------------------
-- Classification
-- ---------------------------------------------------------------------------
create or replace function app.in_window(p_t time, p_from time, p_to time)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when p_from is null or p_to is null then false
              when p_from < p_to then p_t >= p_from and p_t < p_to
              else p_t >= p_from or p_t < p_to end
$$;

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
  brk int; d int; adj int;
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
  select coalesce(sum(e.minutes), 0) into adj from public.timesheet_entries e where e.timesheet_id = t.id and e.entry_kind = 'adjustment';
  category := 'public_holiday'; minutes := c_holiday; return next;
  category := 'weekend'; minutes := c_weekend; return next;
  category := 'night'; minutes := c_night; return next;
  category := 'regular'; minutes := greatest(0, c_regular + adj); return next;
end;
$$;

-- Client billing lines for one timesheet, from its rate snapshot.
create or replace function app.timesheet_billing(p_timesheet_id uuid)
returns table (category text, minutes integer, hourly_rate numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
  snap public.shift_rate_snapshots;
  base numeric;
  r_weekend jsonb; r_night jsonb; r_holiday jsonb; r_overtime jsonb;
  rec record;
begin
  select * into t from public.timesheets where id = p_timesheet_id;
  select * into snap from public.shift_rate_snapshots where assignment_id = t.assignment_id;
  if snap.id is null then raise exception 'Timesheet has no rate snapshot (assignment was never confirmed)' using errcode = 'P0001'; end if;
  base := snap.client_hourly_rate;
  select x into r_weekend from jsonb_array_elements(snap.client_rate_rules) x where x ->> 'kind' = 'weekend' limit 1;
  select x into r_night from jsonb_array_elements(snap.client_rate_rules) x where x ->> 'kind' = 'night' limit 1;
  select x into r_holiday from jsonb_array_elements(snap.client_rate_rules) x where x ->> 'kind' = 'public_holiday' limit 1;
  select x into r_overtime from jsonb_array_elements(snap.client_rate_rules) x where x ->> 'kind' = 'overtime' limit 1;

  for rec in
    select * from app.classify_minutes(
      p_timesheet_id,
      case when r_weekend is null then '{}'::int[]
           else coalesce((select array_agg(v::int) from jsonb_array_elements_text(r_weekend -> 'days_of_week') v), '{6,7}'::int[]) end,
      (r_night ->> 'time_from')::time, (r_night ->> 'time_to')::time, r_holiday is not null)
  loop
    if rec.minutes > 0 then
      category := rec.category; minutes := rec.minutes;
      hourly_rate := case rec.category
        when 'weekend' then coalesce((r_weekend ->> 'hourly_rate')::numeric, base * (r_weekend ->> 'multiplier')::numeric)
        when 'night' then coalesce((r_night ->> 'hourly_rate')::numeric, base * (r_night ->> 'multiplier')::numeric)
        when 'public_holiday' then coalesce((r_holiday ->> 'hourly_rate')::numeric, base * (r_holiday ->> 'multiplier')::numeric)
        else base end;
      return next;
    end if;
  end loop;
  if r_overtime is not null and t.overtime_minutes > 0 then
    category := 'overtime_surcharge'; minutes := t.overtime_minutes;
    hourly_rate := greatest(0, coalesce((r_overtime ->> 'hourly_rate')::numeric - base, base * ((r_overtime ->> 'multiplier')::numeric - 1)));
    if hourly_rate > 0 then return next; end if;
  end if;
end;
$$;

create or replace function public.timesheet_billing_preview(p_timesheet_id uuid)
returns table (category text, minutes integer, hourly_rate numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.timesheets t where t.id = p_timesheet_id and app.has_permission(t.agency_id, 'finance.read')) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query select * from app.timesheet_billing(p_timesheet_id);
end;
$$;
revoke all on function public.timesheet_billing_preview(uuid) from public, anon;
grant execute on function public.timesheet_billing_preview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Client invoices
-- ---------------------------------------------------------------------------
create or replace function public.generate_client_invoice(p_client_id uuid, p_period_start date, p_period_end date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.clients;
  st public.agency_settings;
  tz text;
  v_invoice uuid;
  t record;
  b record;
  v_count int := 0;
  v_sort int := 0;
  labels jsonb := '{"regular":"","weekend":"weekend","night":"night","public_holiday":"public holiday","overtime_surcharge":"overtime surcharge"}';
begin
  select * into c from public.clients where id = p_client_id;
  if c.id is null or not app.has_permission(c.agency_id, 'finance.write') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_period_end < p_period_start then raise exception 'The period end must be after its start' using errcode = 'P0001'; end if;
  select * into st from public.agency_settings where agency_id = c.agency_id;
  select timezone into tz from public.agencies where id = c.agency_id;

  insert into public.invoices (agency_id, client_id, kind, status, period_start, period_end, currency, created_by)
  values (c.agency_id, c.id, 'invoice', 'draft', p_period_start, p_period_end, 'EUR', auth.uid())
  returning id into v_invoice;

  for t in
    select ts.id, ts.assignment_id, ts.scheduled_start, s.title, coalesce(w.display_name, w.first_name || ' ' || w.last_name) as worker, jp.name as position
    from public.timesheets ts
    join public.shifts s on s.id = ts.shift_id
    join public.workers w on w.id = ts.worker_id
    join public.shift_assignments a on a.id = ts.assignment_id
    join public.shift_positions sp on sp.id = a.shift_position_id
    join public.job_positions jp on jp.id = sp.position_id
    where ts.client_id = c.id and ts.status = 'agency_approved'
      and (ts.scheduled_start at time zone tz)::date between p_period_start and p_period_end
      and not exists (select 1 from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
                      where ii.timesheet_id = ts.id and i.status not in ('cancelled'))
    order by ts.scheduled_start
  loop
    for b in select * from app.timesheet_billing(t.id) loop
      v_sort := v_sort + 1;
      insert into public.invoice_items (agency_id, invoice_id, timesheet_id, assignment_id, description, quantity, unit, unit_price, vat_rate, rate_rule_code, sort_order)
      values (c.agency_id, v_invoice, t.id, t.assignment_id,
              format('%s · %s · %s (%s)%s', to_char(t.scheduled_start at time zone tz, 'DD-MM-YYYY'), t.position, t.worker, t.title,
                     case when labels ->> b.category <> '' then ' · ' || (labels ->> b.category) else '' end),
              round(b.minutes / 60.0, 4), 'hour', round(b.hourly_rate, 4), st.default_vat_rate, b.category, v_sort);
    end loop;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    raise exception 'No approved, uninvoiced timesheets for this client in the selected period' using errcode = 'P0001';
  end if;
  return v_invoice;
end;
$$;
revoke all on function public.generate_client_invoice(uuid, date, date) from public, anon;
grant execute on function public.generate_client_invoice(uuid, date, date) to authenticated;

create or replace function app.issue_invoice_internal(p_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.invoices;
  c public.clients;
  a public.agencies;
  st public.agency_settings;
  v_number text;
  v_terms int;
begin
  select * into i from public.invoices where id = p_invoice_id for update;
  select * into c from public.clients where id = i.client_id;
  select * into a from public.agencies where id = i.agency_id;
  select * into st from public.agency_settings where agency_id = i.agency_id;
  if i.status not in ('draft', 'review') then raise exception 'Only draft invoices can be issued (status: %)', i.status using errcode = 'P0001'; end if;
  if not exists (select 1 from public.invoice_items where invoice_id = i.id) then raise exception 'The invoice has no lines' using errcode = 'P0001'; end if;
  if c.po_number_required and i.kind = 'invoice' and coalesce(i.po_number, '') = '' then raise exception 'This client requires a purchase order number' using errcode = 'P0001'; end if;
  if i.status = 'draft' then update public.invoices set status = 'review' where id = i.id; end if;
  v_terms := coalesce(c.payment_term_days, st.default_payment_term_days);
  v_number := app.next_document_number(i.agency_id, case when i.kind = 'credit_note' then left(st.invoice_prefix, 13) || '-CN' else st.invoice_prefix end, current_date);
  update public.invoices set
    status = 'issued', invoice_number = v_number, issue_date = current_date,
    due_date = case when i.kind = 'credit_note' then current_date else current_date + v_terms end,
    issued_at = now(), issued_by = auth.uid(),
    billing_snapshot = jsonb_build_object(
      'client', jsonb_build_object('name', coalesce(c.legal_name, c.name), 'address', c.billing_address_line1, 'postal_code', c.billing_postal_code,
                                   'city', c.billing_city, 'country', c.billing_country_code, 'vat_number', c.vat_number, 'kvk_number', c.kvk_number, 'email', c.billing_email),
      'agency', jsonb_build_object('name', coalesce(a.legal_name, a.name), 'address', st.address_line1, 'postal_code', st.postal_code, 'city', st.city,
                                   'vat_number', a.vat_number, 'kvk_number', a.kvk_number, 'iban', st.iban, 'email', st.contact_email, 'phone', st.contact_phone),
      'payment_term_days', v_terms)
  where id = i.id;
  update public.timesheets set status = 'locked', locked_at = now(), locked_reason = 'invoiced'
  where id in (select timesheet_id from public.invoice_items where invoice_id = i.id and timesheet_id is not null) and status = 'agency_approved';
  return v_number;
end;
$$;

create or replace function public.issue_invoice(p_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.invoices;
  v_number text;
begin
  select * into i from public.invoices where id = p_invoice_id;
  if i.id is null or not app.has_permission(i.agency_id, 'invoices.issue') then raise exception 'Not authorised' using errcode = '42501'; end if;
  v_number := app.issue_invoice_internal(p_invoice_id);
  perform app.notify_client_users(i.client_id, null, 'finance', 'invoice.issued', 'New invoice ' || v_number, null,
                                  '/client/invoices', 'invoice', i.id, 'invoice-issued-' || i.id);
  return v_number;
end;
$$;
revoke all on function public.issue_invoice(uuid) from public, anon;
grant execute on function public.issue_invoice(uuid) to authenticated;

create or replace function public.create_credit_note(p_invoice_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.invoices;
  v_credit uuid;
begin
  select * into i from public.invoices where id = p_invoice_id for update;
  if i.id is null or not app.has_permission(i.agency_id, 'invoices.issue') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if i.kind <> 'invoice' or i.status not in ('issued', 'partially_paid', 'paid') then raise exception 'Only issued invoices can be credited' using errcode = 'P0001'; end if;
  if exists (select 1 from public.credit_notes where original_invoice_id = i.id) then raise exception 'This invoice has already been credited' using errcode = 'P0001'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Give a reason for the credit note' using errcode = 'P0001'; end if;
  insert into public.invoices (agency_id, client_id, kind, status, period_start, period_end, currency, po_number, notes, created_by)
  values (i.agency_id, i.client_id, 'credit_note', 'draft', i.period_start, i.period_end, i.currency, i.po_number, 'Credit note for ' || i.invoice_number || ': ' || p_reason, auth.uid())
  returning id into v_credit;
  insert into public.invoice_items (agency_id, invoice_id, timesheet_id, assignment_id, description, quantity, unit, unit_price, vat_rate, rate_rule_code, sort_order)
  select agency_id, v_credit, timesheet_id, assignment_id, 'Credit: ' || description, -quantity, unit, unit_price, vat_rate, rate_rule_code, sort_order
  from public.invoice_items where invoice_id = i.id;
  perform app.issue_invoice_internal(v_credit);
  insert into public.credit_notes (agency_id, original_invoice_id, credit_invoice_id, reason, created_by) values (i.agency_id, i.id, v_credit, p_reason, auth.uid());
  if i.status in ('issued', 'partially_paid') then update public.invoices set status = 'credited' where id = i.id; end if;
  perform app.notify_client_users(i.client_id, null, 'finance', 'invoice.credited', 'Credit note for invoice ' || i.invoice_number, p_reason,
                                  '/client/invoices', 'invoice', v_credit, 'credit-' || v_credit);
  return v_credit;
end;
$$;
revoke all on function public.create_credit_note(uuid, text) from public, anon;
grant execute on function public.create_credit_note(uuid, text) to authenticated;

create or replace function public.record_invoice_sent(p_invoice_id uuid, p_sent_to text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare i public.invoices;
begin
  select * into i from public.invoices where id = p_invoice_id;
  if i.id is null or not app.has_permission(i.agency_id, 'finance.write') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if i.status in ('draft', 'review', 'cancelled') then raise exception 'Only issued invoices can be sent' using errcode = 'P0001'; end if;
  update public.invoices set sent_at = now(), sent_to = p_sent_to where id = i.id;
  insert into public.audit_logs (agency_id, actor_user_id, actor_role, action, table_name, record_id, context)
  values (i.agency_id, auth.uid(), auth.role(), 'invoice.sent', 'invoices', i.id::text, jsonb_build_object('to', p_sent_to));
end;
$$;
revoke all on function public.record_invoice_sent(uuid, text) from public, anon;
grant execute on function public.record_invoice_sent(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Payroll export (employees only)
-- ---------------------------------------------------------------------------
create or replace function public.generate_payroll_export(p_payroll_period_id uuid, p_format text default 'csv')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payroll_periods;
  st public.agency_settings;
  tz text;
  v_export uuid;
  t record;
  m record;
  v_kinds jsonb;
  v_count int := 0;
  v_totals jsonb := '{}'::jsonb;
  k text;
begin
  select * into p from public.payroll_periods where id = p_payroll_period_id for update;
  if p.id is null or not app.has_permission(p.agency_id, 'payroll.export') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p.status = 'closed' then raise exception 'This payroll period is closed' using errcode = 'P0001'; end if;
  select * into st from public.agency_settings where agency_id = p.agency_id;
  select timezone into tz from public.agencies where id = p.agency_id;

  update public.payroll_exports set status = 'superseded' where payroll_period_id = p.id and status in ('generated', 'delivered');
  insert into public.payroll_exports (agency_id, payroll_period_id, format, generated_by) values (p.agency_id, p.id, p_format, auth.uid()) returning id into v_export;

  for t in
    select ts.*, snap.worker_hourly_amount, snap.wage_rate_id
    from public.timesheets ts
    join public.workers w on w.id = ts.worker_id and w.engagement_type = 'employee'
    left join public.shift_rate_snapshots snap on snap.assignment_id = ts.assignment_id
    where ts.agency_id = p.agency_id and ts.status in ('agency_approved', 'locked')
      and (ts.scheduled_start at time zone tz)::date between p.period_start and p.period_end
  loop
    v_kinds := jsonb_build_object('total', t.worked_minutes, 'overtime', t.overtime_minutes, 'break', t.break_minutes);
    for m in select * from app.classify_minutes(t.id, '{6,7}', st.payroll_night_from, st.payroll_night_to, true) loop
      v_kinds := v_kinds || jsonb_build_object(m.category, m.minutes);
    end loop;
    insert into public.payroll_export_lines (agency_id, payroll_export_id, worker_id, timesheet_id, wage_rate_id, hourly_gross, minutes_by_kind)
    values (p.agency_id, v_export, t.worker_id, t.id, t.wage_rate_id, t.worker_hourly_amount, v_kinds);
    for k in select jsonb_object_keys(v_kinds) loop
      v_totals := v_totals || jsonb_build_object(k, coalesce((v_totals ->> k)::int, 0) + (v_kinds ->> k)::int);
    end loop;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'No approved employee timesheets in this period' using errcode = 'P0001'; end if;
  update public.payroll_exports set line_count = v_count, totals = v_totals where id = v_export;
  update public.payroll_periods set status = 'exported' where id = p.id and status in ('open', 'locked');
  return v_export;
end;
$$;
revoke all on function public.generate_payroll_export(uuid, text) from public, anon;
grant execute on function public.generate_payroll_export(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Freelancer purchase invoices
-- ---------------------------------------------------------------------------
create or replace function public.submit_freelancer_invoice(p_worker_id uuid, p_supplier_invoice_number text, p_invoice_date date,
                                                            p_timesheet_ids uuid[], p_vat_rate numeric, p_payee_iban text, p_payee_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workers;
  b public.freelancer_businesses;
  v_inv uuid;
  t record;
  v_sub numeric := 0;
  v_amount numeric;
  v_min date; v_max date;
begin
  if not app.is_worker_self(p_worker_id) then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into w from public.workers where id = p_worker_id;
  select * into b from public.freelancer_businesses where worker_id = w.id;
  if w.engagement_type <> 'freelancer' or b.id is null then raise exception 'Only freelancers with a registered business can submit invoices' using errcode = 'P0001'; end if;
  if cardinality(coalesce(p_timesheet_ids, '{}')) = 0 then raise exception 'Select at least one approved timesheet' using errcode = 'P0001'; end if;
  if p_vat_rate < 0 or p_vat_rate > 100 then raise exception 'Invalid VAT rate' using errcode = 'P0001'; end if;
  if p_invoice_date > current_date then raise exception 'The invoice date cannot be in the future' using errcode = 'P0001'; end if;

  insert into public.freelancer_invoices (agency_id, business_id, worker_id, supplier_invoice_number, invoice_date, subtotal, vat_rate, vat_amount, total,
                                          payee_iban, payee_name, submitted_by)
  values (w.agency_id, b.id, w.id, p_supplier_invoice_number, p_invoice_date, 0, p_vat_rate, 0, 0, upper(replace(p_payee_iban, ' ', '')), p_payee_name, auth.uid())
  returning id into v_inv;

  for t in
    select ts.id, ts.worked_minutes, ts.scheduled_start, snap.worker_hourly_amount, snap.worker_fixed_fee, s.title
    from public.timesheets ts
    join public.shift_rate_snapshots snap on snap.assignment_id = ts.assignment_id
    join public.shifts s on s.id = ts.shift_id
    where ts.id = any (p_timesheet_ids)
  loop
    -- Defensive: every selected timesheet must be the worker's own and approved.
    if not exists (select 1 from public.timesheets x where x.id = t.id and x.worker_id = w.id and x.status in ('agency_approved', 'locked')) then
      raise exception 'Timesheets must be your own and approved by the agency' using errcode = 'P0001';
    end if;
    v_amount := coalesce(round(t.worked_minutes / 60.0 * t.worker_hourly_amount, 2), 0) + coalesce(t.worker_fixed_fee, 0);
    insert into public.freelancer_invoice_lines (agency_id, freelancer_invoice_id, timesheet_id, description, quantity, unit_price, matched)
    values (w.agency_id, v_inv, t.id, format('%s · %s', to_char(t.scheduled_start, 'DD-MM-YYYY'), t.title),
            case when t.worker_hourly_amount is not null then round(t.worked_minutes / 60.0, 4) else 1 end,
            coalesce(t.worker_hourly_amount, t.worker_fixed_fee, 0), true);
    v_sub := v_sub + v_amount;
    v_min := least(coalesce(v_min, t.scheduled_start::date), t.scheduled_start::date);
    v_max := greatest(coalesce(v_max, t.scheduled_start::date), t.scheduled_start::date);
  end loop;
  if (select count(*) from public.freelancer_invoice_lines where freelancer_invoice_id = v_inv) <> cardinality(p_timesheet_ids) then
    raise exception 'Some selected timesheets were not found or have no agreed rate' using errcode = 'P0001';
  end if;
  update public.freelancer_invoices set subtotal = round(v_sub, 2), vat_amount = round(v_sub * p_vat_rate / 100, 2),
         total = round(v_sub, 2) + round(v_sub * p_vat_rate / 100, 2), period_start = v_min, period_end = v_max,
         matched_minutes = (select sum(worked_minutes) from public.timesheets where id = any (p_timesheet_ids))
  where id = v_inv;
  perform app.notify_permission_holders(w.agency_id, 'purchase_invoices.approve', 'purchase_invoice.submitted', 'Freelancer invoice submitted',
                                        format('%s %s · %s', w.first_name, w.last_name, p_supplier_invoice_number), '/admin/purchase-invoices', 'freelancer_invoice', v_inv, 'fi-' || v_inv);
  return v_inv;
exception
  when unique_violation then raise exception 'One of these timesheets has already been invoiced, or the invoice number was used before' using errcode = 'P0001';
end;
$$;
revoke all on function public.submit_freelancer_invoice(uuid, text, date, uuid[], numeric, text, text) from public, anon;
grant execute on function public.submit_freelancer_invoice(uuid, text, date, uuid[], numeric, text, text) to authenticated;

create or replace function public.review_freelancer_invoice(p_invoice_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.freelancer_invoices;
  v_user uuid;
begin
  select * into f from public.freelancer_invoices where id = p_invoice_id for update;
  if f.id is null or not app.has_permission(f.agency_id, 'purchase_invoices.approve') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if f.status not in ('submitted', 'under_review') then raise exception 'This invoice has already been decided' using errcode = 'P0001'; end if;
  if not p_approve and coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Explain why the invoice is rejected' using errcode = 'P0001'; end if;
  if p_approve and exists (select 1 from public.freelancer_invoice_lines where freelancer_invoice_id = f.id and not matched) then
    raise exception 'Unmatched lines must be resolved before approval' using errcode = 'P0001';
  end if;
  update public.freelancer_invoices set status = case when p_approve then 'approved' else 'rejected' end,
         review_note = nullif(trim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now(),
         approved_by = case when p_approve then auth.uid() end, approved_at = case when p_approve then now() end
  where id = f.id;
  select user_id into v_user from public.workers where id = f.worker_id;
  perform app.notify(f.agency_id, v_user, 'purchase_invoice.' || case when p_approve then 'approved' else 'rejected' end,
                     case when p_approve then 'Invoice approved for payment' else 'Invoice rejected' end,
                     coalesce(p_note, f.supplier_invoice_number), '/worker/earnings', 'freelancer_invoice', f.id, 'fi-review-' || f.id);
end;
$$;
revoke all on function public.review_freelancer_invoice(uuid, boolean, text) from public, anon;
grant execute on function public.review_freelancer_invoice(uuid, boolean, text) to authenticated;

create or replace function public.mark_freelancer_invoice_paid(p_invoice_id uuid, p_paid_on date, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.freelancer_invoices;
  v_user uuid;
begin
  select * into f from public.freelancer_invoices where id = p_invoice_id for update;
  if f.id is null or not app.has_permission(f.agency_id, 'payments.record') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if f.status not in ('approved', 'scheduled') then raise exception 'Only approved invoices can be marked paid' using errcode = 'P0001'; end if;
  update public.freelancer_invoices set status = 'paid', paid_on = p_paid_on, payment_reference = p_reference where id = f.id;
  select user_id into v_user from public.workers where id = f.worker_id;
  perform app.notify(f.agency_id, v_user, 'purchase_invoice.paid', 'Invoice paid', f.supplier_invoice_number, '/worker/earnings', 'freelancer_invoice', f.id, 'fi-paid-' || f.id);
end;
$$;
revoke all on function public.mark_freelancer_invoice_paid(uuid, date, text) from public, anon;
grant execute on function public.mark_freelancer_invoice_paid(uuid, date, text) to authenticated;

-- Approved hours a freelancer has not yet invoiced (own only).
create or replace function public.my_uninvoiced_timesheets(p_worker_id uuid)
returns table (timesheet_id uuid, scheduled_start timestamptz, shift_title text, worked_minutes integer, hourly_amount numeric, fixed_fee numeric, amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select ts.id, ts.scheduled_start, s.title, ts.worked_minutes, snap.worker_hourly_amount, snap.worker_fixed_fee,
         coalesce(round(ts.worked_minutes / 60.0 * snap.worker_hourly_amount, 2), 0) + coalesce(snap.worker_fixed_fee, 0)
  from public.timesheets ts
  join public.shifts s on s.id = ts.shift_id
  join public.shift_rate_snapshots snap on snap.assignment_id = ts.assignment_id
  where ts.worker_id = p_worker_id and app.is_worker_self(p_worker_id) and ts.status in ('agency_approved', 'locked')
    and not exists (select 1 from public.freelancer_invoice_lines l join public.freelancer_invoices f on f.id = l.freelancer_invoice_id
                    where l.timesheet_id = ts.id and f.status <> 'rejected')
  order by ts.scheduled_start
$$;
revoke all on function public.my_uninvoiced_timesheets(uuid) from public, anon;
grant execute on function public.my_uninvoiced_timesheets(uuid) to authenticated;

-- A rejected invoice frees its timesheets for resubmission.
drop index public.freelancer_invoice_lines_timesheet_uidx;
create or replace function app.check_freelancer_line_unique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.timesheet_id is not null and exists (
       select 1 from public.freelancer_invoice_lines l join public.freelancer_invoices f on f.id = l.freelancer_invoice_id
       where l.timesheet_id = new.timesheet_id and l.id <> new.id and f.status <> 'rejected') then
    raise exception 'This timesheet has already been invoiced' using errcode = '23505';
  end if;
  return new;
end;
$$;
create trigger trg_freelancer_invoice_lines_unique before insert or update of timesheet_id on public.freelancer_invoice_lines
  for each row execute function app.check_freelancer_line_unique();

-- ---------------------------------------------------------------------------
-- Financial summary (estimates clearly separated from actuals)
-- ---------------------------------------------------------------------------
create or replace function public.financial_summary(p_agency_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz text;
  v_rev numeric; v_credit numeric;
  v_wage numeric; v_employer numeric; v_free numeric;
  v_by_client jsonb; v_by_industry jsonb; v_by_month jsonb;
begin
  if not app.has_permission(p_agency_id, 'finance.read') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select timezone into tz from public.agencies where id = p_agency_id;

  select coalesce(sum(subtotal) filter (where kind = 'invoice'), 0), coalesce(-sum(subtotal) filter (where kind = 'credit_note'), 0)
    into v_rev, v_credit
  from public.invoices where agency_id = p_agency_id and status not in ('draft', 'review', 'cancelled') and issue_date between p_from and p_to;

  with costs as (
    select ts.client_id, w.engagement_type,
           ts.worked_minutes / 60.0 * coalesce(snap.worker_hourly_amount, 0) + coalesce(snap.worker_fixed_fee, 0) as direct,
           case when w.engagement_type = 'employee' then (ts.worked_minutes / 60.0 * coalesce(snap.worker_hourly_amount, 0)) * coalesce(snap.employer_cost_percentage, 0) / 100 else 0 end as employer,
           date_trunc('month', ts.scheduled_start at time zone tz)::date as month
    from public.timesheets ts
    join public.workers w on w.id = ts.worker_id
    left join public.shift_rate_snapshots snap on snap.assignment_id = ts.assignment_id
    where ts.agency_id = p_agency_id and ts.status in ('agency_approved', 'locked')
      and (ts.scheduled_start at time zone tz)::date between p_from and p_to
  )
  select coalesce(sum(direct) filter (where engagement_type = 'employee'), 0), coalesce(sum(employer), 0), coalesce(sum(direct) filter (where engagement_type = 'freelancer'), 0)
    into v_wage, v_employer, v_free from costs;

  with rev as (
    select client_id, sum(case when kind = 'invoice' then subtotal else subtotal end) as revenue
    from public.invoices where agency_id = p_agency_id and status not in ('draft', 'review', 'cancelled') and issue_date between p_from and p_to
    group by client_id
  ), cost as (
    select ts.client_id, sum(ts.worked_minutes / 60.0 * coalesce(snap.worker_hourly_amount, 0) * (1 + case when w.engagement_type = 'employee' then coalesce(snap.employer_cost_percentage, 0) / 100 else 0 end) + coalesce(snap.worker_fixed_fee, 0)) as cost,
           sum(ts.worked_minutes) as minutes
    from public.timesheets ts join public.workers w on w.id = ts.worker_id
    left join public.shift_rate_snapshots snap on snap.assignment_id = ts.assignment_id
    where ts.agency_id = p_agency_id and ts.status in ('agency_approved', 'locked') and (ts.scheduled_start at time zone tz)::date between p_from and p_to
    group by ts.client_id
  ), joined as (
    select c.id, c.name, coalesce(i.name, 'Unspecified') as industry, coalesce(rev.revenue, 0) as revenue, coalesce(cost.cost, 0) as cost, coalesce(cost.minutes, 0) as minutes
    from public.clients c left join rev on rev.client_id = c.id left join cost on cost.client_id = c.id left join public.industries i on i.id = c.industry_id
    where c.agency_id = p_agency_id and (rev.client_id is not null or cost.client_id is not null)
  )
  select coalesce(jsonb_agg(jsonb_build_object('client_id', id, 'client', name, 'industry', industry, 'revenue', round(revenue, 2), 'cost', round(cost, 2),
                                               'margin', round(revenue - cost, 2), 'hours', round(minutes / 60.0, 1)) order by revenue desc), '[]'::jsonb),
         (select coalesce(jsonb_agg(x order by (x ->> 'revenue')::numeric desc), '[]'::jsonb) from (
            select jsonb_build_object('industry', industry, 'revenue', round(sum(revenue), 2), 'cost', round(sum(cost), 2), 'margin', round(sum(revenue - cost), 2)) x
            from joined group by industry) q)
    into v_by_client, v_by_industry
  from joined;

  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'revenue', round(r, 2), 'cost', round(cst, 2)) order by m), '[]'::jsonb) into v_by_month
  from (
    select coalesce(a.m, b.m) m, coalesce(a.r, 0) r, coalesce(b.c, 0) cst from
      (select date_trunc('month', issue_date)::date m, sum(subtotal) r from public.invoices
       where agency_id = p_agency_id and status not in ('draft', 'review', 'cancelled') and issue_date between p_from and p_to group by 1) a
      full join
      (select date_trunc('month', ts.scheduled_start at time zone tz)::date m,
              sum(ts.worked_minutes / 60.0 * coalesce(snap.worker_hourly_amount, 0) * (1 + case when w.engagement_type = 'employee' then coalesce(snap.employer_cost_percentage, 0) / 100 else 0 end) + coalesce(snap.worker_fixed_fee, 0)) c
       from public.timesheets ts join public.workers w on w.id = ts.worker_id left join public.shift_rate_snapshots snap on snap.assignment_id = ts.assignment_id
       where ts.agency_id = p_agency_id and ts.status in ('agency_approved', 'locked') and (ts.scheduled_start at time zone tz)::date between p_from and p_to group by 1) b
      on a.m = b.m
  ) z;

  return jsonb_build_object(
    'revenue', round(v_rev, 2), 'credit_notes', round(v_credit, 2), 'net_revenue', round(v_rev - v_credit, 2),
    'employee_wage_cost', round(v_wage, 2), 'employer_cost_estimate', round(v_employer, 2), 'freelancer_cost', round(v_free, 2),
    'direct_cost_estimate', round(v_wage + v_employer + v_free, 2),
    'contribution_margin_estimate', round(v_rev - v_credit - v_wage - v_employer - v_free, 2),
    'by_client', v_by_client, 'by_industry', v_by_industry, 'by_month', v_by_month,
    'note', 'Estimated contribution margin = net invoiced revenue minus direct staffing cost (wages from rate snapshots, configured employer-cost estimates, freelancer rates). It is not net profit.'
  );
end;
$$;
revoke all on function public.financial_summary(uuid, date, date) from public, anon;
grant execute on function public.financial_summary(uuid, date, date) to authenticated;
