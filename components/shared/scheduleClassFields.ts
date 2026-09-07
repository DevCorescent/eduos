// ============================================================================
// MODULE : Timetable — Class Scheduling Form Fields
// PURPOSE: The field lists behind every Schedule Class dialog.
//
// WHY IT IS SHARED
//   Two screens raise this form — the administrator's Timetable page and the
//   lecturer's My Schedule page — over the SAME period columns with different
//   ways of naming WHICH class. Declaring the period half twice would mean the
//   two forms drifting apart in the way hardest to notice: the same dialog,
//   subtly different rules, and a lecturer able to submit something the
//   administrator's form would have caught before it left the browser.
//
// WHY THE TWO FORMS DIFFER ABOVE THE FOLD
//   An administrator picks a semester, a section, a course and a faculty member
//   independently, because any combination within their tenant is legitimate and
//   the API checks each reference on its own.
//
//   A lecturer does not. They may schedule only a (section, course) pair they
//   are assigned to teach, and only under their own name — so four free selects
//   would present mostly invalid combinations and a faculty picker would have
//   exactly one entry. Their form asks for the CLASS as a single choice drawn
//   from GET /api/faculty/me/teaching, which returns precisely the pairs the
//   write will accept.
//
//   Neither form is the authorization. Both post to endpoints that re-resolve
//   every reference against the tenant and re-run the ownership rule against the
//   pair actually submitted.
//
// WHY IT IS PLAIN DATA AND NOT A COMPONENT
//   EntityFormModal generates its inputs from a field array precisely so this
//   kind of reuse costs a function rather than a wrapper component. This module
//   has no "use client" directive and needs none: it exports functions returning
//   serialisable arrays, which a Server Component builds and passes to
//   EntityCreateButton like any other prop.
// ============================================================================

import type { FormField } from "@/components/shared/EntityFormModal";
import type { SelectOption } from "@/components/ui/Select";
import { DAY_OF_WEEK_LABELS, SESSION_TYPE_LABELS } from "@/constants/labels";
import { DAY_OF_WEEK_VALUES, SESSION_TYPE_VALUES } from "@/types";

/**
 * The period half of the form: when, where and what kind.
 *
 * Identical on both screens, and declared once so they cannot disagree about
 * what a valid period is.
 *
 * The times are `kind: "time"`, which renders the browser's own picker and
 * validates HH:mm before submitting — the same format the API requires, so a
 * value that reaches the network is one the schema will accept.
 *
 * roomNo is free text on purpose. The schema declares no Room model, so there
 * is nothing to validate a room against; the conflict check treats it as an
 * exact, case-sensitive string, which is the same statement the validation
 * module makes.
 */
const PERIOD_FIELDS: FormField[] = [
  {
    kind: "select",
    name: "day",
    label: "Day",
    required: true,
    options: DAY_OF_WEEK_VALUES.map((value) => ({
      value,
      label: DAY_OF_WEEK_LABELS[value],
    })),
    placeholder: "Select a day",
  },
  { kind: "time", name: "startTime", label: "Start time", required: true },
  {
    kind: "time",
    name: "endTime",
    label: "End time",
    required: true,
    helperText: "Must be after the start time.",
  },
  {
    kind: "text",
    name: "roomNo",
    label: "Room",
    placeholder: "LH-101",
    helperText: "Optional. A room is only double-booked against the exact same name.",
  },
  {
    kind: "select",
    name: "sessionType",
    label: "Session type",
    required: true,
    options: SESSION_TYPE_VALUES.map((value) => ({
      value,
      label: SESSION_TYPE_LABELS[value],
    })),
  },
];

/** The tenant-scoped choices the administrator's form may offer. */
export interface ScheduleClassOptions {
  semesters: SelectOption[];
  sections: SelectOption[];
  courses: SelectOption[];
  faculty: SelectOption[];
}

/**
 * The administrator's Schedule Class dialog, in submission order.
 *
 * Every reference is a SELECT over tenant-scoped choices rather than a text
 * input: an id typed by hand can only ever be wrong, and the API would answer a
 * 404 that says nothing useful about which of the four was at fault.
 */
export function scheduleClassFields(options: ScheduleClassOptions): FormField[] {
  return [
    {
      kind: "select",
      name: "semesterId",
      label: "Semester",
      required: true,
      options: options.semesters,
      placeholder: "Select a semester",
    },
    {
      kind: "select",
      name: "sectionId",
      label: "Section",
      required: true,
      options: options.sections,
      placeholder: "Select a section",
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
      name: "facultyId",
      label: "Faculty",
      required: true,
      options: options.faculty,
      placeholder: "Select a faculty member",
    },
    ...PERIOD_FIELDS,
  ];
}

/**
 * The lecturer's Schedule Class dialog.
 *
 * ONE select for the class rather than three, because the three are not
 * independently choosable for this caller — see the module header. Each option's
 * value encodes the whole triple; TEACHING_OPTION_SEPARATOR and the parser below
 * are the only two places that format is known.
 */
export function scheduleMyClassFields(classes: SelectOption[]): FormField[] {
  return [
    {
      kind: "select",
      name: "teaching",
      label: "Class",
      required: true,
      options: classes,
      placeholder: "Select a class",
      helperText: "Only the classes you are assigned to teach are listed.",
    },
    ...PERIOD_FIELDS,
  ];
}

/**
 * Separates the three ids inside one teaching option's value.
 *
 * A pipe, because a cuid is `[a-z0-9]+` and can never contain one — so the
 * encoding is unambiguous without escaping. Values are produced and parsed by
 * the two functions below and by nothing else.
 */
const TEACHING_OPTION_SEPARATOR = "|";

/** Encode one authorized class as a single select value. */
export function encodeTeachingOption(option: {
  semesterId: string | null;
  sectionId: string;
  courseId: string;
}): string {
  return [option.semesterId ?? "", option.sectionId, option.courseId].join(
    TEACHING_OPTION_SEPARATOR
  );
}

/**
 * Decode a teaching option back into the three ids.
 *
 * Returns null for anything that is not the shape this module produced —
 * including an empty semester segment, which the scheduling API requires and
 * an assignment carrying no semester cannot supply. A null is a refusal the
 * caller reports as a validation failure rather than posting an incomplete
 * body and receiving an opaque 400.
 */
export function decodeTeachingOption(
  value: string
): { semesterId: string; sectionId: string; courseId: string } | null {
  const [semesterId, sectionId, courseId] = value.split(TEACHING_OPTION_SEPARATOR);

  if (!semesterId || !sectionId || !courseId) return null;

  return { semesterId, sectionId, courseId };
}

/** The empty administrator form, so a create dialog opens on defined values. */
export const SCHEDULE_CLASS_DEFAULTS = {
  semesterId: "",
  sectionId: "",
  courseId: "",
  facultyId: "",
  day: "",
  startTime: "",
  endTime: "",
  roomNo: "",
  sessionType: "LECTURE",
} as const;

/** The empty lecturer form. */
export const SCHEDULE_MY_CLASS_DEFAULTS = {
  teaching: "",
  day: "",
  startTime: "",
  endTime: "",
  roomNo: "",
  sessionType: "LECTURE",
} as const;
