import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EntityRowActions } from "@/components/shared/EntityCrud";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getCurriculum, listCurriculumSubjects } from "@/services/academics";
import { unwrapResource } from "@/lib/require-resource";
import { getProgramme } from "@/services/setup";
import { listCourses } from "@/services/courses";
import {
  addCurriculumSubjectAction,
  removeCurriculumSubjectAction,
} from "@/actions/academics";
import { COURSE_TYPE_LABELS, DURATION_UNIT_LABELS, PROGRAMME_TYPE_LABELS } from "@/constants/labels";
import { formatDate } from "@/utils/format";
import type { CurriculumSubjectRow } from "@/types";
import { AddSubjectDialog } from "./AddSubjectDialog";

/** params is a Promise in Next.js 16 — await before destructuring. */
type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const result = await getCurriculum(id);
  return { title: result.success ? result.data.name : "Curriculum" };
}

/** Fallback when the programme cannot be read — most degrees run eight semesters. */
const DEFAULT_SEMESTER_COUNT = 8;

export default async function CurriculumBuilderPage({ params }: { params: Params }) {
  const { id } = await params;

  const [curriculumResult, subjectsResult, coursesResult] = await Promise.all([
    getCurriculum(id),
    listCurriculumSubjects(id),
    listCourses({ page: 1, limit: 500 }),
  ]);

  const curriculum = unwrapResource(curriculumResult, "curriculum");

  // Fetched second because it needs the curriculum's programmeId, which the
  // first round of requests is what produces.
  const programmeResult = await getProgramme(curriculum.programmeId);
  const programme = programmeResult.success ? programmeResult.data : null;

  // A curriculum covers the taught part of a programme. Capped at eight for the
  // same reason the fixtures are: a five-year research degree has no taught
  // curriculum for every term.
  const semesterCount = programme
    ? Math.min(programme.durationValue * 2, DEFAULT_SEMESTER_COUNT)
    : DEFAULT_SEMESTER_COUNT;

  const courses = coursesResult.success ? coursesResult.data.items : [];
  const subjects = subjectsResult.success ? subjectsResult.data : [];

  // Every semester in the programme gets a section, including the empty ones —
  // a gap in the structure is the thing the builder exists to make visible.
  const bySemester = new Map<number, CurriculumSubjectRow[]>();
  for (let semester = 1; semester <= semesterCount; semester += 1) {
    bySemester.set(semester, []);
  }
  for (const subject of subjects) {
    const bucket = bySemester.get(subject.semesterNumber);
    if (bucket) bucket.push(subject);
    // A subject placed beyond the programme's taught span still belongs to the
    // curriculum, so it gets its own section rather than disappearing.
    else bySemester.set(subject.semesterNumber, [subject]);
  }

  const semesters = [...bySemester.entries()].sort(([a], [b]) => a - b);
  const totalCredits = subjects.reduce((sum, subject) => sum + subject.credits, 0);

  const addSubject = (
    <AddSubjectDialog
      courses={courses}
      semesterCount={Math.max(semesterCount, ...semesters.map(([n]) => n))}
      // Bound on the server: the curriculum is part of the address the write
      // goes to, not a value the browser can retarget.
      action={addCurriculumSubjectAction.bind(null, curriculum.id)}
    />
  );

  return (
    <>
      <Link
        href={programme ? `/setup/programmes/${programme.id}` : "/setup/programmes"}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {programme ? `Back to ${programme.code}` : "Back to programmes"}
      </Link>

      <PageHeader
        title={curriculum.name}
        subtitle={
          programme
            ? `${programme.name} · version ${curriculum.version}`
            : `Version ${curriculum.version}`
        }
        action={addSubject}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: what this curriculum is. */}
        <div className="flex flex-col gap-6 lg:col-span-1">
          <Card header={<h2 className="text-sm font-semibold text-heading">Curriculum</h2>}>
            <dl className="flex flex-col">
              <Field label="Programme" value={programme?.name ?? "—"} />
              <Field
                label="Programme type"
                value={programme ? PROGRAMME_TYPE_LABELS[programme.type] : "—"}
              />
              <Field
                label="Duration"
                value={
                  programme
                    ? `${programme.durationValue} ${DURATION_UNIT_LABELS[programme.durationUnit].toLowerCase()}`
                    : "—"
                }
              />
              <Field label="Version" value={curriculum.version} />
              <Field label="Effective from" value={formatDate(curriculum.effectiveFrom)} />
              <Field
                label="Status"
                value={
                  <StatusBadge
                    label={curriculum.isActive ? "Active" : "Superseded"}
                    variant={curriculum.isActive ? "success" : "neutral"}
                  />
                }
              />
            </dl>
          </Card>

          <Card header={<h2 className="text-sm font-semibold text-heading">Structure</h2>}>
            <dl className="flex flex-col">
              <Field label="Subjects placed" value={subjects.length} />
              <Field label="Semesters" value={semesters.length} />
              <Field label="Total credits" value={totalCredits} />
              <Field
                label="Programme requirement"
                value={
                  programme?.totalCredits == null ? (
                    "—"
                  ) : (
                    <span className="flex items-center gap-2">
                      {programme.totalCredits}
                      {/* The gap between what the curriculum carries and what
                          the degree requires is the number this page exists to
                          close, so it is stated rather than left to arithmetic. */}
                      {totalCredits !== programme.totalCredits && (
                        <Badge
                          size="sm"
                          variant={totalCredits > programme.totalCredits ? "warning" : "danger"}
                        >
                          {totalCredits > programme.totalCredits ? "+" : "−"}
                          {Math.abs(totalCredits - programme.totalCredits)}
                        </Badge>
                      )}
                    </span>
                  )
                }
              />
            </dl>
          </Card>
        </div>

        {/* Right: the structure, semester by semester. */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          {!subjectsResult.success ? (
            <ErrorState
              title="Couldn't load the curriculum structure"
              description={subjectsResult.error}
            />
          ) : (
            semesters.map(([semesterNumber, rows]) => {
              const semesterCredits = rows.reduce((sum, row) => sum + row.credits, 0);

              return (
                <Card
                  key={semesterNumber}
                  noPadding
                  header={
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="text-sm font-semibold text-heading">
                        Semester {semesterNumber}
                      </h2>
                      <span className="text-xs text-muted-foreground">
                        {rows.length} {rows.length === 1 ? "subject" : "subjects"} ·{" "}
                        {semesterCredits} credits
                      </span>
                    </div>
                  }
                >
                  {rows.length === 0 ? (
                    <EmptyState
                      icon={<BookOpen />}
                      title="No subjects yet"
                      description={`Nothing is taught in semester ${semesterNumber} of this curriculum.`}
                      className="border-0 bg-transparent py-8"
                    />
                  ) : (
                    <ul className="flex flex-col">
                      {rows.map((row) => (
                        <li
                          key={row.id}
                          className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {row.courseName}
                            </p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {row.courseCode}
                            </p>
                          </div>

                          <Badge size="sm">{COURSE_TYPE_LABELS[row.courseType]}</Badge>
                          <Badge size="sm" variant={row.isCompulsory ? "info" : "neutral"}>
                            {row.isCompulsory ? "Compulsory" : "Elective"}
                          </Badge>
                          <span className="w-16 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                            {row.credits} cr
                          </span>

                          <EntityRowActions
                            entityLabel="Subject"
                            recordName={`${row.courseCode} — ${row.courseName}`}
                            // Both ids bound on the server: a curriculum subject
                            // is addressed under its parent curriculum, and
                            // neither half is the browser's to choose.
                            onDelete={removeCurriculumSubjectAction.bind(
                              null,
                              curriculum.id,
                              row.id
                            )}
                            deleteWarning={`"${row.courseName}" will be removed from semester ${semesterNumber}. The course itself stays in the catalogue.`}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })
          )}

          {!coursesResult.success && (
            <ErrorState
              title="Couldn't load the course catalogue"
              description={`${coursesResult.error} Subjects already placed are shown above, but nothing new can be added until the catalogue loads.`}
            />
          )}
        </div>
      </div>
    </>
  );
}

/** One label/value row in a left-hand card. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-3 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}
