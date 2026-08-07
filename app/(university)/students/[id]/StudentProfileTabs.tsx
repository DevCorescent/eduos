"use client";

import { useState } from "react";
import { FileText, ShieldCheck, Users } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import {
  BLOOD_GROUP_LABELS,
  DOCUMENT_TYPE_LABELS,
  EXAMINATION_TYPE_LABELS,
  GENDER_LABELS,
  STUDENT_STATUS_LABELS,
  STUDENT_STATUS_VARIANTS,
} from "@/constants/labels";
import { formatBytes, formatCurrency, formatDate, formatNumber } from "@/utils/format";
import type {
  StudentDocument,
  StudentParentWithParent,
  StudentPersonal,
  StudentWithUser,
  TranscriptRow,
} from "@/types";

export interface StudentProfileTabsProps {
  student: StudentWithUser;
  programmeName: string | null;
  batchName: string | null;
  sectionName: string | null;
  personal: StudentPersonal | null;
  personalError: string | null;
  documents: StudentDocument[];
  documentsError: string | null;
  parents: StudentParentWithParent[];
  parentsError: string | null;
  transcript: TranscriptRow[];
  transcriptError: string | null;
}

/**
 * The student profile's five tabs.
 *
 * A client component only for the tab selection — every panel is handed
 * fully-resolved data as props, so switching tabs costs no request and is
 * instant. Only the selected panel is mounted: there is no state inside a panel
 * worth preserving, and keeping five alive would hold four sets of DOM for
 * nothing.
 */
export function StudentProfileTabs(props: StudentProfileTabsProps) {
  const [active, setActive] = useState("overview");

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "personal", label: "Personal" },
    // Counts on the tab itself, so staff can see there are documents to review
    // without opening the tab first.
    { value: "documents", label: `Documents (${props.documents.length})` },
    { value: "parents", label: `Guardians (${props.parents.length})` },
    { value: "transcript", label: "Transcript" },
  ];

  return (
    <>
      <Tabs tabs={tabs} value={active} onChange={setActive} className="mb-6" />

      {active === "overview" && <OverviewPanel {...props} />}
      {active === "personal" && (
        <PersonalPanel personal={props.personal} error={props.personalError} />
      )}
      {active === "documents" && (
        <DocumentsPanel documents={props.documents} error={props.documentsError} />
      )}
      {active === "parents" && (
        <ParentsPanel parents={props.parents} error={props.parentsError} />
      )}
      {active === "transcript" && (
        <TranscriptPanel rows={props.transcript} error={props.transcriptError} />
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-3 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-sm text-muted-foreground sm:w-44">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}

function OverviewPanel({
  student,
  programmeName,
  batchName,
  sectionName,
}: StudentProfileTabsProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card header={<h2 className="text-sm font-semibold text-heading">Enrolment</h2>}>
        <dl>
          <Field
            label="Enrolment number"
            value={<span className="font-mono text-xs">{student.enrollmentNo}</span>}
          />
          <Field
            label="Status"
            value={
              <StatusBadge
                label={STUDENT_STATUS_LABELS[student.status]}
                variant={STUDENT_STATUS_VARIANTS[student.status]}
              />
            }
          />
          <Field label="Programme" value={programmeName} />
          <Field label="Batch" value={batchName} />
          <Field label="Section" value={sectionName} />
          <Field label="Current semester" value={student.currentSemester} />
        </dl>
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-heading">Account & dates</h2>}>
        <dl>
          <Field
            label="Email"
            value={
              <a href={`mailto:${student.user.email}`} className="text-primary hover:underline">
                {student.user.email}
              </a>
            }
          />
          <Field label="Admitted" value={formatDate(student.admissionDate)} />
          <Field label="Graduated" value={formatDate(student.graduationDate)} />
          <Field label="Record created" value={formatDate(student.createdAt)} />
        </dl>
      </Card>
    </div>
  );
}

function PersonalPanel({
  personal,
  error,
}: {
  personal: StudentPersonal | null;
  error: string | null;
}) {
  if (error) {
    return (
      <Alert variant="error" title="Personal details unavailable">
        {error}
      </Alert>
    );
  }

  // A student enrolled but not yet profiled is a normal state, not an error —
  // the record is created at enrolment and completed afterwards.
  if (!personal) {
    return (
      <Card>
        <EmptyState
          icon={<ShieldCheck />}
          title="No personal details yet"
          description="Date of birth, address and emergency contact have not been recorded for this student."
        />
      </Card>
    );
  }

  const permanent = personal.permanentAddr;
  const local = personal.localAddr;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card header={<h2 className="text-sm font-semibold text-heading">Personal</h2>}>
        <dl>
          <Field label="Date of birth" value={formatDate(personal.dateOfBirth)} />
          <Field
            label="Gender"
            value={personal.gender ? GENDER_LABELS[personal.gender] : null}
          />
          <Field
            label="Blood group"
            value={personal.bloodGroup ? BLOOD_GROUP_LABELS[personal.bloodGroup] : null}
          />
          <Field label="Nationality" value={personal.nationality} />
          <Field label="Religion" value={personal.religion} />
          <Field label="Category" value={personal.category} />
          <Field label="Mother tongue" value={personal.motherTongue} />
          {personal.disability && (
            <Field
              label="Accessibility"
              value={
                <Badge variant="info" size="sm">
                  {personal.disabilityDesc ?? "Support required"}
                </Badge>
              }
            />
          )}
        </dl>
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-heading">Contact</h2>}>
        <dl>
          <Field
            label="Permanent address"
            value={
              permanent
                ? [permanent.line1, permanent.city, permanent.state, permanent.postalCode]
                    .filter(Boolean)
                    .join(", ")
                : null
            }
          />
          <Field
            label="Local address"
            value={
              local
                ? [local.line1, local.city, local.state].filter(Boolean).join(", ")
                : "Same as permanent"
            }
          />
          <Field
            label="Emergency contact"
            value={
              personal.emergencyContact ? (
                <span>
                  {personal.emergencyContact.name}
                  {personal.emergencyContact.relation && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({personal.emergencyContact.relation})
                    </span>
                  )}
                  {personal.emergencyContact.phone && (
                    <span className="block text-muted-foreground">
                      {personal.emergencyContact.phone}
                    </span>
                  )}
                </span>
              ) : null
            }
          />
          <Field label="Last updated" value={formatDate(personal.updatedAt)} />
        </dl>
      </Card>
    </div>
  );
}

