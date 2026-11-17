-- ============================================================================
-- ShiftPilot — 0022 Documents, compliance and GDPR workflows
--   * document verification (status, expiry) with optional linkage to a
--     worker certificate, kept in sync
--   * compliance reviews for regulated positions and other review types
--   * data subject access export, anonymisation subject to legal retention,
--     and a retention job for expired applicant data
-- ============================================================================

-- Link a certificate record to its evidence document (already a column);
-- verifying the document verifies the linked certificate.
create or replace function public.verify_document(p_document_id uuid, p_approve boolean, p_expires_on date default null, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.documents;
  v_user uuid;
begin
  select * into d from public.documents where id = p_document_id for update;
  if d.id is null or not app.has_permission(d.agency_id, 'documents.verify') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if d.current_version = 0 then raise exception 'No file has been uploaded for this document' using errcode = 'P0001'; end if;
  if not p_approve and coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Give a reason for the rejection' using errcode = 'P0001'; end if;
  if (select requires_expiry from public.document_types where id = d.document_type_id) and p_approve and coalesce(p_expires_on, d.expires_on) is null then
    raise exception 'This document type requires an expiry date' using errcode = 'P0001';
  end if;
  update public.documents set status = case when p_approve then 'verified'::public.verification_status else 'rejected'::public.verification_status end,
         verified_by = auth.uid(), verified_at = now(), rejection_reason = case when p_approve then null else p_reason end,
         expires_on = coalesce(p_expires_on, expires_on)
  where id = d.id;
  update public.worker_certificates set status = case when p_approve then 'verified'::public.verification_status else 'rejected'::public.verification_status end,
         verified_by = auth.uid(), verified_at = now(), expires_on = coalesce(p_expires_on, expires_on)
  where document_id = d.id;
  update public.worker_qualifications set status = case when p_approve then 'verified'::public.verification_status else 'rejected'::public.verification_status end,
         verified_by = auth.uid(), verified_at = now(), expires_on = coalesce(p_expires_on, expires_on)
  where document_id = d.id;
  if d.worker_id is not null then
    select user_id into v_user from public.workers where id = d.worker_id;
    perform app.notify(d.agency_id, v_user, 'document.' || case when p_approve then 'verified' else 'rejected' end,
                       case when p_approve then 'Document verified' else 'Document rejected' end,
                       coalesce(p_reason, d.title), '/worker/documents', 'document', d.id, 'doc-review-' || d.id || '-' || d.current_version);
  end if;
end;
$$;
revoke all on function public.verify_document(uuid, boolean, date, text) from public, anon;
grant execute on function public.verify_document(uuid, boolean, date, text) to authenticated;

-- Notify verifiers when a new version is uploaded.
create or replace function app.notify_document_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare d public.documents;
begin
  select * into d from public.documents where id = new.document_id;
  if d.owner_type = 'worker' then
    perform app.notify_permission_holders(d.agency_id, 'documents.verify', 'document.uploaded', 'Document to verify', d.title,
                                          '/admin/documents', 'document', d.id, 'doc-upload-' || new.id);
  end if;
  return new;
end;
$$;
create trigger trg_document_versions_notify after insert on public.document_versions
  for each row execute function app.notify_document_upload();

-- Required documents per worker pathway and their state (worker self or staff).
create or replace function public.worker_document_checklist(p_worker_id uuid)
returns table (document_type_id uuid, key text, name text, required boolean, requires_expiry boolean, is_sensitive boolean,
               document_id uuid, status public.verification_status, expires_on date, current_version integer)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.key, t.name, w.engagement_type = any (coalesce(t.required_for_engagement, '{}')), t.requires_expiry, t.is_sensitive,
         d.id, d.status, d.expires_on, d.current_version
  from public.workers w
  join public.document_types t on t.agency_id = w.agency_id and t.status = 'active' and t.applies_to in ('worker', 'freelancer_business')
  left join lateral (
    select x.* from public.documents x
    where x.document_type_id = t.id and x.archived_at is null
      and (x.worker_id = w.id or x.freelancer_business_id = (select b.id from public.freelancer_businesses b where b.worker_id = w.id))
    order by x.created_at desc limit 1
  ) d on true
  where w.id = p_worker_id
    and (app.is_worker_self(p_worker_id) or app.has_permission(w.agency_id, 'documents.read'))
    and (t.applies_to = 'worker' or w.engagement_type = 'freelancer')
    and (not t.is_sensitive or app.is_worker_self(p_worker_id) or app.has_permission(w.agency_id, 'workers.sensitive.read'))
  order by 4 desc, t.name
$$;
revoke all on function public.worker_document_checklist(uuid) from public, anon;
grant execute on function public.worker_document_checklist(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Compliance reviews (generic decision helper)
-- ---------------------------------------------------------------------------
create or replace function public.decide_compliance_review(p_review_id uuid, p_outcome public.review_outcome, p_rationale text,
                                                           p_valid_until date default null, p_restrictions jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.compliance_reviews;
begin
  select * into r from public.compliance_reviews where id = p_review_id for update;
  if r.id is null or not app.has_permission(r.agency_id, 'compliance.review') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if r.status <> 'pending' then raise exception 'This review has already been decided' using errcode = 'P0001'; end if;
  if p_outcome = 'pending' then raise exception 'Choose an outcome' using errcode = 'P0001'; end if;
  if coalesce(length(trim(p_rationale)), 0) < 10 then raise exception 'Explain the decision (at least 10 characters)' using errcode = 'P0001'; end if;
  update public.compliance_reviews set status = p_outcome, rationale = p_rationale, valid_until = p_valid_until,
         restrictions = coalesce(p_restrictions, '{}'::jsonb), decided_by = auth.uid(), decided_at = now()
  where id = r.id;
  if r.review_type = 'freelancer_classification' and r.freelancer_business_id is not null then
    update public.freelancer_businesses set classification_status = p_outcome, classification_reviewed_by = auth.uid(), classification_reviewed_at = now()
    where id = r.freelancer_business_id;
  end if;
end;
$$;
revoke all on function public.decide_compliance_review(uuid, public.review_outcome, text, date, jsonb) from public, anon;
grant execute on function public.decide_compliance_review(uuid, public.review_outcome, text, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- GDPR: data subject access export
-- ---------------------------------------------------------------------------
create or replace function public.export_subject_data(p_agency_id uuid, p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_profile uuid;
  v_worker uuid;
  out jsonb;
begin
  if not app.has_permission(p_agency_id, 'gdpr.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select id into v_profile from public.profiles where lower(email) = v_email;
  select id into v_worker from public.workers where agency_id = p_agency_id and lower(email) = v_email;
  out := jsonb_build_object(
    'generated_at', now(), 'subject_email', v_email,
    'profile', (select to_jsonb(p) - 'avatar_path' from public.profiles p where p.id = v_profile),
    'sign_in_activity', (select coalesce(jsonb_agg(jsonb_build_object('event', event, 'at', created_at) order by created_at desc), '[]') from public.user_sessions where user_id = v_profile),
    'staff_roles', (select coalesce(jsonb_agg(r.name), '[]') from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = v_profile and ur.agency_id = p_agency_id),
    'client_memberships', (select coalesce(jsonb_agg(jsonb_build_object('client', c.name, 'role', m.role, 'status', m.status)), '[]') from public.client_memberships m join public.clients c on c.id = m.client_id where m.user_id = v_profile and m.agency_id = p_agency_id),
    'worker', (select to_jsonb(w) from public.workers w where w.id = v_worker),
    'worker_private_details', (select to_jsonb(pd) from public.worker_private_details pd where pd.worker_id = v_worker),
    'skills', (select coalesce(jsonb_agg(jsonb_build_object('skill', s.name, 'level', ws.level)), '[]') from public.worker_skills ws join public.skills s on s.id = ws.skill_id where ws.worker_id = v_worker),
    'languages', (select coalesce(jsonb_agg(jsonb_build_object('language', language_code, 'level', level)), '[]') from public.worker_languages where worker_id = v_worker),
    'certificates', (select coalesce(jsonb_agg(jsonb_build_object('certificate', c.name, 'status', wc.status, 'expires_on', wc.expires_on)), '[]') from public.worker_certificates wc join public.certificates c on c.id = wc.certificate_id where wc.worker_id = v_worker),
    'availability', (select coalesce(jsonb_agg(to_jsonb(a) - 'agency_id'), '[]') from public.worker_availability a where a.worker_id = v_worker),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('title', d.title, 'type', t.name, 'status', d.status, 'expires_on', d.expires_on, 'uploaded', d.created_at)), '[]') from public.documents d join public.document_types t on t.id = d.document_type_id where d.worker_id = v_worker),
    'employment_contracts', (select coalesce(jsonb_agg(jsonb_build_object('number', contract_number, 'kind', contract_kind, 'status', status, 'start', start_date, 'end', end_date)), '[]') from public.employment_contracts where worker_id = v_worker),
    'freelancer_business', (select to_jsonb(b) from public.freelancer_businesses b where b.worker_id = v_worker),
    'assignments', (select coalesce(jsonb_agg(jsonb_build_object('shift', s.title, 'start', a.starts_at, 'end', a.ends_at, 'status', a.status) order by a.starts_at desc), '[]') from public.shift_assignments a join public.shifts s on s.id = a.shift_id where a.worker_id = v_worker),
    'attendance_events', (select coalesce(jsonb_agg(jsonb_build_object('type', event_type, 'server_time', server_recorded_at, 'device_time', device_recorded_at, 'offline', is_offline_sync, 'latitude', latitude, 'longitude', longitude) order by server_recorded_at desc), '[]') from public.attendance_events where worker_id = v_worker),
    'timesheets', (select coalesce(jsonb_agg(jsonb_build_object('date', scheduled_start, 'start', actual_start, 'end', actual_end, 'worked_minutes', worked_minutes, 'status', status) order by scheduled_start desc), '[]') from public.timesheets where worker_id = v_worker),
    'applications', (select coalesce(jsonb_agg(to_jsonb(ap) - 'ai_summary'), '[]') from public.applications ap where ap.agency_id = p_agency_id and lower(ap.email) = v_email),
    'consents', (select coalesce(jsonb_agg(jsonb_build_object('purpose', purpose, 'granted', granted, 'notice_version', notice_version, 'at', recorded_at)), '[]') from public.consent_records where agency_id = p_agency_id and (user_id = v_profile or application_id in (select id from public.applications where agency_id = p_agency_id and lower(email) = v_email))),
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'at', created_at, 'read_at', read_at)), '[]') from public.notifications where recipient_user_id = v_profile and agency_id = p_agency_id)
  );
  insert into public.audit_logs (agency_id, actor_user_id, actor_role, action, table_name, context)
  values (p_agency_id, auth.uid(), auth.role(), 'gdpr.export', 'data_subject_requests', jsonb_build_object('subject_email', v_email));
  return out;
