// ============================================================================
// MODULE : Assessment Event — Schedule Sitting Form Fields
// PURPOSE: The field list behind the examination office's "Schedule assessment"
//          dialog.
//
// WHY EVERY REFERENCE IS A SELECT
//   An id typed by hand can only ever be wrong, and the API answers a bad one
//   with a 404 that says nothing useful about which of the four was at fault.
//   Each list is resolved on the server from a collection the caller is already
//   permitted to read.
//
// WHAT IS DELIBERATELY NOT ON THIS FORM
//   sequenceNumber — assigned by the server from the sittings that already
//                    exist. A caller able to choose it could hide a sitting
//                    from a BEST_N aggregation, so it is absent from the
//                    validation schema too.
//   status         — a new sitting is always DRAFT. It moves only through
//                    POST /api/assessment-events/[id]/status, where the state
//                    machine lives.
//   conductedById  — who ran the sitting, optional on the model. It would need
//                    a faculty picker, and FACULTY_READ_ROLES deliberately
//                    excludes the Controller of Examination — a locked decision
//                    with a test pinning it. Offering the field to the one role
//                    that cannot populate it would be a control that does not
//                    work; widening the registry to populate it would undo that
//                    decision to add an optional convenience. It is recorded
//                    on the sitting through its own edit path instead.
//
// THE SECTION FIELD IS CONDITIONAL, and not for cosmetic reasons. Sections are
// only reachable under a batch, and GET /api/batches is requireRole
// ("UNIVERSITY_ADMIN") — so the examination office cannot enumerate them. The
// column is nullable and a sitting covering every registration for the course
// and term is the ordinary case, so the field is offered when the caller can
// fill it and omitted when they cannot, rather than rendered permanently empty.
//
// NEITHER LIST IS THE AUTHORIZATION. POST /api/assessment-events applies
// ASSESSMENT_EVENT_MANAGE_ROLES and re-resolves every reference tenant-scoped,
// so an id absent from these options is refused there regardless of what this
// dialog displayed.
// ============================================================================

import type { FormField } from "@/components/shared/EntityFormModal";
import type { SelectOption } from "@/components/ui/Select";

/** The tenant-scoped choices the schedule dialog may offer. */
export interface ScheduleAssessmentOptions {
  /** Components of ACTIVE regulations — the only ones a sitting may name. */
  components: SelectOption[];
  courses: SelectOption[];
  semesters: SelectOption[];
  /** Empty when this caller cannot enumerate sections; the field is then omitted. */
  sections: SelectOption[];
}

/**
 * The "Schedule assessment" dialog, in submission order.
 *
 * `maxMarks` is optional and its helper text says what happens when it is left
 * blank: the service fills it from the component's own scale. A paper set out
 * of a different total is an ordinary arrangement — reconciled by a SCALE rule
 * rather than by conflating the two figures — which is why the field exists at
 * all rather than being derived silently.
 */
export function scheduleAssessmentFields(
  options: ScheduleAssessmentOptions
): FormField[] {
  return [
    {
      kind: "select",
      name: "evaluationComponentId",
      label: "Component",
      required: true,
      options: options.components,
      placeholder: "Select a component",
      helperText: "Only components of an active regulation can be assessed.",
    },
    {
      kind: "select",
      name: "courseId",
      label: "Course",
      required: true,
      options: options.courses,
      placeholder: "Select a course",
    },
    {
      kind: "select",
      name: "semesterId",
      label: "Semester",
      required: true,
      options: options.semesters,
      placeholder: "Select a semester",
    },
    // Offered only when the caller can enumerate sections. See the module
    // header: an always-empty select is a control that cannot be used.
    ...(options.sections.length > 0
      ? ([
          {
            kind: "select",
            name: "sectionId",
            label: "Section",
            options: options.sections,
            placeholder: "Every section",
            helperText:
              "Optional. Leave unset for a sitting covering the whole course and term.",
          },
        ] as FormField[])
      : []),
    {
      kind: "text",
      name: "title",
      label: "Title",
      required: true,
      placeholder: "Mid-Semester Test",
      maxLength: 150,
    },
    {
      kind: "number",
      name: "maxMarks",
      label: "Marked out of",
      min: 0,
      helperText: "Optional. Defaults to what the component itself contributes on.",
    },
    {
      kind: "date",
      name: "scheduledAt",
      label: "Scheduled for",
      helperText: "Optional. A sitting can be created before its date is fixed.",
    },
  ];
}

/** The empty form, so the create dialog opens on defined values. */
export const SCHEDULE_ASSESSMENT_DEFAULTS = {
  evaluationComponentId: "",
  courseId: "",
  semesterId: "",
  sectionId: "",
  title: "",
  maxMarks: "",
  scheduledAt: "",
} as const;
