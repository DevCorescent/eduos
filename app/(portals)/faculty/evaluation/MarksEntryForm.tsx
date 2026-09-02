"use client";

// ============================================================================
// MODULE : Faculty — Marks entry grid
// LAYER  : Client component
// PURPOSE: Let a lecturer record internal-assessment marks for a sitting they
//          conduct, against the students actually registered for it.
//
// WHY THIS EXISTS
//   The marks API and its authorization were built long before any screen
//   could reach them: the university-side sitting page says outright that
//   "uploads are made through the internal or external marks endpoints". A
//   capability only reachable by curl is not a capability a lecturer has.
//
// WHAT THIS COMPONENT DOES NOT DECIDE
//   Whether the caller may mark this sitting. That is settled server-side by
//   POST /api/results/internal, which resolves the lecturer from their session
//   and refuses anyone who did not conduct the sitting. Nothing here sends a
//   facultyId, because nothing here is trusted to.
//
// BLANK IS NOT ZERO
//   An empty box is skipped. Marking half a cohort and saving must not fail
//   the other half, so only rows that were actually filled in are submitted.
// ============================================================================

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/providers/ToastProvider";
import { recordComponentMarksAction } from "@/actions/grading";

export interface MarksEntryRow {
  courseRegistrationId: string;
  enrollmentNo: string;
  name: string;
  /** The mark already on record, or "" when none has been entered yet. */
  marksObtained: string;
  absent: boolean;
}

export interface MarksEntryFormProps {
  assessmentEventId: string;
  maxMarks: number;
  rows: MarksEntryRow[];
  /** False when the sitting is not OPEN; the grid renders read-only. */
  acceptsMarks: boolean;
}

export function MarksEntryForm({
  assessmentEventId,
  maxMarks,
  rows: initialRows,
  acceptsMarks,
}: MarksEntryFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [rows, setRows] = useState<MarksEntryRow[]>(initialRows);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entered = useMemo(
    () => rows.filter((row) => row.absent || row.marksObtained.trim() !== "").length,
    [rows]
  );

  function update(id: string, patch: Partial<MarksEntryRow>) {
    setError(null);
    setRows((current) =>
      current.map((row) =>
        row.courseRegistrationId === id ? { ...row, ...patch } : row
      )
    );
  }

  /** Per-row validity, so the offending box is outlined as it is typed in. */
  function invalid(row: MarksEntryRow): boolean {
    if (row.absent) return false;
    const raw = row.marksObtained.trim();
    if (raw === "") return false;
    const value = Number(raw);
    return !Number.isFinite(value) || value < 0 || value > maxMarks;
  }

  const anyInvalid = rows.some(invalid);

  async function submit() {
    setSaving(true);
    setError(null);

    const result = await recordComponentMarksAction(
      assessmentEventId,
      rows.map((row) => ({
        courseRegistrationId: row.courseRegistrationId,
        marksObtained: row.marksObtained,
        absent: row.absent,
      })),
      maxMarks
    );

    setSaving(false);

    if (!result.success) {
      setError(result.error);
      toast({ variant: "error", title: "Could not save marks", description: result.error });
      return;
    }

    toast({ variant: "success", title: "Marks saved" });
    // The recomputed sheet is the source of truth — refresh rather than trust
    // local state, so what the lecturer sees next is what was actually stored.
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <Alert variant="info">
        No students are registered for this sitting, so there is nothing to mark.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {!acceptsMarks && (
        <Alert variant="warning">
          This sitting is not open for marks. Entries are shown as recorded and
          cannot be changed until it is reopened.
        </Alert>
      )}

      {error && <Alert variant="error">{error}</Alert>}

      <Card noPadding>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-heading">
                  Enrolment
                </th>
                <th className="px-4 py-3 text-left font-medium text-heading">Student</th>
                <th className="px-4 py-3 text-left font-medium text-heading">
                  Marks (out of {maxMarks})
                </th>
                <th className="px-4 py-3 text-left font-medium text-heading">Absent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.courseRegistrationId} className="border-b border-border">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground">
                    {row.enrollmentNo}
                  </td>
                  <td className="px-4 py-2 text-heading">{row.name}</td>
                  <td className="px-4 py-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={maxMarks}
                      step="0.01"
                      className="w-28"
                      aria-label={`Marks for ${row.name}`}
                      aria-invalid={invalid(row)}
                      value={row.absent ? "" : row.marksObtained}
                      disabled={!acceptsMarks || saving || row.absent}
                      onChange={(event) =>
                        update(row.courseRegistrationId, {
                          marksObtained: event.target.value,
                        })
                      }
                    />
                    {invalid(row) && (
                      <p className="mt-1 text-xs text-danger">
                        Enter a number between 0 and {maxMarks}.
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Checkbox
                      aria-label={`Mark ${row.name} absent`}
                      checked={row.absent}
                      disabled={!acceptsMarks || saving}
                      onChange={(event) =>
                        update(row.courseRegistrationId, {
                          absent: event.target.checked,
                          marksObtained: event.target.checked
                            ? ""
                            : row.marksObtained,
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={submit}
          disabled={!acceptsMarks || saving || anyInvalid || entered === 0}
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : "Save marks"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {entered} of {rows.length} rows will be submitted. Blank rows are left
          untouched.
        </p>
      </div>
    </div>
  );
}
