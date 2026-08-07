import type { Metadata } from "next";
import { Flag } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { listSubscriptions } from "@/services/subscriptions";
import { listTenants } from "@/services/tenants";
import { FeatureFlagRow } from "./FeatureFlagRow";

export const metadata: Metadata = { title: "Feature Flags" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{ page?: string }>;

/**
 * Per-tenant feature flags.
 *
 * WHERE THE FLAGS ACTUALLY LIVE
 *   There is no FeatureFlag model and no flag endpoint. The only per-tenant
 *   capability switch in the schema is `Subscription.features`, an untyped JSON
 *   column that PATCH /api/platform/subscriptions/[id] accepts as
 *   `Record<string, unknown>`. This screen edits exactly that, which is why it
 *   is keyed by subscription rather than by tenant.
 *
 * WHY THE FLAG NAMES ARE DISCOVERED, NOT DECLARED
 *   Nothing in the backend enumerates the valid flags — the column takes any
 *   key. A hard-coded catalogue here would show switches the product may not
 *   read and hide ones it does. So the union of keys already in use across
 *   tenants is offered, and a new key can be typed in. What the platform
 *   actually honours is a question only the code consuming these flags can
 *   answer, and it is not this one.
 */
export default async function FeatureFlagsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const [subscriptionsResult, tenantsResult] = await Promise.all([
    listSubscriptions({ page: currentPage, limit: PAGE_SIZE }),
    // Read wide so the rows can be named. The flags are keyed by subscription,
    // but nobody thinks about a subscription id — they think about a university.
    listTenants({ page: 1, limit: 100 }),
  ]);

  const header = (
    <PageHeader
      title="Feature Flags"
      subtitle="Capabilities enabled per tenant, stored on the subscription."
    />
  );

  if (!subscriptionsResult.success) {
    return (
      <>
        {header}
        <ErrorState
          title="Couldn't load subscriptions"
          description={subscriptionsResult.error}
        />
      </>
    );
  }

  const { items, pagination } = subscriptionsResult.data;

  const tenantName = new Map(
    (tenantsResult.success ? tenantsResult.data.items : []).map((tenant) => [
      tenant.id,
      tenant.name,
    ])
  );

  // The union of every key in use, so a flag set on one tenant is offered on
  // the rest rather than having to be retyped from memory.
  const knownFlags = Array.from(
    new Set(items.flatMap((subscription) => Object.keys(subscription.features ?? {})))
  ).sort();

  return (
    <>
      {header}

      <Alert variant="info" className="mb-6">
        Flags are stored on each tenant&apos;s subscription. Saving replaces that
        tenant&apos;s whole flag set — the switches below are read from what is
        currently stored and written back together.
      </Alert>

      <Card noPadding>
        {items.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              icon={<Flag />}
              title="No subscriptions"
              description="Flags are held on a subscription, so a tenant needs one before it can be given capabilities."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((subscription) => (
              <li key={subscription.id}>
                <FeatureFlagRow
                  subscriptionId={subscription.id}
                  tenantName={
                    tenantName.get(subscription.tenantId) ?? subscription.tenantId
                  }
                  plan={subscription.plan}
                  features={subscription.features ?? {}}
                  knownFlags={knownFlags}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4 flex justify-center">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/platform/feature-flags"
          />
        </div>
      )}
    </>
  );
}