end;
$$;
revoke all on function public.export_subject_data(uuid, text) from public, anon;
grant execute on function public.export_subject_data(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- GDPR: anonymisation (records needed for legal retention keep their ids,
-- amounts and dates; personal identifiers are removed)
-- ---------------------------------------------------------------------------
create or replace function app.anonymise_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.applications set first_name = 'Anonymised', last_name = 'Applicant', email = 'anonymised+' || id || '@invalid.local',
         phone = null, city = null, motivation = null, ai_summary = null, source = null, referral_code = null
  where id = p_application_id;
  update public.documents set archived_at = coalesce(archived_at, now()), title = 'Removed' where application_id = p_application_id;
end;
$$;

create or replace function public.anonymise_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare a public.applications;
begin
  select * into a from public.applications where id = p_application_id;
  if a.id is null or not app.has_permission(a.agency_id, 'gdpr.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if a.worker_id is not null then raise exception 'This applicant became a worker; anonymise the worker record instead' using errcode = 'P0001'; end if;
  perform app.anonymise_application(a.id);
  insert into public.audit_logs (agency_id, actor_user_id, actor_role, action, table_name, record_id) values (a.agency_id, auth.uid(), auth.role(), 'gdpr.anonymise', 'applications', a.id::text);
end;
$$;
revoke all on function public.anonymise_application(uuid) from public, anon;
grant execute on function public.anonymise_application(uuid) to authenticated;

create or replace function public.anonymise_worker(p_worker_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare w public.workers;
begin
  select * into w from public.workers where id = p_worker_id for update;
  if w.id is null or not app.has_permission(w.agency_id, 'gdpr.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if w.status not in ('inactive', 'archived') then raise exception 'Deactivate or archive the worker first' using errcode = 'P0001'; end if;
  if exists (select 1 from public.shift_assignments where worker_id = w.id and status in ('invited', 'accepted', 'confirmed', 'checked_in')) then
    raise exception 'The worker still has open assignments' using errcode = 'P0001';
  end if;
  -- Contracts, timesheets, payroll and invoice lines stay (legal retention) but no longer carry contact details.
  update public.workers set first_name = 'Anonymised', last_name = 'Worker', display_name = null, email = 'anonymised+' || id || '@invalid.local',
         phone = null, city = null, postal_code = null, home_latitude = null, home_longitude = null, professional_summary = null,
         photo_path = null, user_id = null, status = 'archived'
  where id = w.id;
  update public.worker_private_details set address_line1 = null, address_line2 = null, emergency_contact_name = null,
         emergency_contact_phone = null, emergency_contact_relationship = null where worker_id = w.id;
  delete from public.worker_availability where worker_id = w.id;
  delete from public.worker_languages where worker_id = w.id;
  delete from public.worker_skills where worker_id = w.id;
  update public.attendance_events set latitude = null, longitude = null where worker_id = w.id;
  delete from public.internal_notes where subject_type = 'worker' and subject_id = w.id;
  insert into public.audit_logs (agency_id, actor_user_id, actor_role, action, table_name, record_id) values (w.agency_id, auth.uid(), auth.role(), 'gdpr.anonymise', 'workers', w.id::text);
end;
$$;
revoke all on function public.anonymise_worker(uuid) from public, anon;
grant execute on function public.anonymise_worker(uuid) to authenticated;

-- attendance_events is append-only; allow only the anonymisation of location.
create or replace function app.attendance_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - array['latitude', 'longitude', 'location_accuracy_m']) = (to_jsonb(old) - array['latitude', 'longitude', 'location_accuracy_m'])
     and new.latitude is null and new.longitude is null then
    return new;
  end if;
  raise exception 'Table public.attendance_events is append-only; % is not permitted', tg_op using errcode = 'P0001';
end;
$$;
drop trigger trg_attendance_events_append_only on public.attendance_events;
create trigger trg_attendance_events_append_only before update or delete on public.attendance_events
  for each row execute function app.attendance_events_guard();

-- Retention job (service role / scheduler): anonymise expired applicant data.
create or replace function public.apply_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_apps int := 0;
  r record;
begin
  if not app.is_service_role() and current_user not in ('postgres', 'supabase_admin') then raise exception 'Not authorised' using errcode = '42501'; end if;
  for r in select id from public.applications where retention_until < current_date and worker_id is null and email not like 'anonymised+%' loop
    perform app.anonymise_application(r.id);
    v_apps := v_apps + 1;
  end loop;
  update public.data_retention_records set last_run_at = now(), last_run_affected = v_apps where table_name = 'applications';
  return jsonb_build_object('applications_anonymised', v_apps);
end;
$$;
revoke all on function public.apply_retention() from public, anon, authenticated;
grant execute on function public.apply_retention() to service_role;

-- A new upload re-opens verification whether the previous version was verified or rejected.
create or replace function app.document_version_assign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  select current_version + 1 into v_next from public.documents where id = new.document_id for update;
  new.version := v_next;
  update public.documents
     set current_version = v_next,
         status = case when status in ('verified', 'rejected') then 'pending' else status end,
         rejection_reason = null, verified_at = null, verified_by = null
   where id = new.document_id;
  return new;
end;
$$;

-- Privacy officers are notified of every new data subject request.
create or replace function app.notify_data_subject_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify_permission_holders(new.agency_id, 'gdpr.manage', 'privacy.request', 'New data subject request',
                                        initcap(new.request_type) || ' request — due ' || to_char(new.due_at, 'YYYY-MM-DD'),
                                        '/admin/privacy', 'data_subject_request', new.id, 'dsr-' || new.id);
  return new;
end;
$$;
create trigger trg_data_subject_requests_notify after insert on public.data_subject_requests
  for each row execute function app.notify_data_subject_request();

-- Names of the agencies the signed-in user participates in (for self-service privacy requests).
create or replace function public.my_agencies()
returns table (agency_id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.name from public.agencies a where app.is_agency_participant(a.id) order by a.name
$$;
revoke all on function public.my_agencies() from public, anon;
grant execute on function public.my_agencies() to authenticated;
