import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getMyHallTickets } from "@/services/examinations";
import { EXAMINATION_TYPE_LABELS } from "@/constants/labels";
import { formatDate } from "@/utils/format";
import type { ExaminationType } from "@/types";
import { PrintButton } from "./PrintButton";

export const metadata: Metadata = { title: "Hall Ticket" };

type Params = Promise<{ ticketId: string }>;

/**
 * A printable hall ticket — PRD §19.1 "Examination hall ticket".
 *
 * WHY THIS IS A PRINT-STYLED PAGE AND NOT A GENERATED PDF
 *   The project has no PDF dependency and no PDF generation anywhere: the
 *   certificate module, its nearest neighbour, issues documents and links to a
 *   viewable page rather than rendering a file. This follows that existing
 *   convention. The browser's own print-to-PDF produces the file, which needs
 *   no new dependency and no server-side rendering pipeline.
 *
 * THE ISOLATION IS STRUCTURAL, NOT A COMPARISON
 *   The ticket is picked out of THIS STUDENT'S OWN list —
 *   GET /api/students/me/hall-tickets, which resolves the Student row from the
 *   session and accepts no id. A ticketId that belongs to somebody else is
 *   simply not in the list, so it is a 404 here. No ownership check has to be
 *   written, and therefore none can be forgotten.
 */
export default async function HallTicketPage({ params }: { params: Params }) {
  const { ticketId } = await params;

  const result = await getMyHallTickets();
  if (!result.success) notFound();

  const ticket = result.data.find((row) => row.id === ticketId);
  if (!ticket) notFound();

  const exam = ticket.examination;

  const fields: { label: string; value: string; mono?: boolean }[] = [
    { label: "Hall ticket number", value: ticket.ticketNo, mono: true },
    { label: "Seat", value: ticket.seatNo ?? "To be announced", mono: true },
    { label: "Course", value: exam.course ? `${exam.course.code} — ${exam.course.name}` : "—" },
    { label: "Semester", value: exam.semester?.name ?? "—" },
    {
      label: "Examination type",
      value: EXAMINATION_TYPE_LABELS[exam.type as ExaminationType] ?? exam.type,
    },
    { label: "Date", value: exam.date ? formatDate(exam.date) : "To be announced" },
    {
      label: "Time",
      value:
        exam.startTime && exam.endTime
          ? `${exam.startTime} – ${exam.endTime}`
          : "To be announced",
    },
    { label: "Venue", value: exam.venue ?? "To be announced" },
    { label: "Maximum marks", value: String(exam.maxMarks) },
  ];

  return (
    <>
      {/* Screen-only chrome. `print:hidden` keeps the navigation and buttons
          off the printed sheet, which is the whole point of a print stylesheet
          rather than a separate renderer. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/student/examinations"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-heading"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to examinations
        </Link>
        <PrintButton />
      </div>

      <article className="mx-auto max-w-2xl rounded-lg border border-border bg-surface p-8 print:max-w-none print:rounded-none print:border-0 print:p-0">
        <header className="border-b border-border pb-4 text-center">
          <h1 className="text-lg font-semibold uppercase tracking-wide text-heading">
            Examination Hall Ticket
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{exam.title}</p>
        </header>

        <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {fields.map((field) => (
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

        <footer className="mt-8 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            Issued {formatDate(ticket.issuedAt)}. This hall ticket must be
            produced at the examination hall. It is valid only for the
            examination named above.
          </p>
          <div className="mt-8 flex justify-end">
            <div className="w-56 border-t border-border pt-2 text-center text-xs text-muted-foreground">
              Controller of Examinations
            </div>
          </div>
        </footer>
      </article>
    </>
  );
}
