import { z } from "zod";
import { optionalText } from "./agency";
import { emailSchema } from "./auth";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const optDate = date.or(z.literal("")).transform((v) => (v === "" ? null : v)).optional();
const optNum = (min: number, max: number) =>
  z.union([z.literal(""), z.coerce.number().min(min).max(max)]).transform((v) => (v === "" ? null : v)).optional();

export const workerSchema = z.object({
  first_name: z.string().trim().min(1, "Enter the first name").max(80),
  last_name: z.string().trim().min(1, "Enter the last name").max(80),
  display_name: optionalText(80),
  email: emailSchema,
  phone: optionalText(30),
  engagement_type: z.enum(["employee", "freelancer"]),
  city: optionalText(100),
  postal_code: optionalText(12),
  max_travel_km: optNum(0, 500),
  professional_summary: optionalText(2000),
});

export const workerProfileSchema = workerSchema.omit({ engagement_type: true, email: true });

export const privateDetailsSchema = z.object({
  date_of_birth: optDate,
  address_line1: optionalText(200),
  emergency_contact_name: optionalText(120),
  emergency_contact_phone: optionalText(30),
  emergency_contact_relationship: optionalText(60),
  identity_verification_status: z.enum(["not_submitted", "pending", "verified", "rejected", "expired"]),
  work_eligibility_status: z.enum(["not_submitted", "pending", "verified", "rejected", "expired"]),
  work_eligibility_expires_on: optDate,
});

export const skillSchema = z.object({
  skill_id: z.string().uuid("Choose a skill"),
  level: z.coerce.number().int().min(1).max(5),
  years_experience: optNum(0, 60),
});

export const languageSchema = z.object({
  language_code: z.string().trim().toLowerCase().regex(/^[a-z]{2}$/, "Use a two-letter language code"),
  level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "native"]),
});

export const certificateSchema = z
  .object({
    certificate_id: z.string().uuid("Choose a certificate"),
    certificate_number: optionalText(80),
    issued_on: optDate,
    expires_on: optDate,
  })
  .refine((d) => !d.expires_on || !d.issued_on || d.expires_on >= d.issued_on, { path: ["expires_on"], message: "Expiry must be after issue date" });

export const availabilitySchema = z
  .object({
    kind: z.enum(["recurring", "available", "unavailable"]),
    day_of_week: z.union([z.literal(""), z.coerce.number().int().min(1).max(7)]).transform((v) => (v === "" ? null : v)).optional(),
    start_time: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
    end_time: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
    date_from: optDate,
    date_to: optDate,
    note: optionalText(200),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "recurring") {
      if (!d.day_of_week) ctx.addIssue({ code: "custom", path: ["day_of_week"], message: "Choose a day" });
      if (!d.start_time || !d.end_time) ctx.addIssue({ code: "custom", path: ["start_time"], message: "Enter start and end time" });
    } else {
      if (!d.date_from || !d.date_to) ctx.addIssue({ code: "custom", path: ["date_from"], message: "Enter both dates" });
      else if (d.date_to < d.date_from) ctx.addIssue({ code: "custom", path: ["date_to"], message: "End date must be after the start date" });
    }
  });

export const employmentContractSchema = z.object({
  contract_number: z.string().trim().min(2).max(50),
  contract_kind: z.string().trim().min(2, "Describe the contract type").max(80),
  start_date: date,
  end_date: optDate,
  contracted_hours_per_week: optNum(0, 60),
});

export const wageRateSchema = z.object({
  contract_id: z.string().uuid("Choose a contract"),
  position_id: z.string().uuid().or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
  hourly_gross: z.coerce.number().positive("Enter the gross hourly wage").max(1000),
  effective_from: date,
  reason: optionalText(200),
});

export const businessSchema = z.object({
  trade_name: z.string().trim().min(2, "Enter the trade name").max(200),
  legal_form: z.string().trim().min(2).max(60).default("eenmanszaak"),
  kvk_number: optionalText(8).refine((v) => !v || /^[0-9]{8}$/.test(v), "KvK numbers have 8 digits"),
  vat_number: optionalText(20),
  vat_liable: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  small_business_scheme: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  liability_insurance: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  liability_insurance_expires_on: optDate,
  address_line1: optionalText(200),
  postal_code: optionalText(12),
  city: optionalText(100),
});

export const freelancerAgreementSchema = z.object({
  agreement_number: z.string().trim().min(2).max(50),
  start_date: date,
  end_date: optDate,
  service_description: z.string().trim().min(10, "Describe the services (at least 10 characters)").max(2000),
  model_agreement_reference: optionalText(200),
});

export const freelancerRateSchema = z.object({
  agreement_id: z.string().uuid("Choose an agreement"),
  position_id: z.string().uuid().or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
  hourly_rate: z.coerce.number().positive("Enter the hourly rate").max(1000),
  effective_from: date,
});
