import type { Metadata } from "next";
import { GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getStudentResult, listResultStudents } from "@/services/evaluation";
import type {
  ComponentResultDTO,
  CourseResultDTO,
  SemesterResultDTO,
} from "@/lib/dto/result.dto";
import type { CourseOutcome } from "@/lib/constants/resultEngine";
import { formatNumber } from "@/utils/format";

export const metadata: Metadata = { title: "Student Results" };

type SearchParams = Promise<{ studentId?: string }>;

/**
 * One student's computed result — tester issue #32.
 *
 * WHAT WAS WRONG
 *   Nothing except that this file did not exist. The Evaluation overview has
 *   carried a "Student Results" tile pointing at /evaluation/results/student
 *   since it was written, and the Semester Results table links every row to
 *   `/evaluation/results/student?studentId=…`, so there were TWO ways into a
 *   route with no page behind it — both answering Next.js's 404.
 *
 *   Everything underneath was already built and is reused untouched here:
 *   services/evaluation.ts getStudentResult → GET /api/results/student/[id] →
 *   result.controller.ts → result.service.ts. That service function had no
 *   caller in the whole frontend until now. No API, service or href changed.
 *
 * WHY THIS IS NOT THE TRANSCRIPT PAGE
 *   The transcript prints the record — semester lines, credits, classification.
 *   This prints the COMPUTATION: every component's raw and awarded marks, what
 *   each contributed, which passing criteria failed, and the totals that
 *   follow. It is what a registrar opens when a student disputes a grade, and
 *   it is exactly what the tile promises: "One student's components, totals,
 *   grades, SGPA and CGPA."
 *
 * THE STUDENT PICKER READS /api/results/students, not the student registry —
 * tester issue #48. This screen is reachable by the Controller of Examination,
 * who may read every result on it and is deliberately outside
 * STUDENT_READ_ROLES, so filling the picker from GET /api/students left the
 * examination office with an empty list. The selector is gated on
 * requireResultAccess, the same authority getStudentResult below uses, so it
 * cannot offer a student whose result would then be refused.
 *
 * It stays a plain list rather than a search box: the selector endpoint accepts
 * no parameters at all.
 */

/** How an outcome is coloured. Stated once so no two tables disagree. */
const OUTCOME_VARIANT: Record<CourseOutcome, "success" | "danger" | "warning" | "neutral"> = {
  PASS: "success",
  FAIL: "danger",
  // Barred rather than beaten — a different thing from FAIL, and it reads as a
  // different thing here. See COURSE_OUTCOME in lib/constants/resultEngine.ts.
  INELIGIBLE: "danger",
  // Neither of these is a failure: one is a mark not yet released, the other an
  // assessment that has not concluded. Colouring them red would tell a
  // registrar a student had failed something they simply have not sat.
  WITHHELD: "warning",
  INCOMPLETE: "warning",
};

