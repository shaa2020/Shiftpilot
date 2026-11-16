-- ============================================================================
-- ShiftPilot — 0018 Integrity fix: rate rule locations must exist in the same
-- agency (composite FK, like every other tenant reference).
-- ============================================================================
alter table public.client_rate_rules
  add constraint client_rate_rules_location_fk
  foreign key (agency_id, location_id) references public.client_locations(agency_id, id) on delete restrict;