function DocumentsPanel({
  documents,
  error,
}: {
  documents: StudentDocument[];
  error: string | null;
}) {
  if (error) {
    return (
      <Alert variant="error" title="Documents unavailable">
        {error}
      </Alert>
    );
  }

  const verified = documents.filter((doc) => doc.isVerified).length;
  const pending = documents.length - verified;

  const columns: TableColumn<StudentDocument>[] = [
    {
      key: "type",
      header: "Document",
      render: (doc) => (
        <div className="min-w-0">
          <span className="font-medium text-foreground">{DOCUMENT_TYPE_LABELS[doc.type]}</span>
          <p className="truncate text-xs text-muted-foreground">{doc.fileName}</p>
        </div>
      ),
    },
    {
      key: "fileSize",
      header: "Size",
      align: "right",
      render: (doc) => (
        <span className="text-muted-foreground">
          {doc.fileSize ? formatBytes(String(doc.fileSize)) : "—"}
        </span>
      ),
    },
    {
      key: "isVerified",
      header: "Verification",
      render: (doc) => (
        <StatusBadge
          label={doc.isVerified ? "Verified" : "Pending review"}
          variant={doc.isVerified ? "success" : "warning"}
        />
      ),
    },
    {
      key: "uploadedAt",
      header: "Uploaded",
      render: (doc) => (
        <span className="text-muted-foreground">{formatDate(doc.uploadedAt)}</span>
      ),
    },
  ];

  return (
    <>
      {pending > 0 && (
        <Alert variant="warning" title={`${pending} document${pending === 1 ? "" : "s"} awaiting review`} className="mb-4">
          Verification is required before certificates can be issued.
        </Alert>
      )}

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[64rem]"
          columns={columns}
          data={documents}
          rowKey={(doc) => doc.id}
          emptyState={
            <EmptyState
              icon={<FileText />}
              title="No documents uploaded"
              description="The student has not uploaded any identity or academic documents yet."
            />
          }
        />
      </Card>
    </>
  );
}

