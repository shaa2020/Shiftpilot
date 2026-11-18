import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/security/request";

export async function POST() {
  // CSRF defence: only accept same-origin form posts.
  if (!(await isSameOrigin())) return new NextResponse("Forbidden", { status: 403 });
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) await supabase.from("user_sessions").insert({ user_id: data.user.id, event: "sign_out" });
  await supabase.auth.signOut();
  // Relative redirect: always the same site the user is on (behind any proxy or alias).
  return new NextResponse(null, { status: 303, headers: { Location: "/login" } });
}
