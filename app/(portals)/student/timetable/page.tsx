import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { UnavailableState } from "@/components/shared/UnavailableState";
import { getPortalSession } from "@/services/session";

export const metadata: Metadata = { title: "My Timetable" };

/**
 * Student timetable — the route exists, the data does not.
 *
 * FRONTEND.md lists this page (Phase F20), so the route is created and appears
 * in navigation rather than being silently absent: a missing entry looks like a
 * product that forgot the feature, and adding it later would mean revisiting
 * the layout.
 *
 * The only endpoint that returns a section's timetable is
 * GET /api/timetables/section/[sectionId], and it is requireRole
 * ("UNIVERSITY_ADMIN") — verified against the running API, which answers a
 * signed-in student 403. So there is no request this page can make.
 *
 * That makes it the THIRD state, not an empty one. "No classes scheduled" would
 * tell a student their timetable is blank and send them to ask an
 * administrator who has in fact published it.
 */
export default async function StudentTimetablePage() {
  const session = await getPortalSession();
  if (!session) redirect("/login");

  return (
    <>
      <PageHeader
        title="My Timetable"
        subtitle="Your weekly class schedule."
      />

      <Card noPadding>
        <UnavailableState
          icon={<CalendarDays className="size-6" aria-hidden="true" />}
          title="Timetable is not available yet"
          description="Your schedule is stored, but there is no student-facing endpoint to read it — the timetable API is currently restricted to administrators. This page will fill in as soon as that access is opened up."
        />
      </Card>
    </>
  );
}
