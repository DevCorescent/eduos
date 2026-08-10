"use client";

// ============================================================================
// MODULE : Student Portal — AI Assistant (PRD §40.1, §57)
// LAYER  : Presentation (client)
// PURPOSE: Ask one question, render one answer.
//
// WHY THIS PAGE IS NOT A STUB LIKE ITS SIX NEIGHBOURS
//   POST /api/ai/ask exists and its guard already admits STUDENT. Rendering
//   UnavailableState over a working endpoint would be as inaccurate in the
//   other direction as inventing a screen over a missing one.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   No conversation history, no streaming, no citations, no saved threads.
//   §40.4 AI Governance specifies conversation logs, source citations,
//   sensitive-data masking and usage limits, and NONE of that has a model —
//   there is no AiConversation table to write a thread to. Keeping this to a
//   single question and a single answer means nothing here has to be undone
//   when §40.4 is built; a fake thread UI backed by component state would.
//
//   The answer is rendered as plain text in a pre-wrapped block, not as
//   markdown or HTML. The route returns provider output verbatim, and passing
//   unsanitised provider output through a markdown renderer is how model output
//   becomes an injection surface.
// ============================================================================

import { useState, type FormEvent } from "react";
import { Send, Sparkles } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Textarea";
import { askAi } from "@/services/ai";

export function AskAssistant() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = question.trim();
    // The same rule askAiSchema applies server-side, applied here so an empty
    // submission costs no round trip. It is not a substitute for that check.
    if (trimmed.length === 0) return;

    setPending(true);
    setError(null);
    // Cleared before the request, not after: leaving the previous answer on
    // screen while a new question is in flight reads as though it answered the
    // new one.
    setAnswer(null);

    const result = await askAi(trimmed);

    setPending(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setAnswer(result.data.answer);
  }

  return (
    <div className="space-y-4">
      <Card>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Textarea
            label="Ask a question"
            placeholder="Explain the difference between a stack and a queue…"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={4}
            disabled={isPending}
          />

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Answers are generated and can be wrong. Check anything that matters
              against your course material.
            </p>

            <Button
              type="submit"
              isLoading={isPending}
              disabled={question.trim().length === 0}
              leftIcon={<Send className="size-4" />}
            >
              Ask
            </Button>
          </div>
        </form>
      </Card>

      {error && (
        <Alert variant="error" title="Could not answer that">
          {error}
        </Alert>
      )}

      {answer && (
        <Card
          header={
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-heading">Answer</h2>
            </div>
          }
        >
          {/* whitespace-pre-wrap, not a markdown renderer: the route returns
              provider output verbatim and nothing has sanitised it. */}
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
            {answer}
          </p>
        </Card>
      )}
    </div>
  );
}
