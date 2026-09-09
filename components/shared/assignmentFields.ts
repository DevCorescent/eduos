// ============================================================================
// MODULE : Assignments — Set Work Form Fields
// PURPOSE: The field list behind the lecturer's "Set assignment" dialog, and
//          the encoding that turns one authorized class into one select value.
//
// WHY THE CLASS IS ONE CHOICE AND NOT TWO
//   A lecturer may set work only on a course they teach, and only for a section
//   of it they teach when they name one. Course and section are therefore NOT
//   independently choosable for this caller: most combinations of the tenant's
//   courses and sections would be refused, and a form offering them would be a
//   list of mostly-invalid options.
//
//   So the two ids arrive as a single select drawn from
//   GET /api/faculty/me/teaching, which returns precisely the pairs the write
//   accepts. This is the same shape — and the same reasoning — as the lecturer's
//   Schedule Class dialog in scheduleClassFields.ts.
//
// WHY THE WHOLE-COURSE OPTION EXISTS
//   Assignment.sectionId is NULLABLE, and work set for every section of a course
//   is an ordinary arrangement rather than an incomplete record. The teaching
//   endpoint reports (section, course) pairs, so the whole-course options are
//   folded out of the distinct courses in that list — a course appearing there
//   at all is proof the lecturer teaches it, which is exactly what the API
//   re-checks for a body carrying no section.
//
// NEITHER FORM IS THE AUTHORIZATION. POST /api/assignments re-resolves both ids
// against the tenant and re-runs facultyMaySetCoursework against the pair
// actually submitted, so a hand-crafted request naming a class absent from this
// list is refused regardless of what the dialog did or did not display.
//
// WHY IT IS PLAIN DATA AND NOT A COMPONENT
//   EntityFormModal generates its inputs from a field array precisely so this
//   kind of reuse costs a function rather than a wrapper component. No
//   "use client" directive is needed: this exports functions returning
//   serialisable arrays, which a Server Component builds and hands to
//   EntityCreateButton like any other prop.
// ============================================================================

import type { FormField } from "@/components/shared/EntityFormModal";
import type { SelectOption } from "@/components/ui/Select";
import { ASSIGNMENT_TYPE_LABELS } from "@/constants/labels";
import { AssignmentType } from "@/app/generated/prisma/enums";

/**
 * Separates the two ids inside one class option's value.
 *
 * A pipe, because a cuid is `[a-z0-9]+` and can never contain one — so the
 * encoding is unambiguous without escaping. The same separator
 * scheduleClassFields.ts uses, for the same reason.
 */
const CLASS_OPTION_SEPARATOR = "|";

/** One class a lecturer may set work for, as the teaching endpoint reports it. */
export interface CourseworkClass {
  sectionId: string;
  sectionName: string;
  courseId: string;
  courseCode: string;
  courseName: string;
}

/**
 * Encode one authorized class as a single select value.
 *
 * A missing section encodes as the bare course id, which is what makes the
 * whole-course option distinguishable from a sectioned one without a second
 * field: `course_1` is course-wide, `course_1|section_2` is one section.
 */
export function encodeCourseworkTarget(courseId: string, sectionId?: string): string {
  return sectionId ? `${courseId}${CLASS_OPTION_SEPARATOR}${sectionId}` : courseId;
}

/**
 * Decode a class option back into the ids the API expects.
 *
 * Returns null for an empty value — the untouched select — which the caller
 * reports as a validation failure on that field rather than posting a body with
 * no course and receiving an opaque 400.
 *
 * `sectionId` is undefined rather than null when none was chosen, because
 * createAssignmentSchema treats an absent key as "no section" and has no way to
 * express an explicit null.
 */
export function decodeCourseworkTarget(
  value: string
): { courseId: string; sectionId?: string } | null {
  const [courseId, sectionId] = value.split(CLASS_OPTION_SEPARATOR);

  if (!courseId) return null;

  return sectionId ? { courseId, sectionId } : { courseId };
}

/**
 * Every option a lecturer may set work against, from what they teach.
 *
 * Ordered course by course, each course's whole-course entry first and its
 * sections after it, so the broader choice is never buried beneath the narrower
 * ones. Courses are sorted by code and sections by name, matching the ordering
 * the teaching endpoint itself applies.
 */
export function courseworkTargetOptions(
  classes: readonly CourseworkClass[]
): SelectOption[] {
  // Grouped by course, so each course contributes exactly one whole-course
  // entry however many of its sections the lecturer takes.
  const byCourse = new Map<string, { code: string; name: string; sections: CourseworkClass[] }>();

  for (const item of classes) {
    const existing = byCourse.get(item.courseId);

    if (existing) {
      existing.sections.push(item);
    } else {
      byCourse.set(item.courseId, {
        code: item.courseCode,
        name: item.courseName,
        sections: [item],
      });
    }
  }

  const options: SelectOption[] = [];

  const courses = [...byCourse.entries()].sort((a, b) => a[1].code.localeCompare(b[1].code));

  for (const [courseId, course] of courses) {
    options.push({
      value: encodeCourseworkTarget(courseId),
      label: `${course.code} — ${course.name} · All sections`,
    });

    const sections = [...course.sections].sort((a, b) =>
      a.sectionName.localeCompare(b.sectionName)
    );

    for (const section of sections) {
      options.push({
        value: encodeCourseworkTarget(courseId, section.sectionId),
        label: `${course.code} — ${course.name} · Section ${section.sectionName}`,
      });
    }
  }

  return options;
}

/**
 * The lecturer's "Set assignment" dialog, in submission order.
 *
 * Only the columns createAssignmentSchema accepts. `status` and `publishedAt`
 * are absent because they are server-managed — a new assignment is always a
 * DRAFT, and publishing it is a separate, deliberate act on the assignment's
 * own page.
 *
 * `attachments` is absent too: the schema accepts a Json array, but the project
 * defines no upload endpoint for this phase, so a field here would collect
 * something with nowhere to put it.
 */
export function setAssignmentFields(targets: SelectOption[]): FormField[] {
  return [
    {
      kind: "select",
      name: "target",
      label: "Class",
      required: true,
      options: targets,
      placeholder: "Select a course or section",
      helperText: "Only the courses you are assigned to teach are listed.",
    },
    {
      kind: "text",
      name: "title",
      label: "Title",
      required: true,
      placeholder: "Problem Set 3",
      maxLength: 200,
    },
    {
      kind: "textarea",
      name: "description",
      label: "Brief",
      rows: 4,
      placeholder: "What the students have to do, and what to hand in.",
      helperText: "Optional. Shown to students once the assignment is published.",
    },
    {
      kind: "select",
      name: "type",
      label: "Type",
      required: true,
      options: Object.values(AssignmentType).map((value) => ({
        value,
        label: ASSIGNMENT_TYPE_LABELS[value],
      })),
    },
    {
      kind: "number",
      name: "maxMarks",
      label: "Maximum marks",
      required: true,
      min: 1,
      helperText: "What the work is marked out of. Submissions are graded against this.",
    },
    {
      kind: "date",
      name: "dueDate",
      label: "Due date",
      helperText: "Optional. Late submissions are recorded rather than refused.",
    },
  ];
}

/**
 * The empty form, so the create dialog opens on defined values.
 *
 * `maxMarks` starts at the column's own default rather than blank: 100 is what
 * the database would have applied anyway, so showing it is honest about what
 * happens if the lecturer leaves it alone.
 */
export const SET_ASSIGNMENT_DEFAULTS = {
  target: "",
  title: "",
  description: "",
  type: AssignmentType.HOMEWORK,
  maxMarks: 100,
  dueDate: "",
} as const;
