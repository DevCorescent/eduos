import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { AskAssistant } from "./AskAssistant";

export const metadata: Metadata = { title: "AI Assistant" };

/**
 * PRD §57 "AI Assistant" — §40.1's student assistant.
 *
 * The only one of the eight §57 items added in this pass that is NOT a stub:
 * POST /api/ai/ask is built and its guard admits STUDENT. §40.1 names eleven
 * capabilities and this delivers the first — "ask questions", "explain
 * concepts". The other ten need course context the LMS (§14) does not exist to
 * provide yet.
 *
 * A Server Component wrapping one client island: the page frame, heading and
 * metadata render on the server, and only the ask-and-answer exchange ships
 * JavaScript.
 */
export default function StudentAiAssistantPage() {
  return (
    <>
      <PageHeader
        title="AI Assistant"
        subtitle="Ask a question about a concept and get an explanation."
      />
      <AskAssistant />
    </>
  );
}
