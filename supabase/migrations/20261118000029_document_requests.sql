-- ============================================================================
-- ShiftPilot — 0029 Document requests
--
-- The agency asks a worker for a document (a configured type, or any other
-- document described in words), with a message and an optional due date.
-- Each request is backed by a documents row, so the worker's upload lands on
-- exactly that document. Status: open → submitted (file uploaded) →
-- completed (verified). A rejected file re-opens the request; staff may
-- cancel. Workers are notified, reminded manually or automatically when the
-- due date has passed.
-- ============================================================================

create table public.document_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  worker_id uuid not null,
  document_type_id uuid not null,
  document_id uuid not null,
  title text not null check (length(title) between 1 and 160),
  message text check (length(message) <= 2000),
  due_on date,
  status text not null default 'open' check (status in ('open', 'submitted', 'completed', 'cancelled')),
  requested_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (length(cancel_reason) <= 500),
  last_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_id, worker_id) references public.workers(agency_id, id) on delete restrict,
  foreign key (agency_id, document_type_id) references public.document_types(agency_id, id) on delete restrict,
  foreign key (agency_id, document_id) references public.documents(agency_id, id) on delete restrict
);
create index document_requests_worker_idx on public.document_requests (worker_id, status);
create index document_requests_agency_idx on public.document_requests (agency_id, status, due_on);
create index document_requests_document_idx on public.document_requests (document_id);
alter table public.document_requests enable row level security;
select app.attach_standard_triggers('public.document_requests');

-- Staff with documents.read see all requests; workers see their own. Writes go through the functions below.
create policy document_requests_select on public.document_requests for select to authenticated
  using (app.has_permission(agency_id, 'documents.read') or app.is_worker_self(worker_id));
grant select on public.document_requests to authenticated;
revoke all on public.document_requests from anon;
revoke insert, update, delete on public.document_requests from authenticated;

