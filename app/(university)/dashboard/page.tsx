import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  Building2,
  CalendarRange,
  GraduationCap,
  ReceiptText,
  UserCog,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { getPortalSession } from "@/services/session";
import { getDashboardSummary, type DashboardSummary } from "@/services/dashboard";
import { displayNameFromEmail } from "@/utils/user";
import { formatCurrency, formatNumber } from "@/utils/format";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * University dashboard.
 *
 * A Server Component: the summary is fetched during render, so the first paint
 * already carries the figures and there is no spinner-then-numbers flash.
 *
 * Every metric that cannot be sourced is rendered as "—" rather than 0. The
 * difference matters — "0 courses running" asserts that nothing is being
 * taught, while "—" says the figure is not available yet. The summary service
 * returns null for exactly those, so this page never has to guess.
 */
export default async function UniversityDashboardPage() {
  const session = await getPortalSession();
  if (!session) redirect("/login");

  const result = await getDashboardSummary();

  const header = (
    <PageHeader
      title={`Welcome back, ${displayNameFromEmail(session.email)}`}
      subtitle="Your university at a glance."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load the dashboard" description={result.error} />
      </>
    );
  }

  const summary = result.data;

  return (
    <>
      {header}

      {(summary.currentAcademicYear || summary.currentSemester) && (
        <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <CalendarRange className="size-4" aria-hidden="true" />
          <span>Currently in</span>
          {summary.currentAcademicYear && (
            <Badge variant="info" size="sm">
              {summary.currentAcademicYear}
            </Badge>
          )}
          {summary.currentSemester && (
            <Badge variant="neutral" size="sm">
              {summary.currentSemester}
            </Badge>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Students"
          value={formatNumber(summary.students.total)}
          icon={<GraduationCap className="size-5" />}
          // The breakdown is what staff act on: a register of 186 with 142
          // active is a different institution from 186 all active.
          caption={`${formatNumber(summary.students.active)} active`}
        />
        <StatCard
          label="Faculty"
          value={formatNumber(summary.faculty.total)}
          icon={<UserCog className="size-5" />}
          caption={`${formatNumber(summary.faculty.active)} active`}
        />
        <StatCard
          // "Courses" and not "Courses Running": GET /api/courses counts the
          // catalogue, and nothing in the schema marks a course as currently
          // taught. Labelling the catalogue as running would be a claim the
          // number does not support.
          label="Courses"
          value={summary.courses === null ? "—" : formatNumber(summary.courses)}
          icon={<BookOpen className="size-5" />}
        />
        <StatCard
          label="Pending Fee Demands"
          value={summary.fees.pendingCount === null ? "—" : formatNumber(summary.fees.pendingCount)}
          icon={<ReceiptText className="size-5" />}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NeedsAttention summary={summary} />
        </div>
        <QuickLinks activeProgrammes={summary.activeProgrammes} />
      </div>
    </>
  );
}

/**
 * The operational panel: what is off-track right now.
 *
 * Kept separate from the stat row on purpose. Totals describe the institution;
 * these are the things somebody has to do something about, and mixing the two
 * buries the second in the first.
 */
function NeedsAttention({ summary }: { summary: DashboardSummary }) {
  const inactiveStudents = summary.students.total - summary.students.active;
  const facultyOnLeave = summary.faculty.total - summary.faculty.active;

  const items = [
    {
      show: summary.fees.overdueCount !== null && summary.fees.overdueCount > 0,
      tone: "danger" as const,
      label: "Overdue fee demands",
      value: formatNumber(summary.fees.overdueCount ?? 0),
      href: "/finance/fee-demands?status=OVERDUE",
      detail:
        summary.fees.outstandingAmount !== null
          ? `${formatCurrency(summary.fees.outstandingAmount)} outstanding in total`
          : undefined,
    },
    {
      show: inactiveStudents > 0,
      tone: "warning" as const,
      label: "Students not active",
      value: formatNumber(inactiveStudents),
      href: "/students",
      detail: "On leave, suspended, withdrawn or transferred",
    },
    {
      show: facultyOnLeave > 0,
      tone: "warning" as const,
      label: "Faculty on leave",
      value: formatNumber(facultyOnLeave),
      href: "/faculty",
      detail: "May need cover for scheduled classes",
    },
  ].filter((item) => item.show);

  return (
    <Card
      header={
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-heading">Needs attention</h2>
        </div>
      }
      noPadding
    >
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          Nothing needs attention right now.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  {item.detail && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                  )}
                </div>
                <span
                  className={
                    item.tone === "danger"
                      ? "shrink-0 text-lg font-semibold text-danger"
                      : "shrink-0 text-lg font-semibold text-warning"
                  }
                >
                  {item.value}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function QuickLinks({ activeProgrammes }: { activeProgrammes: number | null }) {
  const links = [
    { label: "Campuses", href: "/setup/campuses", icon: Building2 },
    { label: "Programmes", href: "/setup/programmes", icon: GraduationCap, badge: activeProgrammes },
    { label: "Students", href: "/students", icon: Users },
    { label: "Faculty", href: "/faculty", icon: UserCog },
    { label: "Academic Years", href: "/calendar/academic-years", icon: CalendarRange },
    { label: "Courses", href: "/curriculum/courses", icon: BookOpen },
  ];

  return (
    <Card header={<h2 className="text-sm font-semibold text-heading">Jump to</h2>} noPadding>
      <ul className="divide-y divide-border">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="flex items-center gap-3 px-5 py-3 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <link.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1">{link.label}</span>
              {link.badge != null && link.badge > 0 && (
                <span className="text-xs text-muted-foreground">{link.badge}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
