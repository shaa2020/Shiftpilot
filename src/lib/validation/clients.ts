import { z } from "zod";
import { optionalText } from "./agency";
import { emailSchema } from "./auth";

const uuidOrNull = z.string().uuid().or(z.literal("")).transform((v) => (v === "" ? null : v)).nullable().optional();
const bool = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const clientSchema = z.object({
  name: z.string().trim().min(2, "Enter the client name").max(200),
  legal_name: optionalText(200),
  kvk_number: optionalText(8).refine((v) => !v || /^[0-9]{8}$/.test(v), "KvK numbers have 8 digits"),
  vat_number: optionalText(20).refine((v) => !v || /^[A-Z]{2}[0-9A-Z]{2,13}$/i.test(v), "Enter a valid EU VAT number"),
  industry_id: uuidOrNull,
  status: z.enum(["onboarding", "active", "on_hold"]).default("onboarding"),
  billing_email: optionalText(254).refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email"),
  billing_address_line1: optionalText(200),
  billing_postal_code: optionalText(12),
  billing_city: optionalText(100),
  billing_country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default("NL"),
  payment_term_days: z.union([z.literal(""), z.coerce.number().int().min(0).max(180)]).transform((v) => (v === "" ? null : v)).optional(),
  po_number_required: bool,
});

export const locationSchema = z.object({
  name: z.string().trim().min(2, "Enter a location name").max(120),
  address_line1: z.string().trim().min(3, "Enter the street address").max(200),
  postal_code: z.string().trim().min(4, "Enter the postal code").max(12),
  city: z.string().trim().min(2, "Enter the city").max(100),
  country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default("NL"),
  latitude: z.union([z.literal(""), z.coerce.number().min(-90).max(90)]).transform((v) => (v === "" ? null : v)).optional(),
  longitude: z.union([z.literal(""), z.coerce.number().min(-180).max(180)]).transform((v) => (v === "" ? null : v)).optional(),
  geofence_radius_m: z.union([z.literal(""), z.coerce.number().int().min(25).max(5000)]).transform((v) => (v === "" ? null : v)).optional(),
  arrival_instructions: optionalText(2000),
  parking_info: optionalText(500),
  site_contact_name: optionalText(120),
  site_contact_phone: optionalText(30),
});

export const contactSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the name").max(120),
  email: optionalText(254).refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email"),
  phone: optionalText(30),
  job_title: optionalText(120),
  is_primary: bool,
  is_billing_contact: bool,
});

export const clientInviteSchema = z.object({
  email: emailSchema,
  client_role: z.enum(["client_admin", "client_manager", "client_viewer"]),
  can_request_staff: bool,
  can_approve_timesheets: bool,
  can_view_finance: bool,
  can_manage_users: bool,
});

export const contractSchema = z
  .object({
    reference: z.string().trim().min(2, "Enter a reference").max(50),
    title: z.string().trim().min(3, "Enter a title").max(200),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date"),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
    payment_term_days: z.union([z.literal(""), z.coerce.number().int().min(0).max(180)]).transform((v) => (v === "" ? null : v)).optional(),
    notice_period_days: z.union([z.literal(""), z.coerce.number().int().min(0).max(365)]).transform((v) => (v === "" ? null : v)).optional(),
  })
  .refine((d) => !d.end_date || d.end_date >= d.start_date, { path: ["end_date"], message: "End date must be after the start date" });
