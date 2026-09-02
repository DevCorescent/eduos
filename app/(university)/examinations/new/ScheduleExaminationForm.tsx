"use client";

// ============================================================================
// MODULE : Examination — schedule
// LAYER  : Client component
// PURPOSE: Let the examination office schedule an examination — PRD §17.2
//          Examination Configuration.
//
// WHERE THE OPTIONS COME FROM
//   The course and semester lists are resolved on the server by the page and
//   passed in. They come from the minimum reference reads the examination
//   office was granted for exactly this purpose: GET /api/courses and
//   GET /api/academic-years/[id]/semesters. Nothing here widens that.
//
// AUTHORIZATION IS NOT DECIDED HERE
//   POST /api/examinations applies EXAMINATION_MANAGE_ROLES and resolves the
//   caller from their session. Both the course and the semester are re-resolved
//   TENANT-SCOPED by that route, so an id typed into this form that belongs to
//   another university is refused there — not by this component's option list.
// ============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/providers/ToastProvider";
import { scheduleExaminationAction } from "@/actions/examinations";
import { EXAMINATION_TYPE_LABELS } from "@/constants/labels";
import { enumOptions } from "@/constants/enumOptions";
import { ExaminationType } from "@/app/generated/prisma/enums";

interface Option {
  value: string;
  label: string;
}

export interface ScheduleExaminationFormProps {
  courses: Option[];
  semesters: Option[];
}

export function ScheduleExaminationForm({
  courses,
  semesters,
}: ScheduleExaminationFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [courseId, setCourseId] = useState("");
  const [semesterId, setSemesterId] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>(ExaminationType.END_TERM);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [venue, setVenue] = useState("");
  const [maxMarks, setMaxMarks] = useState("100");
  const [passMark, setPassMark] = useState("");
  const [duration, setDuration] = useState("");
  const [instructions, setInstructions] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  // A missing catalogue is reported rather than rendered as an empty dropdown:
  // a picker with nothing in it looks broken, and the reason matters.
  if (courses.length === 0 || semesters.length === 0) {
    return (
      <Alert variant="warning" title="Nothing to schedule against">
        {courses.length === 0
          ? "No course exists in this university yet."
          : "No semester exists in this university yet."}{" "}
        An examination is scheduled against a course and a semester, so one of
        each must exist first.
      </Alert>
    );
  }

  async function submit() {
    setSaving(true);
    setError(null);
    setField(null);

    const result = await scheduleExaminationAction({
      courseId,
      semesterId,
      title,
      type,
      date,
      startTime,
      endTime,
      venue,
      maxMarks,
      passMark,
      duration,
      instructions,
    });

    setSaving(false);

    if (!result.success) {
      setError(result.error);
      setField(result.field ?? null);
      toast({
        variant: "error",
        title: "Could not schedule the examination",
        description: result.error,
      });
      return;
    }

    toast({ variant: "success", title: "Examination scheduled" });
    router.push("/examinations");
    router.refresh();
  }

  const incomplete = courseId === "" || semesterId === "" || title.trim() === "";

  return (
    <div className="max-w-3xl space-y-4">
      {error && <Alert variant="error">{error}</Alert>}

      <Card header={<h2 className="text-sm font-semibold text-heading">Examination</h2>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Course"
            required
            value={courseId}
            onChange={setCourseId}
            placeholder="Select a course"
            options={courses}
            error={field === "courseId" ? error ?? undefined : undefined}
          />
          <Select
            label="Semester"
            required
            value={semesterId}
            onChange={setSemesterId}
            placeholder="Select a semester"
            options={semesters}
          />
          <div className="sm:col-span-2">
            <Input
              label="Title"
              required
              value={title}
              placeholder="End-Semester Examination"
              onChange={(event) => setTitle(event.target.value)}
              error={field === "title" ? error ?? undefined : undefined}
            />
          </div>
          <Select
            label="Type"
            value={type}
            onChange={setType}
            options={enumOptions(ExaminationType, EXAMINATION_TYPE_LABELS)}
          />
          <Input
            label="Venue"
            value={venue}
            placeholder="Examination Hall 1"
            onChange={(event) => setVenue(event.target.value)}
          />
        </div>
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-heading">Schedule</h2>}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <Input
            label="Start time"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
          <Input
            label="End time"
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            error={field === "endTime" ? error ?? undefined : undefined}
          />
        </div>
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-heading">Marking</h2>}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Maximum marks"
            type="number"
            min={1}
            required
            value={maxMarks}
            onChange={(event) => setMaxMarks(event.target.value)}
            error={field === "maxMarks" ? error ?? undefined : undefined}
          />
          <Input
            label="Pass mark"
            type="number"
            min={0}
            value={passMark}
            onChange={(event) => setPassMark(event.target.value)}
            error={field === "passMark" ? error ?? undefined : undefined}
          />
          <Input
            label="Duration (minutes)"
            type="number"
            min={1}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </div>
        <div className="mt-4">
          <Textarea
            label="Instructions"
            rows={3}
            value={instructions}
            placeholder="Answer all questions. No electronic devices permitted."
            onChange={(event) => setInstructions(event.target.value)}
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={saving || incomplete}>
          <CalendarPlus className="h-4 w-4" />
          {saving ? "Scheduling…" : "Schedule examination"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Course, semester and title are required. Everything else can be filled
          in later.
        </p>
      </div>
    </div>
  );
}
