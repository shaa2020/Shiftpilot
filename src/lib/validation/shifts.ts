import { z } from "zod";
import { optionalText } from "./agency";

const time = z.string().regex(/^\d{2}:\d{2}$/, "Enter a time");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

export const shiftFormSchema = z
  .object({
    location_id: z.string().uuid("Choose a location"),
    title: z.string().trim().min(2, "Enter a title").max(200),
    date,
    start_time: time,
    end_time: time,
    break_minutes: z.coerce.number().int().min(0).max(240).default(0),
    position_id: z.string().uuid("Choose a position"),
    headcount: z.coerce.number().int().min(1).max(500),
    allow_freelancers: z.preprocess((v) => v === "on", z.boolean()),
    required_language_code: z.string().trim().toLowerCase().regex(/^[a-z]{2}$/).or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
    dress_code: optionalText(300),
    instructions: optionalText(5000),
    status: z.enum(["draft", "open"]).default("open"),
    repeat_days: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.coerce.number().int().min(1).max(7))),
    repeat_until: date.or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.repeat_days.length > 0 && !d.repeat_until) ctx.addIssue({ code: "custom", path: ["repeat_until"], message: "Choose when the series ends" });
    if (d.repeat_until && d.repeat_until < d.date) ctx.addIssue({ code: "custom", path: ["repeat_until"], message: "The series must end after the first shift" });
  });

export const rescheduleSchema = z.object({ date, start_time: time, end_time: time, break_minutes: z.coerce.number().int().min(0).max(240) });
