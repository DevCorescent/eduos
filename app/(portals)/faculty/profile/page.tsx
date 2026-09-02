import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { getCurrentFaculty } from "@/services/portal";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "My Profile" };

/**
 * The lecturer's own record.
 *
 * SELF-SERVICE, NOT ADMINISTRATION.
 *   This reads GET /api/faculty/me, which resolves the FacultyMember from the
 *   authenticated subject. No facultyId is accepted, so there is no id here to
 *   manipulate into a colleague's record.
 *
 *   It deliberately exposes NONE of the administrative actions that live on the
 *   university-side faculty screens — designation, department, status and
 *   employment are set by the university administrator under
 *   requireRole("UNIVERSITY_ADMIN"), and surfacing them here would either
 *   duplicate that authority or present controls that 403 on use. PRD §21.2
 *   describes faculty self-service; changing one's own designation is not in
 *   it.
 */
export default async function FacultyProfilePage() {
  const faculty = await getCurrentFaculty();
  if (!faculty) redirect("/login");

  const fields: { label: string; value: string }[] = [
    { label: "Employee ID", value: faculty.employeeId },
    { label: "Designation", value: faculty.designation ?? "—" },
    { label: "Qualification", value: faculty.qualification ?? "—" },
    {
      label: "Joined",
      value: faculty.joinDate ? formatDate(faculty.joinDate) : "—",
    },
    { label: "Email", value: faculty.user.email },
  ];

  return (
    <>
      <PageHeader
        title="My Profile"
        subtitle="Your record as the university holds it."
      />

      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar
            src={faculty.user.avatarUrl ?? undefined}
            name={faculty.fullName}
            size="lg"
          />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-heading">
              {faculty.fullName}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {faculty.designation ?? "Faculty member"}
            </p>
          </div>
          <Badge
            variant={faculty.status === "ACTIVE" ? "success" : "neutral"}
            className="ml-auto"
          >
            {faculty.status}
          </Badge>
        </div>

        <dl className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {field.label}
              </dt>
              <dd className="mt-1 text-sm text-heading">{field.value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
          Employment details are maintained by the university administration. Contact
          them to request a correction.
        </p>
      </Card>
    </>
  );
}
