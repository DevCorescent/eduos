import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarCheck,
  ClipboardList,
  FileSpreadsheet,
  GraduationCap,
  ScrollText,
  SlidersHorizontal,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { listAssessmentEvents, listSchemes } from "@/services/evaluation";
import { formatNumber } from "@/utils/format";

export const metadata: Metadata = { title: "Evaluation" };

/**
 * The evaluation area's entry point.
 *
 * Counts come from `pagination.total` on one-row requests rather than from
 * counting a fetched page — the latter is wrong the moment a collection exceeds
 * one page, which is the normal case here.
 *
 * A failed count renders as "—" and not as 0. On a screen about regulations,
 * "0 active schemes" is a statement that nothing can currently be graded, and
 * it must not be made on the strength of a request that failed.
 */
export default async function EvaluationDashboardPage() {
  const [active, draft, archived, events] = await Promise.all([
    listSchemes({ page: 1, limit: 1, status: "ACTIVE" }),
    listSchemes({ page: 1, limit: 1, status: "DRAFT" }),
    listSchemes({ page: 1, limit: 1, status: "ARCHIVED" }),
    listAssessmentEvents({ page: 1, limit: 1 }),
  ]);

  const count = (result: { success: boolean; data?: { pagination: { total: number } } }) =>
    result.success && result.data ? formatNumber(result.data.pagination.total) : "—";

  const anyFailed = [active, draft, archived, events].some((result) => !result.success);

  const sections = [
    {
      href: "/evaluation/schemes",
      icon: SlidersHorizontal,
      title: "Evaluation Schemes",
      description:
        "Regulations, and the components, rules and passing criteria beneath each one.",
    },
    {
      href: "/evaluation/course-registrations",
      icon: ClipboardList,
      title: "Course Registrations",
      description: "Who is registered for what, this semester and previously.",
    },
    {
      href: "/evaluation/assessment-events",
      icon: CalendarCheck,
      title: "Assessment Events",
      description: "Scheduled sittings, their lifecycle, and the marks sheet for each.",
    },
    {
      href: "/evaluation/results/semester",
      icon: FileSpreadsheet,
      title: "Semester Results",
      description: "A whole cohort's computed result, with statistics and ranks.",
    },
    {
      href: "/evaluation/results/student",
      icon: GraduationCap,
      title: "Student Results",
      description: "One student's components, totals, grades, SGPA and CGPA.",
    },
    {
      href: "/evaluation/transcript",
      icon: ScrollText,
      title: "Transcript",
      description: "Full academic history: credits earned, backlogs, semester by semester.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Evaluation"
        subtitle="Regulations, assessments and the results computed from them."
      />

      {anyFailed && (
        <Alert variant="warning" className="mb-6">
          Some figures below could not be read and are shown as “—”.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active schemes" value={count(active)} />
        <StatCard label="Draft schemes" value={count(draft)} />
        <StatCard label="Archived schemes" value={count(archived)} />
        <StatCard label="Assessment events" value={count(events)} />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <Link key={section.href} href={section.href} className="group">
            <Card className="h-full transition-colors group-hover:border-ring">
              <div className="flex items-start gap-3">
                <section.icon
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-heading">{section.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
