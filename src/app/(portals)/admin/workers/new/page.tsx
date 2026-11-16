import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { ServerForm } from "@/components/forms/server-form";
import { WorkerFields } from "../worker-fields";
import { createWorkerAction } from "../actions";

export const metadata: Metadata = { title: "New worker" };

export default async function NewWorkerPage() {
  await requireStaff("workers.write");
  return (
    <>
      <PageHeader title="New worker" description="The worker starts in onboarding. They can be activated once identity, work eligibility and their contract or freelancer review are complete." />
      <Card>
        <CardContent className="pt-5">
          <ServerForm action={createWorkerAction} submitLabel="Create worker" pendingLabel="Creating…" toastOnSuccess={false}>
            <WorkerFields isNew />
          </ServerForm>
        </CardContent>
      </Card>
    </>
  );
}
