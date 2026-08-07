"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Plus } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import { COURSE_TYPE_LABELS } from "@/constants/labels";
import type { FormValues } from "@/components/shared/EntityFormModal";
import type { ActionResult } from "@/actions/setup";
import type { Course } from "@/types";
import { cn } from "@/lib/utils";

export interface AddSubjectDialogProps {
  /** The whole catalogue. Filtering happens here, not over the network. */
  courses: Course[];
  /** How many semesters the programme runs — the placement choices. */
  semesterCount: number;
  /** Pre-selected semester when opened from a specific semester's header. */
  defaultSemester?: number;
  /** Pre-bound `addCurriculumSubjectAction.bind(null, curriculumId)`. */
  action: (values: FormValues) => Promise<ActionResult>;
  size?: "sm" | "md";
  /** Overrides the trigger label. */
  label?: string;
}

/**
 * Add-subject dialog: search the catalogue, place a course in a semester, set
 * the credits it carries there and whether it is compulsory.
 *
 * Search is client-side over the catalogue the page already loaded. A course
 * picker is a decision made by scanning — the user types two letters of a code
 * and expects the list to narrow instantly. Round-tripping each keystroke to
 * refilter a list that is already in memory would add latency for nothing.
 *
 * Credits default to the course's catalogue value but stay editable: a
 * curriculum may weight a course differently from the catalogue, and the
 * curriculum's number is what the degree audit counts (see CurriculumSubject).
 */
export function AddSubjectDialog({
  courses,
  semesterCount,
  defaultSemester = 1,
  action,
  size = "md",
  label,
}: AddSubjectDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const modal = useDisclosure();

  const [query, setQuery] = useState("");
  const [courseId, setCourseId] = useState("");
  const [semester, setSemester] = useState(String(defaultSemester));
  const [credits, setCredits] = useState("");
  const [isCompulsory, setIsCompulsory] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = courses.filter((course) => course.isActive);
    if (!needle) return pool;
    return pool.filter(
      (course) =>
        course.code.toLowerCase().includes(needle) ||
        course.name.toLowerCase().includes(needle)
    );
  }, [courses, query]);

  function selectCourse(course: Course) {
    setCourseId(course.id);
    // Seed the credits from the catalogue on selection rather than deriving it
    // during render, so a deliberate override is not overwritten on re-render.
    setCredits(String(course.credits));
    setError(null);
  }

  function close() {
    modal.close();
    setQuery("");
    setCourseId("");
    setSemester(String(defaultSemester));
    setCredits("");
    setIsCompulsory(true);
    setError(null);
  }

  async function handleSubmit() {
    if (!courseId) {
      setError("Choose a course to add.");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    const result = await action({
      courseId,
      semesterNumber: Number(semester),
      credits: Number(credits) || 0,
      isCompulsory,
    });
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast({ variant: "success", title: "Subject added" });
    close();
    router.refresh();
  }

  const semesterOptions = Array.from({ length: semesterCount }, (_, i) => ({
    value: String(i + 1),
    label: `Semester ${i + 1}`,
  }));

  return (
    <>
      <Button size={size} leftIcon={<Plus className="size-4" />} onClick={modal.open}>
        {label ?? "Add subject"}
      </Button>

      {modal.isOpen && (
        <Modal
          isOpen
          onClose={close}
          title="Add subject"
          description="Place a course from the catalogue into a semester of this curriculum."
          size="lg"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={close} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} isLoading={isSubmitting} disabled={!courseId}>
                Add subject
              </Button>
            </div>
          }
        >
          {error && (
            <Alert variant="error" className="mb-4">
              {error}
            </Alert>
          )}

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                Course<span className="ml-0.5 text-danger">*</span>
              </span>
              <SearchInput
                placeholder="Search by code or name…"
                onSearch={setQuery}
                debounceMs={120}
              />

              {/* A radio group, not a <select>: the catalogue runs to hundreds
                  of courses and the choice is made by scanning code and name
                  together, which a single-line dropdown cannot show. */}
              <div
                role="radiogroup"
                aria-label="Course"
                className="max-h-64 overflow-y-auto rounded-md border border-border"
              >
                {matches.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No course matches “{query}”.
                  </p>
                ) : (
                  matches.map((course) => (
                    <button
                      key={course.id}
                      type="button"
                      role="radio"
                      aria-checked={courseId === course.id}
                      onClick={() => selectCourse(course)}
                      className={cn(
                        "flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left last:border-0",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        courseId === course.id ? "bg-primary-bg" : "hover:bg-muted"
                      )}
                    >
                      <BookOpen
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {course.name}
                        </span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {course.code} · {course.credits} credits
                        </span>
                      </span>
                      <Badge size="sm">{COURSE_TYPE_LABELS[course.type]}</Badge>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Semester"
                required
                value={semester}
                onChange={setSemester}
                options={semesterOptions}
              />
              <Input
                label="Credits in this curriculum"
                type="number"
                min={0}
                max={20}
                required
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                helperText="Defaults to the catalogue value."
              />
            </div>

            <Switch
              label="Compulsory"
              checked={isCompulsory}
              onChange={(e) => setIsCompulsory(e.target.checked)}
              helperText="Turn off for an elective students may choose instead."
            />
          </div>
        </Modal>
      )}
    </>
  );
}
