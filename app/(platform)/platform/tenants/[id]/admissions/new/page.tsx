import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { unwrapResource } from "@/lib/require-resource";
import { getTenant } from "@/services/tenants";
import { listTenantProgrammes } from "@/services/tenants";
import { ApplicationForm } from "./ApplicationForm";

export const metadata: Metadata = { title: "New Application" };
type Params = Promise<{ id: string }>;

/** PRD §8.2 — create an application. Programmes come from the tenant's own rows. */
export default async function NewApplicationPage({ params }: { params: Params }) {
  const { id } = await params;

  const [tenantResult, programmesResult] = await Promise.all([
    getTenant(id),
    listTenantProgrammes(id),
  ]);

  const tenant = unwrapResource(tenantResult, "tenant");

  return (
    <>
      <Link
        href={`/platform/tenants/${id}/admissions`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to admissions
      </Link>

      <PageHeader
        title="New application"
        subtitle={`An admission application to ${tenant.name}. The application and applicant numbers are generated on save.`}
      />

      <ApplicationForm
        tenantId={id}
        programmes={programmesResult.success ? programmesResult.data.programmes : []}
      />
    </>
  );
}