function ParentsPanel({
  parents,
  error,
}: {
  parents: StudentParentWithParent[];
  error: string | null;
}) {
  if (error) {
    return (
      <Alert variant="error" title="Guardians unavailable">
        {error}
      </Alert>
    );
  }

  if (parents.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Users />}
          title="No guardians recorded"
          description="Add a parent or guardian so the university has an emergency contact."
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {parents.map((link) => (
        <Card
          key={link.parentId}
          header={
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-heading">
                {link.parent.firstName} {link.parent.lastName}
              </h2>
              <div className="flex items-center gap-1.5">
                <Badge variant="neutral" size="sm">
                  {link.parent.relation}
                </Badge>
                {link.isPrimary && (
                  <Badge variant="info" size="sm">
                    Primary
                  </Badge>
                )}
              </div>
            </div>
          }
        >
          <dl>
            <Field
              label="Phone"
              value={
                <a href={`tel:${link.parent.phone}`} className="text-primary hover:underline">
                  {link.parent.phone}
                </a>
              }
            />
            <Field
              label="Email"
              value={
                link.parent.email ? (
                  <a
                    href={`mailto:${link.parent.email}`}
                    className="text-primary hover:underline"
                  >
                    {link.parent.email}
                  </a>
                ) : null
              }
            />
            <Field label="Occupation" value={link.parent.occupation} />
            <Field
              label="Annual income"
              value={
                link.parent.annualIncome ? formatCurrency(link.parent.annualIncome) : null
              }
            />
          </dl>
        </Card>
      ))}
    </div>
  );
}

function TranscriptPanel({
  rows,
  error,
}: {
  rows: TranscriptRow[];
  error: string | null;
}) {
  if (error) {
    return (
      <Alert variant="error" title="Transcript unavailable">
        {error}
      </Alert>
    );
  }

  // Grouped by semester, which is how a transcript is read and printed — a flat
  // chronological list of every paper is not a transcript.
  const bySemester = new Map<string, TranscriptRow[]>();
  for (const row of rows) {
    const existing = bySemester.get(row.semesterName);
    if (existing) existing.push(row);
    else bySemester.set(row.semesterName, [row]);
  }

  const columns: TableColumn<TranscriptRow>[] = [
    {
      key: "courseCode",
      header: "Course",
      render: (row) => (
        <div className="min-w-0">
          <span className="font-medium text-foreground">{row.courseName}</span>
          <p className="truncate font-mono text-xs text-muted-foreground">{row.courseCode}</p>
        </div>
      ),
    },
    {
      key: "examinationType",
      header: "Examination",
      render: (row) => (
        <span className="text-muted-foreground">
          {EXAMINATION_TYPE_LABELS[row.examinationType]}
        </span>
      ),
    },
    {
      key: "marksObtained",
      header: "Marks",
      align: "right",
      render: (row) =>
        row.isAbsent ? (
          <span className="text-muted-foreground">Absent</span>
        ) : (
          <span>
            {formatNumber(Number(row.marksObtained))}
            <span className="text-muted-foreground"> / {row.maxMarks}</span>
          </span>
        ),
    },
    {
      key: "grade",
      header: "Grade",
      align: "right",
      render: (row) => (row.grade ? <Badge variant="neutral" size="sm">{row.grade}</Badge> : "—"),
    },
    {
      key: "isPassed",
      header: "Result",
      render: (row) =>
        // null is distinct from false: not yet evaluated, versus failed.
        row.isPassed === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <StatusBadge
            label={row.isPassed ? "Pass" : "Fail"}
            variant={row.isPassed ? "success" : "danger"}
          />
        ),
    },
  ];

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<FileText />}
          title="No published results"
          description="Results appear here once examinations are evaluated and published."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {Array.from(bySemester.entries()).map(([semesterName, semesterRows]) => (
        <Card
          key={semesterName}
          noPadding
          header={
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-heading">{semesterName}</h2>
              <span className="text-xs text-muted-foreground">
                {semesterRows.length} result{semesterRows.length === 1 ? "" : "s"}
              </span>
            </div>
          }
        >
          <Table columns={columns} data={semesterRows} rowKey={(row) => row.id} />
        </Card>
      ))}
    </div>
  );
}
