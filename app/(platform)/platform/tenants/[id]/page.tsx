import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { getTenant, getTenantStats } from "@/services/tenants";
import { getSubscriptionForTenant } from "@/services/subscriptions";
import { TENANT_STATUS_LABELS, TENANT_STATUS_VARIANTS } from "@/constants/labels";
import { TenantDetailTabs } from "./TenantDetailTabs";

/** params is a Promise in Next.js 16 — it must be awaited before destructuring. */
type Params = Promise<{ id: string }>;

/**
 * Sets the browser tab title to the institution's name.
 *
 * The fetch here is not a second round trip in practice: Next.js dedupes
 * identical fetches within one render pass, so this and the page below share
 * a single request.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const result = await getTenant(id);

  return { title: result.success ? result.data.name : "Institution" };
}

export default async function TenantDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  // Issued together rather than in sequence. Stats and subscription do not
  // depend on the tenant record, so awaiting them one after another would add
  // two avoidable round trips to first paint.
  const [tenantResult, statsResult, subscriptionResult] = await Promise.all([
    getTenant(id),
    getTenantStats(id),
    getSubscriptionForTenant(id),
  ]);

  // notFound() renders the 404 page. Any other failure is a real error and is
  // surfaced by the route's error boundary instead — the two must not be
  // conflated, or a transient outage would tell the user the tenant was deleted.
  if (!tenantResult.success) {
    if (tenantResult.code === "NOT_FOUND") notFound();
    throw new Error(tenantResult.error);
  }

  const tenant = tenantResult.data;

  return (
    <>
      <Link
        href="/platform/tenants"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to tenants
      </Link>

      <PageHeader
        title={tenant.name}
        subtitle={tenant.slug}
        action={
          <StatusBadge
            label={TENANT_STATUS_LABELS[tenant.status]}
            variant={TENANT_STATUS_VARIANTS[tenant.status]}
            size="md"
          />
        }
      />

      {/* Stats and subscription are passed as nullable rather than as failures
          to throw on: neither is essential to reading the tenant, so a failure
          in either degrades that one panel instead of blanking the page. */}
      <TenantDetailTabs
        tenant={tenant}
        stats={statsResult.success ? statsResult.data : null}
        statsError={statsResult.success ? null : statsResult.error}
        subscription={subscriptionResult.success ? subscriptionResult.data : null}
        subscriptionError={subscriptionResult.success ? null : subscriptionResult.error}
      />
    </>
  );
}
