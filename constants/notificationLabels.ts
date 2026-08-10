// ============================================================================
// MODULE : Constants — Notification presentation
// PURPOSE: How a NotificationCategory reads and which badge variant carries it.
//
//          Declared once so the bell, the notification list and the
//          announcement screens cannot disagree about what a category looks
//          like. The variants come from the Badge's five semantic slots — no
//          new colour is introduced, and none is invented per screen.
// ============================================================================

import { NotificationCategory } from "@/app/generated/prisma/enums";
import type { BadgeVariant } from "@/components/ui/Badge";

/** Sentence-case labels. The enum's SCREAMING_CASE is not reader-facing text. */
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  ACADEMIC: "Academic",
  ATTENDANCE: "Attendance",
  ASSIGNMENT: "Assignment",
  RESULT: "Result",
  FEE: "Fee",
  CERTIFICATE: "Certificate",
  TIMETABLE: "Timetable",
  AI: "AI",
  FINANCE: "Finance",
  ANNOUNCEMENT: "Announcement",
  EMERGENCY: "Emergency",
};

/**
 * The badge variant each category wears.
 *
 * Only EMERGENCY takes `danger`, and it takes it because an emergency notice
 * genuinely is one — spending the alarm colour on ordinary categories would
 * leave nothing louder for the case that needs it. Money reads as `warning`
 * because a fee notice is usually an obligation with a date on it, and
 * everything else is `neutral` or `info`: a notification is not a status.
 */
export const NOTIFICATION_CATEGORY_VARIANTS: Record<NotificationCategory, BadgeVariant> = {
  ACADEMIC: "info",
  ATTENDANCE: "info",
  ASSIGNMENT: "info",
  RESULT: "success",
  FEE: "warning",
  CERTIFICATE: "success",
  TIMETABLE: "neutral",
  AI: "neutral",
  FINANCE: "warning",
  ANNOUNCEMENT: "neutral",
  EMERGENCY: "danger",
};

/** Every category, ordered as the filter offers them. */
export const NOTIFICATION_CATEGORY_OPTIONS = (
  Object.keys(NOTIFICATION_CATEGORY_LABELS) as NotificationCategory[]
).map((value) => ({ value, label: NOTIFICATION_CATEGORY_LABELS[value] }));

/**
 * A category that predates Phase 27 is null, not unknown.
 *
 * Every notification written before the column existed carries no category and
 * none can be inferred for it, so the list says "General" rather than guessing
 * one — the DTO's own comment makes the same point.
 */
export function categoryLabel(category: NotificationCategory | null): string {
  return category === null ? "General" : NOTIFICATION_CATEGORY_LABELS[category];
}

export function categoryVariant(category: NotificationCategory | null): BadgeVariant {
  return category === null ? "neutral" : NOTIFICATION_CATEGORY_VARIANTS[category];
}
