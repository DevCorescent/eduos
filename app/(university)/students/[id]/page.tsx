import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import {
  getStudent,
  getStudentPersonal,
  getStudentTranscript,
  listStudentDocuments,
  listStudentParents,
} from "@/services/students";
import { listBatches, listSections } from "@/services/calendar";
import { unwrapResource } from "@/lib/require-resource";
import { listProgrammes } from "@/services/setup";
import { STUDENT_STATUS_LABELS, STUDENT_STATUS_VARIANTS } from "@/constants/labels";
import { StudentProfileTabs } from "./StudentProfileTabs";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const result = await getStudent(id);
  return { title: result.success ? result.data.fullName : "Student" };
}

export default async function StudentProfilePage({ params }: { params: Params }) {
  const { id } = await params;

  const studentResult = await getStudent(id);

  const student = unwrapResource(studentResult, "student");

  // Every tab's data is fetched up front and passed down as props, rather than
  // each tab fetching on selection. Five sub-resources issued together cost one
  // round trip; fetching on click would put a spinner behind every tab and make
  // switching between them feel slow.
  const [
    personalResult,
    documentsResult,
    parentsResult,
    transcriptResult,
    programmesResult,
    batchesResult,
  ] = await Promise.all([
    getStudentPersonal(id),
    listStudentDocuments(id, { page: 1, limit: 100 }),
    listStudentParents(id, { page: 1, limit: 100 }),
    getStudentTranscript(id),
    listProgrammes({ page: 1, limit: 100 }),
    listBatches({ page: 1, limit: 100 }),
  ]);

  const programme = programmesResult.success
    ? programmesResult.data.items.find((p) => p.id === student.programmeId)
    : undefined;
  const batch = batchesResult.success
    ? batchesResult.data.items.find((b) => b.id === student.batchId)
    : undefined;

  // Sections belong to a batch, so this can only run once the batch is known.
  const sectionsResult = batch
    ? await listSections(batch.id, { page: 1, limit: 100 })
    : null;
  const section = sectionsResult?.success
    ? sectionsResult.data.items.find((s) => s.id === student.sectionId)
    : undefined;

  return (
    <>
      <Link
        href="/students"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to students
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={student.fullName} src={student.user.avatarUrl ?? undefined} size="lg" />
        <div className="min-w-0 flex-1">
          <PageHeader
            className="pb-0"
            title={student.fullName}
            subtitle={`${student.enrollmentNo} · ${student.user.email}`}
            action={
              <StatusBadge
                label={STUDENT_STATUS_LABELS[student.status]}
                variant={STUDENT_STATUS_VARIANTS[student.status]}
                size="md"
              />
            }
          />
        </div>
      </div>

      <StudentProfileTabs
        student={student}
        programmeName={programme ? `${programme.name} (${programme.code})` : null}
        batchName={batch?.name ?? null}
        sectionName={section?.name ?? null}
        personal={personalResult.success ? personalResult.data : null}
        personalError={personalResult.success ? null : personalResult.error}
        documents={documentsResult.success ? documentsResult.data.items : []}
        documentsError={documentsResult.success ? null : documentsResult.error}
        parents={parentsResult.success ? parentsResult.data.items : []}
        parentsError={parentsResult.success ? null : parentsResult.error}
        transcript={transcriptResult.success ? transcriptResult.data : []}
        transcriptError={transcriptResult.success ? null : transcriptResult.error}
      />
    </>
  );
}
