"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";

export async function addHolidayAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("rates.write");
  const parsed = z.object({ holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"), name: z.string().trim().min(2, "Name the holiday").max(80) }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("public_holidays").insert({ ...parsed.data, agency_id: ctx.agencyId });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/admin/finance");
  return { ok: true, message: "Holiday added." };
}

export async function removeHolidayAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("rates.write");
  const supabase = await createClient();
  const { error } = await supabase.from("public_holidays").delete().eq("id", z.string().uuid().parse(fd.get("id")));
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/finance");
  return { ok: true, message: "Removed." };
}
