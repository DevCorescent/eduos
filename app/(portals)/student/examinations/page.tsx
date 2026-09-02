import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Printer, TicketCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getMyHallTickets } from "@/services/examinations";
import { EXAMINATION_TYPE_LABELS } from "@/constants/labels";
import { formatDate } from "@/utils/format";
import type { ExaminationType } from "@/types";

export const metadata: Metadata = { title: "Examinations" };

/**
 * The student's own hall tickets — PRD §17.2 "Hall-ticket generation" and
 * §19.1 "Examination hall ticket".
 *
 * This page was a stub whose own note said hall tickets had "no model, so there
 * is nothing for a student to see here yet". They have one now.
 *
 * WHY THERE IS NO STUDENT ID ANYWHERE ON THIS PAGE
 *   It reads GET /api/students/me/hall-tickets, which resolves the Student row
 *   from the session. The endpoint takes no id, so a student cannot ask for a
 *   classmate's ticket by editing anything — the request that would do it
 *   cannot be expressed.
 *
 * A ticket exists only because the examination office issued it, and it issues
 * only to students it judged eligible. So this page shows what was granted; it
 * makes no eligibility decision of its own and must not, or there would be two
 * answers to that question.
 */
export default async function StudentExaminationsPage() {
  const result = await getMyHallTickets();

  const header = (
    <PageHeader
      title="Examinations"
      subtitle="Your hall tickets and examination schedule."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="your hall tickets"
          message={result.error}
        />
      </>
    );
  }

  const tickets = result.data;

  if (tickets.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title="No hall tickets yet"
          description="A hall ticket appears here once the examination office issues one for an examination you are eligible to sit."
        />
      </>
    );
  }

  return (
    <>
      {header}

      <div className="grid gap-4 lg:grid-cols-2">
        {tickets.map((ticket) => {
          const exam = ticket.examination;

          return (
            <Card
              key={ticket.id}
              header={
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-heading">
                      {exam.title}
                    </h2>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {exam.course?.code ?? "—"}
                      {exam.semester ? ` · ${exam.semester.name}` : ""}
                    </p>
                  </div>
                  <Badge variant="success">
                    <TicketCheck className="mr-1 h-3 w-3" />
                    Issued
                  </Badge>
                </div>
              }
            >
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {[
                  { label: "Hall ticket no.", value: ticket.ticketNo, mono: true },
                  {
                    label: "Type",
                    value:
                      EXAMINATION_TYPE_LABELS[exam.type as ExaminationType] ?? exam.type,
                  },
                  {
                    label: "Date",
                    value: exam.date ? formatDate(exam.date) : "To be announced",
                  },
                  {
                    label: "Time",
                    value:
                      exam.startTime && exam.endTime
                        ? `${exam.startTime} – ${exam.endTime}`
                        : "To be announced",
                  },
                  { label: "Venue", value: exam.venue ?? "To be announced" },
                  { label: "Seat", value: ticket.seatNo ?? "To be announced" },
                  { label: "Maximum marks", value: String(exam.maxMarks) },
                ].map((field) => (
                  <div key={field.label}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {field.label}
                    </dt>
                    <dd
                      className={`mt-1 text-sm text-heading${field.mono ? " font-mono" : ""}`}
                    >
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  Issued {formatDate(ticket.issuedAt)}.
                </p>
                <Link
                  href={`/student/examinations/${ticket.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-heading transition-colors hover:bg-muted"
                >
                  <Printer className="h-3.5 w-3.5" />
                  View / print
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
