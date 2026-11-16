import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { ServerForm } from "@/components/forms/server-form";
import { ClientFields } from "../client-fields";
import { createClientAction } from "../actions";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage() {
  const ctx = await requireStaff("clients.write");
  const supabase = await createClient();
  const { data: industries } = await supabase.from("industries").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").order("sort_order");
  return (
    <>
      <PageHeader title="New client" description="You can add locations, contacts, contracts and portal users after saving." />
      <Card>
        <CardContent className="pt-5">
          <ServerForm action={createClientAction} submitLabel="Create client" pendingLabel="Creating…" toastOnSuccess={false}>
            <ClientFields industries={industries ?? []} />
          </ServerForm>
        </CardContent>
      </Card>
    </>
  );
}
