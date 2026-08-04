"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Save } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/providers/ToastProvider";
import { markAttendanceAction } from "@/actions/academics";
import { ATTENDANCE_STATUS_LABELS } from "@/constants/labels";
import { cn } from "@/lib/utils";
import { ATTENDANCE_STATUS_VALUES, type AttendanceStatus } from "@/types";

interface StudentRow {
  id: string;
  name: string;
  enrollmentNo: string;
  status: AttendanceStatus;
}

export interface MarkAttendanceFormProps {
  sectionId: string;
  courseId: string;
  date: string;
  students: StudentRow[];
  alreadyMarked: boolean;
}

/** Per-status button styling, so the selected state reads at a glance. */
const STATUS_STYLES: Record<AttendanceStatus, string> = {
  PRESENT: "bg-success text-success-foreground",
  ABSENT: "bg-danger text-danger-foreground",
  LATE: "bg-warning text-warning-foreground",
  EXCUSED: "bg-info text-info-foreground",
};

/**
 * The register.
 *
 * Every student defaults to PRESENT and the lecturer marks the exceptions —
 * that is how a register is actually taken, and defaulting to unset would mean
 * tapping forty times to record a normal day.
 *
 * State is held for the whole register and submitted once, rather than writing
 * per toggle. A register is a single act; per-row writes would leave a
 * half-marked session behind if the page were closed midway, and would put
 * forty requests where one belongs.
 */
export function MarkAttendanceForm({
  sectionId,
  courseId,
  date,
  students,
  alreadyMarked,
}: MarkAttendanceFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>(() =>
    Object.fromEntries(students.map((student) => [student.id, student.status]))
  );
  const [isSaving, setIsSaving] = useState(false);

  function setStatus(studentId: string, status: AttendanceStatus) {
    setStatuses((prev) => ({ ...prev, [studentId]: status }));
  }

  function markAll(status: AttendanceStatus) {
    setStatuses(Object.fromEntries(students.map((student) => [student.id, status])));
  }

  async function handleSave() {
    setIsSaving(true);

    const result = await markAttendanceAction(
      sectionId,
      courseId,
      date,
      students.map((student) => ({
        studentId: student.id,
        status: statuses[student.id] ?? "PRESENT",
      }))
    );

    setIsSaving(false);

    if (!result.success) {
      toast({ variant: "error", title: "Couldn't save", description: result.error });
      return;
    }

    toast({
      variant: "success",
      title: "Attendance saved",
      description: `${students.length} students recorded.`,
    });
    router.refresh();
  }

  const counts = ATTENDANCE_STATUS_VALUES.map((status) => ({
    status,
    count: Object.values(statuses).filter((s) => s === status).length,
  })).filter((entry) => entry.count > 0);

  return (
    <>
      {alreadyMarked && (
        <Alert variant="info" title="Already marked" className="mb-4">
          This session has been recorded. Saving again updates the existing register rather
          than creating a duplicate.
        </Alert>
      )}

      <Card
        noPadding
        header={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-heading">
                {students.length} students
              </h2>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {counts.map(({ status, count }) => (
                  <span
                    key={status}
                    className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                  >
                    {ATTENDANCE_STATUS_LABELS[status]}: {count}
                  </span>
                ))}
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Check className="size-4" />}
              onClick={() => markAll("PRESENT")}
            >
              All present
            </Button>
          </div>
        }
      >
        <ul className="divide-y divide-border">
          {students.map((student) => (
            <li
              key={student.id}
              className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={student.name} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {student.name}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {student.enrollmentNo}
                  </p>
                </div>
              </div>

              {/* A radio group, not four independent buttons: exactly one
                  status applies, and screen readers should hear it that way. */}
              <div
                role="radiogroup"
                aria-label={`Attendance for ${student.name}`}
                className="flex shrink-0 flex-wrap gap-1"
              >
                {ATTENDANCE_STATUS_VALUES.map((status) => {
                  const isSelected = statuses[student.id] === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setStatus(student.id, status)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isSelected
                          ? STATUS_STYLES[status]
                          : "bg-muted text-muted-foreground hover:bg-surface-active"
                      )}
                    >
                      {ATTENDANCE_STATUS_LABELS[status]}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Sticky, so the action stays reachable on a register of forty students
          without scrolling back to the top. */}
      <div className="sticky bottom-0 mt-4 flex justify-end border-t border-border bg-background/80 py-3 backdrop-blur">
        <Button onClick={handleSave} isLoading={isSaving} leftIcon={<Save className="size-4" />}>
          Save attendance
        </Button>
      </div>
    </>
  );
}
