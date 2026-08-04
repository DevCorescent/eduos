import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { listCertificateTemplates } from "@/services/finance";
import { listStudents } from "@/services/students";
import { CERTIFICATE_TYPE_LABELS } from "@/constants/labels";
import { IssueCertificateForm } from "./IssueCertificateForm";

export const metadata: Metadata = { title: "Issue Certificate" };

export default async function IssueCertificatePage() {
  const [templatesResult, studentsResult] = await Promise.all([
    listCertificateTemplates({ page: 1, limit: 100 }),
    // Active students only: a certificate attesting to current standing should
    // not be issued against a withdrawn record without a deliberate override.
    listStudents({ page: 1, limit: 200, status: "ACTIVE" }),
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
        <ErrorState title="Couldn't load templates" description={templatesResult.error} />
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
