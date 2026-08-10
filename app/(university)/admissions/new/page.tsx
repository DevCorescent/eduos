import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { listProgrammes } from "@/services/setup";
import { TenantApplicationForm } from "./TenantApplicationForm";

export const metadata: Metadata = { title: "New Application" };

/**
 * PRD §8.2 — create an application in the signed-in university (TD-W3-6).
 *
 * Programmes come from the tenant's own /api/programmes, which is already
 * tenant-guarded — no platform route and no hardcoded list.
 */
export default async function NewAdmissionPage() {
  const programmes = await listProgrammes({ page: 1, limit: 100 });

  return (
    <>
      <Link
        href="/admissions"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to admissions
      </Link>

      <PageHeader
        title="New application"
        subtitle="The application and applicant numbers are generated on save."
      />

      <TenantApplicationForm
        programmes={
          programmes.success
            ? programmes.data.items.map((p) => ({ id: p.id, code: p.code, name: p.name }))
            : []
        }
      />
    </>
  );
}
