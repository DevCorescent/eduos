import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { unwrapResource } from "@/lib/require-resource";
import { getImportEntities, getTenant } from "@/services/tenants";
import { ImportWizard } from "./ImportWizard";

/** params is a Promise in Next.js 16 — it must be awaited before destructuring. */
type Params = Promise<{ id: string }>;

export const metadata: Metadata = {
  title: "Import Data",
};

/**
 * PRD §5.1 #14 "Import initial university data" (W1.6).
 *
 * A page under the EXISTING platform portal, addressed per tenant. The
 * university is therefore fixed by the URL rather than chosen inside the form —
 * which is what makes "never trust a tenantId from the CSV" structural rather
 * than a validation rule: there is nowhere in the flow for a file to name one.
 *
 * The entity catalogue is fetched on the server so the first paint already
 * documents the accepted columns, and so the template the operator downloads is
 * generated from the same definitions the API validates against.
 */
export default async function TenantImportPage({ params }: { params: Params }) {
  const { id } = await params;

  const [tenantResult, entitiesResult] = await Promise.all([
    getTenant(id),
    getImportEntities(id),
  ]);

  // notFound() renders the 404 page; any other failure goes to the route's
  // error boundary. Conflating them would report a transient outage as a
  // deleted university.
  const tenant = unwrapResource(tenantResult, "tenant");

  return (
    <>
      <Link
        href={`/platform/tenants/${tenant.id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to {tenant.name}
      </Link>

      <PageHeader
        title="Import data"
        subtitle={`Bulk-load initial records into ${tenant.name} from a CSV file.`}
      />

      <ImportWizard
        tenantId={tenant.id}
        tenantName={tenant.name}
        entities={entitiesResult.success ? entitiesResult.data.entities : null}
        error={entitiesResult.success ? null : entitiesResult.error}
      />
    </>
  );
}