/** The agency's catch-all type for documents requested in words ("Other document"). */
create or replace function app.additional_document_type(p_agency uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v uuid;
begin
  select id into v from public.document_types where agency_id = p_agency and key = 'additional_document';
  if v is null then
    insert into public.document_types (agency_id, key, name, applies_to, requires_expiry, is_sensitive, client_visible)
    values (p_agency, 'additional_document', 'Other document', 'worker', false, false, false)
    on conflict (agency_id, key) do update set name = excluded.name
    returning id into v;
  end if;
  return v;
end;
$$;

/**
 * Requests a document from one or more workers. Pass a document type, or
 * leave it empty and describe the document in p_title. Returns the number of
 * requests created (workers who already have an open request for the same
 * thing are skipped).
 */
create or replace function public.request_documents(p_agency_id uuid, p_worker_ids uuid[], p_document_type_id uuid,
                                                    p_title text, p_message text default null, p_due_on date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.document_types;
  w public.workers;
  v_type uuid := p_document_type_id;
  v_title text;
  v_doc uuid;
  v_count integer := 0;
begin
  if not app.has_permission(p_agency_id, 'documents.upload') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if coalesce(cardinality(p_worker_ids), 0) = 0 then raise exception 'Choose at least one worker' using errcode = 'P0001'; end if;
  if cardinality(p_worker_ids) > 500 then raise exception 'Request from at most 500 workers at a time' using errcode = 'P0001'; end if;
  if p_due_on is not null and p_due_on < current_date then raise exception 'The due date is in the past' using errcode = 'P0001'; end if;
  if v_type is null then
    if coalesce(length(trim(p_title)), 0) < 3 then raise exception 'Describe the document you need' using errcode = 'P0001'; end if;
    v_type := app.additional_document_type(p_agency_id);
  end if;
  select * into t from public.document_types where id = v_type and agency_id = p_agency_id and status = 'active';
  if t.id is null then raise exception 'Unknown document type' using errcode = 'P0002'; end if;
  if t.applies_to <> 'worker' then raise exception 'Business documents are uploaded by the freelancer under Earnings; request a worker document type instead' using errcode = 'P0001'; end if;
  v_title := left(coalesce(nullif(trim(p_title), ''), t.name), 160);

  for w in select * from public.workers where id = any (p_worker_ids) and agency_id = p_agency_id and status <> 'archived' loop
    -- Skip duplicates of an open request for the same type and title.
    continue when exists (select 1 from public.document_requests r where r.worker_id = w.id and r.document_type_id = t.id
                          and lower(r.title) = lower(v_title) and r.status in ('open', 'submitted'));
    v_doc := null;
    if t.key <> 'additional_document' then
      select d.id into v_doc from public.documents d
      where d.worker_id = w.id and d.document_type_id = t.id and d.archived_at is null
      order by d.created_at desc limit 1;
    end if;
    if v_doc is null then
      insert into public.documents (agency_id, document_type_id, owner_type, worker_id, title, uploaded_by)
      values (p_agency_id, t.id, 'worker', w.id, v_title, auth.uid())
      returning id into v_doc;
    end if;
    insert into public.document_requests (agency_id, worker_id, document_type_id, document_id, title, message, due_on, requested_by)
    values (p_agency_id, w.id, t.id, v_doc, v_title, nullif(left(trim(coalesce(p_message, '')), 2000), ''), p_due_on, auth.uid());
    perform app.notify(p_agency_id, w.user_id, 'document.requested', 'Document requested: ' || v_title,
                       coalesce(nullif(trim(coalesce(p_message, '')), ''), 'Please upload it in the app')
                         || case when p_due_on is not null then ' (due ' || to_char(p_due_on, 'DD Mon YYYY') || ')' else '' end,
                       '/worker/documents', 'document', v_doc, 'doc-request-' || v_doc || '-' || extract(epoch from now())::bigint);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.cancel_document_request(p_request_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.document_requests;
begin
  select * into r from public.document_requests where id = p_request_id for update;
  if r.id is null or not app.has_permission(r.agency_id, 'documents.upload') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if r.status not in ('open', 'submitted') then raise exception 'This request is already closed' using errcode = 'P0001'; end if;
  update public.document_requests set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(left(trim(coalesce(p_reason, '')), 500), '')
  where id = r.id;
  -- An empty placeholder document created for the request is archived with it.
  update public.documents set archived_at = now() where id = r.document_id and current_version = 0 and archived_at is null
    and not exists (select 1 from public.document_requests o where o.document_id = r.document_id and o.id <> r.id and o.status in ('open', 'submitted'));
end;
$$;

create or replace function public.remind_document_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.document_requests; v_user uuid;
begin
  select * into r from public.document_requests where id = p_request_id for update;
  if r.id is null or not app.has_permission(r.agency_id, 'documents.upload') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if r.status <> 'open' then raise exception 'Only open requests can be reminded' using errcode = 'P0001'; end if;
  if r.last_reminded_at > now() - interval '1 hour' then raise exception 'A reminder was sent less than an hour ago' using errcode = 'P0001'; end if;
  select user_id into v_user from public.workers where id = r.worker_id;
  if v_user is null then raise exception 'This worker has no portal account yet' using errcode = 'P0001'; end if;
  update public.document_requests set last_reminded_at = now() where id = r.id;
  perform app.notify(r.agency_id, v_user, 'document.request_reminder', 'Reminder: please upload ' || r.title,
                     coalesce(r.message, 'The agency is waiting for this document')
                       || case when r.due_on is not null then ' (due ' || to_char(r.due_on, 'DD Mon YYYY') || ')' else '' end,
                     '/worker/documents', 'document', r.document_id, 'doc-remind-' || r.id || '-' || extract(epoch from now())::bigint);
end;
$$;

/** Cron: remind workers of overdue open requests at most every 3 days. Service role only. */
create or replace function public.remind_overdue_document_requests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in
    select q.*, w.user_id from public.document_requests q join public.workers w on w.id = q.worker_id
    where q.status = 'open' and q.due_on < current_date and w.user_id is not null
      and (q.last_reminded_at is null or q.last_reminded_at < now() - interval '3 days')
    limit 1000
  loop
    update public.document_requests set last_reminded_at = now() where id = r.id;
    perform app.notify(r.agency_id, r.user_id, 'document.request_reminder', 'Overdue: please upload ' || r.title,
                       'This document was due on ' || to_char(r.due_on, 'DD Mon YYYY') || '.',
                       '/worker/documents', 'document', r.document_id, 'doc-overdue-' || r.id || '-' || current_date);
    perform app.notify_permission_holders(r.agency_id, 'documents.upload', 'document.request_overdue', 'Document overdue: ' || r.title,
                                          'A requested document has not been uploaded yet.', '/admin/documents?tab=requests&filter=overdue',
                                          'document', r.document_id, 'doc-overdue-staff-' || r.id || '-' || current_date);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Upload → submitted; verified → completed; rejected → open again.
create or replace function app.document_requests_on_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.document_requests set status = 'submitted', submitted_at = now()
  where document_id = new.document_id and status = 'open';
  return new;
end;
$$;
create trigger trg_document_versions_requests after insert on public.document_versions
  for each row execute function app.document_requests_on_version();

create or replace function app.document_requests_on_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'verified' and old.status is distinct from 'verified' then
    update public.document_requests set status = 'completed', completed_at = now()
    where document_id = new.id and status in ('open', 'submitted');
  elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
    update public.document_requests set status = 'open', submitted_at = null
    where document_id = new.id and status = 'submitted';
  end if;
  return new;
end;
$$;
create trigger trg_documents_requests_review after update of status on public.documents
  for each row execute function app.document_requests_on_review();

-- Worker documents with request and version details (worker self or staff), for the portals.
create or replace function public.worker_document_requests(p_worker_id uuid)
returns table (id uuid, document_id uuid, document_type_id uuid, type_name text, title text, message text, due_on date, status text,
               created_at timestamptz, submitted_at timestamptz, completed_at timestamptz, last_reminded_at timestamptz,
               document_status public.verification_status, current_version integer, rejection_reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.document_id, r.document_type_id, t.name, r.title, r.message, r.due_on, r.status, r.created_at, r.submitted_at, r.completed_at,
         r.last_reminded_at, d.status, d.current_version, d.rejection_reason
  from public.document_requests r
  join public.document_types t on t.id = r.document_type_id
  join public.documents d on d.id = r.document_id
  join public.workers w on w.id = r.worker_id
  where r.worker_id = p_worker_id
    and (app.is_worker_self(p_worker_id) or app.has_permission(w.agency_id, 'documents.read'))
  order by case r.status when 'open' then 0 when 'submitted' then 1 when 'completed' then 2 else 3 end, r.due_on nulls last, r.created_at desc
$$;

revoke all on function public.request_documents(uuid, uuid[], uuid, text, text, date) from public, anon;
revoke all on function public.cancel_document_request(uuid, text) from public, anon;
revoke all on function public.remind_document_request(uuid) from public, anon;
revoke all on function public.worker_document_requests(uuid) from public, anon;
revoke all on function public.remind_overdue_document_requests() from public, anon, authenticated;
revoke all on function app.additional_document_type(uuid) from public, anon, authenticated;
grant execute on function public.request_documents(uuid, uuid[], uuid, text, text, date) to authenticated;
grant execute on function public.cancel_document_request(uuid, text) to authenticated;
grant execute on function public.remind_document_request(uuid) to authenticated;
grant execute on function public.worker_document_requests(uuid) to authenticated;
grant execute on function public.remind_overdue_document_requests() to service_role;
