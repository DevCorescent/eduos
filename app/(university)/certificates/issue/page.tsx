import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { listCertificateTemplates } from "@/services/finance";
import { MAX_LIST_LIMIT } from "@/types/api";
import { listStudents } from "@/services/students";
import { CERTIFICATE_TYPE_LABELS } from "@/constants/labels";
import { IssueCertificateForm } from "./IssueCertificateForm";

export const metadata: Metadata = { title: "Issue Certificate" };

export default async function IssueCertificatePage() {
  const [templatesResult, studentsResult] = await Promise.all([
    listCertificateTemplates({ page: 1, limit: 100 }),
    // Active students only: a certificate attesting to current standing should
    // not be issued against a withdrawn record without a deliberate override.
    listStudents({ page: 1, limit: MAX_LIST_LIMIT, status: "ACTIVE" }),
  ]);

  const header = (
    <>
      <Link
        href="/certificates/templates"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to certificates
      </Link>
      <PageHeader
        title="Issue Certificate"
        subtitle="Generate a certificate for a student from a template."
      />
    </>
  );

  if (!templatesResult.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(templatesResult)}
          subject="certificate issuing"
          message={templatesResult.error}
        />
      </>
    );
  }

  return (
    <>
      {header}

      <IssueCertificateForm
        templates={templatesResult.data.items
          .filter((template) => template.isActive)
          .map((template) => ({
            value: template.id,
            label: `${template.name} — ${CERTIFICATE_TYPE_LABELS[template.type]}`,
          }))}
        students={
          studentsResult.success
            ? studentsResult.data.items.map((student) => ({
                value: student.id,
                label: `${student.fullName} — ${student.enrollmentNo}`,
              }))
            : []
        }
      />
    </>
  );
}
