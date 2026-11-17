import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "./session";

/** Signed-in user without the aal2 check — only for the MFA challenge and enrolment flows. */
export async function requireUserNoMfa() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
