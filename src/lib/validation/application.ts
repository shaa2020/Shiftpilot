import { z } from "zod";
import { optionalText } from "./agency";
import { emailSchema } from "./auth";

export const PRIVACY_NOTICE_VERSION = "platform-2026-11";
export const MAX_CV_BYTES = 10 * 1024 * 1024;

export const applicationSchema = z.object({
  first_name: z.string().trim().min(1, "Enter your first name").max(80),
  last_name: z.string().trim().min(1, "Enter your last name").max(80),
  email: emailSchema,
  phone: optionalText(30),
  city: optionalText(100),
  preferred_engagement: z.enum(["employee", "freelancer"]).or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
  motivation: optionalText(5000),
  source: optionalText(80),
  privacy: z.literal("on", { message: "Please confirm you have read the privacy notice" }),
  talent_pool: z.preprocess((v) => v === "on", z.boolean()),
  // Honeypot: must stay empty (bots fill every field).
  website: z.string().max(0).optional(),
});

/** Detect PDF / DOCX by magic bytes, never by the client-supplied name or type. */
export function detectCvType(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return { mime: "application/pdf", ext: "pdf" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
  }
  return null;
}
