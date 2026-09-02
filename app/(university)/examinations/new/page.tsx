import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { courseIndex, semesterIndex } from "@/services/reference";
import { ScheduleExaminationForm } from "./ScheduleExaminationForm";

export const metadata: Metadata = { title: "Schedule Examination" };

/**
 * Schedule an examination — PRD §17.2 Examination Configuration.
 *
 * THE REFERENCE READS THIS PAGE DEPENDS ON
 *   courseIndex reads /api/courses and semesterIndex reads
 *   /api/academic-years/[id]/semesters. Both were opened to the Controller of
 *   Examination for exactly this: an examination is scheduled against a course
 *   and a semester, and without those reads the office could not name either.
 *   Neither grant extends to the student or faculty registries, and neither
 *   confers write access to the catalogue itself.
 *
 * The page only supplies OPTIONS. POST /api/examinations re-resolves both ids
 * tenant-scoped and applies EXAMINATION_MANAGE_ROLES, so the list rendered here
 * is a convenience and never the authorization.
 */
export default async function ScheduleExaminationPage() {
  const [courses, semesters] = await Promise.all([courseIndex(), semesterIndex()]);

  const courseOptions = Array.from(courses.values())
    .map((course) => ({
      value: course.id,
      label: `${course.code} — ${course.name}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const semesterOptions = Array.from(semesters.values())
    .map((semester) => ({ value: semester.id, label: semester.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <>
      <PageHeader
        title="Schedule Examination"
        subtitle="Add an examination to the calendar."
      />
      <ScheduleExaminationForm courses={courseOptions} semesters={semesterOptions} />
    </>
  );
}
