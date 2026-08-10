import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, GraduationCap, Receipt, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { buttonStyles } from "@/components/ui/Button";
import { resolveChildContext, NoChildren } from "../childContext";

export const metadata: Metadata = { title: "Parent Dashboard" };

type SearchParams = Promise<{ child?: string }>;

/**
 * PRD §32 — the parent's landing screen.
 *
 * Lists the children this account is linked to, which IS the StudentParent
 * relationship: there is no separate notion of what a parent may see. Each card
 * links into the child-scoped screens with `?child=` already set.
 */
export default async function ParentDashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { child } = await searchParams;
  const context = await resolveChildContext(child);

  const header = (
    <PageHeader title="My children" subtitle="Attendance, results, fees and notices for each child." />
  );

  if (context.kind === "failed") return <>{header}{context.node}</>;
  if (context.kind === "empty") return <>{header}<NoChildren /></>;

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {context.children.map((c) => (
          <Card key={c.studentId}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-heading">
                  {c.firstName} {c.lastName}
                </h2>
                <p className="font-mono text-xs text-muted-foreground">{c.enrollmentNo}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {c.programmeName ?? "No programme assigned"} · Semester {c.currentSemester}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Your relation: {c.relation}
                  {c.isPrimary ? " · primary contact" : ""}
                </p>
              </div>
              <StatusBadge
                label={c.status === "ACTIVE" ? "Active" : c.status}
                variant={c.status === "ACTIVE" ? "success" : "neutral"}
              />
            </div>

            {/* Every link goes to a screen backed by a real API. */}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/parent/attendance?child=${c.studentId}`}
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                <ClipboardCheck className="size-4" aria-hidden="true" />
                <span className="ml-1.5">Attendance</span>
              </Link>
              <Link
                href={`/parent/results?child=${c.studentId}`}
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                <GraduationCap className="size-4" aria-hidden="true" />
                <span className="ml-1.5">Results</span>
              </Link>
              <Link
                href={`/parent/fees?child=${c.studentId}`}
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                <Receipt className="size-4" aria-hidden="true" />
                <span className="ml-1.5">Fees</span>
              </Link>
            </div>
          </Card>
        ))}
      </div>

      <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="size-4" aria-hidden="true" />
        Linked children come from your university&rsquo;s records. Contact the administrator to
        add or remove one.
      </p>
    </>
  );
}