export default async function StudentResultsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { studentId } = await searchParams;

  // The result-scoped picker, not the student registry — tester issue #48.
  // Same reasoning as the Transcript page: this screen is reachable by the
  // Controller of Examination, who may read every result here and is
  // deliberately outside STUDENT_READ_ROLES.
  const studentsResult = await listResultStudents();
  const students = studentsResult.success ? studentsResult.data : [];

  const header = (
    <PageHeader
      title="Student Results"
      subtitle="One student's components, totals, grades, SGPA and CGPA."
    />
  );

  const toolbar = (
    <ListToolbar
      filters={
        <ListFilter
          paramKey="studentId"
          label="Student"
          hideLabel
          allLabel="Select a student"
          options={students.map((student) => ({
            value: student.id,
            // Name AND enrolment number, since /api/results/students joins the
            // User — the registry listing carried no name, which is why this
            // picker could previously show only the number.
            label: `${student.name} — ${student.enrollmentNo}`,
          }))}
        />
      }
    />
  );

  if (!studentId) {
    return (
      <>
        {header}
        {toolbar}
        <Card>
          <EmptyState
            icon={<GraduationCap />}
            title="Choose a student"
            description="Pick a student above to see their computed result."
          />
        </Card>
      </>
    );
  }

  const result = await getStudentResult(studentId);

  if (!result.success) {
    return (
      <>
        {header}
        {toolbar}
        <StateView
          state={resolveFailureState(result)}
          subject="student results"
          message={result.error}
        />
      </>
    );
  }

  const student = result.data;

  const courseColumns: TableColumn<CourseResultDTO>[] = [
    {
      key: "courseCode",
      header: "Course",
      render: (course) => (
        <div className="min-w-0">
          <p className="font-mono text-xs font-medium text-foreground">{course.courseCode}</p>
          <p className="truncate text-xs text-muted-foreground">{course.courseName}</p>
        </div>
      ),
    },
    {
      key: "credits",
      header: "Credits",
      align: "right",
      render: (course) => (
        <span className="whitespace-nowrap">
          {course.creditsEarned}
          <span className="text-muted-foreground"> / {course.credits}</span>
        </span>
      ),
    },
    {
      key: "percentage",
      header: "Total",
      align: "right",
      render: (course) => <span className="font-medium">{course.percentage}%</span>,
    },
    {
      key: "grade",
      header: "Grade",
      align: "right",
      render: (course) => (
        <span className="font-medium text-foreground">
          {/* Null is not zero — it means the result is not resolvable yet. */}
          {course.grade ?? <span className="text-muted-foreground">—</span>}
          {course.isOverridden && (
            // A criterion or a mandatory failure overrode the band the marks
            // alone would have earned. Without this the grade looks arbitrary.
            <span className="ml-1 align-middle">
              <Badge variant="warning" size="sm">
                Overridden
              </Badge>
            </span>
          )}
        </span>
      ),
    },
    {
      key: "gradePoint",
      header: "Points",
      align: "right",
      render: (course) => course.gradePoint ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: "attemptNumber",
      header: "Attempt",
      align: "right",
      render: (course) =>
        course.attemptNumber > 1 ? (
          <Badge variant="neutral" size="sm">
            #{course.attemptNumber}
          </Badge>
        ) : (
          <span className="text-muted-foreground">1</span>
        ),
    },
    {
      key: "outcome",
      header: "Outcome",
      render: (course) => (
        <Badge variant={OUTCOME_VARIANT[course.outcome]} size="sm">
          {course.outcome}
        </Badge>
      ),
    },
  ];

  const componentColumns: TableColumn<ComponentResultDTO>[] = [
    {
      key: "code",
      header: "Component",
      render: (component) => (
        <span className="font-mono text-xs">
          {component.code}
          {!component.isLeaf && (
            // A parent component's marks are the roll-up of its children, not a
            // mark anyone entered. Saying so stops it reading as a duplicate.
            <span className="ml-1 text-muted-foreground">(group)</span>
          )}
        </span>
      ),
    },
    { key: "raw", header: "Raw", align: "right", render: (c) => c.raw },
    { key: "awarded", header: "Awarded", align: "right", render: (c) => c.awarded },
    { key: "maxMarks", header: "Max", align: "right", render: (c) => c.maxMarks },
    {
      key: "contribution",
      header: "Contributes",
      align: "right",
      render: (c) => `${c.contribution}%`,
    },
    {
      key: "sessionCount",
      header: "Sessions",
      align: "right",
      render: (c) => <span className="text-muted-foreground">{c.sessionCount}</span>,
    },
  ];

  /** One semester, with every course and every course's components beneath it. */
  function renderSemester(semester: SemesterResultDTO) {
    return (
      <Card key={semester.semesterId} className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">{semester.semesterName}</h2>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              SGPA{" "}
              <span className="font-medium text-foreground">
                {semester.sgpa.value ?? "—"}
              </span>
            </span>
            <span>
              Credits{" "}
              <span className="font-medium text-foreground">
                {semester.credits.earned} / {semester.credits.registered}
              </span>
            </span>
            {semester.backlogCount > 0 && (
              <Badge variant="danger" size="sm">
                {semester.backlogCount} backlog{semester.backlogCount === 1 ? "" : "s"}
              </Badge>
            )}
            <Badge variant={semester.isPromoted ? "success" : "warning"} size="sm">
              {semester.isPromoted ? "Promoted" : "Not promoted"}
            </Badge>
            {/* Provisional is the load-bearing one: a cohort operation is still
                outstanding, so these figures may still move. */}
            {semester.isProvisional && (
              <Badge variant="warning" size="sm">
                Provisional
              </Badge>
            )}
            {!semester.isPublished && (
              <Badge variant="neutral" size="sm">
                Unpublished
              </Badge>
            )}
          </div>
        </div>

        <div className="mt-4">
          <Table
            minWidthClassName="min-w-[52rem]"
            columns={courseColumns}
            data={semester.courses}
            rowKey={(course) => course.courseRegistrationId}
            emptyState={
              <EmptyState
                icon={<GraduationCap />}
                title="No courses"
                description="Nothing was registered for this semester."
              />
            }
          />
        </div>

        {/* The component breakdown, per course. This is the part the transcript
            does not carry and the reason this page exists, so it is rendered
            rather than hidden behind a link to somewhere else. */}
        {semester.courses.map((course) =>
          course.components.length === 0 && course.failedCriteria.length === 0 ? null : (
            <div
              key={`${course.courseRegistrationId}-detail`}
              className="mt-4 rounded-md border border-border p-3"
            >
              <p className="font-mono text-xs font-medium text-foreground">
                {course.courseCode}
                <span className="ml-2 font-sans font-normal text-muted-foreground">
                  {course.courseName}
                </span>
              </p>

              {course.components.length > 0 && (
                <div className="mt-3">
                  <Table
                    minWidthClassName="min-w-[40rem]"
                    columns={componentColumns}
                    data={course.components}
                    rowKey={(component) => `${course.courseRegistrationId}-${component.code}`}
                  />
                </div>
              )}

              {/* Why a result went against the marks. A failed criterion is the
                  single most useful line on this page during a dispute. */}
              {course.failedCriteria.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-danger">Failed criteria</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {course.failedCriteria.map((criterion) => (
                      <li key={criterion.code} className="text-xs text-muted-foreground">
                        <span className="font-mono text-foreground">{criterion.code}</span>{" "}
                        — {criterion.metric}: needed {criterion.threshold}, got{" "}
                        {criterion.actual} ({criterion.outcome})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Cohort rules a second pass must still apply. Until they run,
                  this course's result is not final. */}
              {course.pendingOperations.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Pending: {course.pendingOperations.join(", ")}
                </p>
              )}
            </div>
          )
        )}
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Student Results"
        subtitle={`Enrollment ${student.enrollmentNo}`}
      />
      {toolbar}

      {/* Never silently omitted — a student the engine could not compute is the
          most important thing on a results screen. */}
      {student.warnings.length > 0 && (
        <Alert variant="warning" title="Some results could not be computed" className="mb-4">
          <ul className="flex flex-col gap-1">
            {student.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Null CGPA is "—", never 0: nothing carried credit yet, which is a
            different statement from a zero average. */}
        <StatCard label="CGPA" value={student.standing.cgpa ?? "—"} />
        <StatCard
          label="Credits earned"
          value={student.credits.earned}
          caption={`${student.credits.registered} registered`}
        />
        <StatCard
          label="Backlogs"
          value={formatNumber(student.standing.backlogCount)}
          caption={student.standing.isClear ? "All clear" : "Outstanding"}
        />
        <StatCard
          label="Standing"
          value={student.standing.classification ?? student.standing.grade ?? "—"}
          caption={
            student.standing.cgpaPercent ? `${student.standing.cgpaPercent}%` : undefined
          }
        />
      </div>

      {student.semesters.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<GraduationCap />}
            title="No results yet"
            description="This student has no computed result for any semester."
          />
        </Card>
      ) : (
        student.semesters.map(renderSemester)
      )}
    </>
  );
}
