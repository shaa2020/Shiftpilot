import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { isAssistantConfigured } from "@/lib/assistant/run";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { AssistantChat } from "@/components/assistant/chat";
import { askAssistantAction } from "./actions";

export const metadata: Metadata = { title: "Assistant" };

export default async function AssistantPage() {
  await requireStaff("dashboard.view");
  return (
    <>
      <PageHeader title="Operations assistant" description="Ask questions about your operations. The assistant only reads data you already have access to and cannot approve, assign or change anything. Check important answers against the source pages." />
      <Card>
        <CardContent className="pt-5">
          {isAssistantConfigured() ? <AssistantChat ask={askAssistantAction} /> : (
            <EmptyState icon={Bot} title="Awaiting configuration" description="Set ANTHROPIC_API_KEY on the server to enable the assistant. Questions and the data the assistant looks up are sent to Anthropic for processing; record this in your processing register first." />
          )}
        </CardContent>
      </Card>
    </>
  );
}
