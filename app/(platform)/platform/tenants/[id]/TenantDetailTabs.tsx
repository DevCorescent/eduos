"use client";

import { useState } from "react";
import { GraduationCap, Users } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Tabs } from "@/components/ui/Tabs";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  BILLING_CYCLE_LABELS,
  INSTITUTION_TYPE_LABELS,
  SUBSCRIPTION_PLAN_LABELS,
  SUBSCRIPTION_PLAN_VARIANTS,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_VARIANTS,
} from "@/constants/labels";
import { formatBytes, formatCurrency, formatDate, formatNumber } from "@/utils/format";
import type { Subscription, Tenant, TenantStats } from "@/types";

export interface TenantDetailTabsProps {
  tenant: Tenant;
  stats: TenantStats | null;
  statsError: string | null;
  subscription: Subscription | null;
  subscriptionError: string | null;
}

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "stats", label: "Usage" },
  { value: "subscription", label: "Subscription" },
];

/**
 * Tabbed detail for one institution.
 *
 * A client component only because the tab selection is local state. All three
 * panels are handed fully-resolved data as props — nothing fetches here, so
 * switching tabs is instant and costs no request.
 *
 * Each panel is rendered only while selected rather than all three being
 * mounted and hidden with CSS. There is no state inside a panel worth
 * preserving, and mounting three keeps two sets of DOM alive for no benefit.
 */
export function TenantDetailTabs({
  tenant,
  stats,
  statsError,
  subscription,
  subscriptionError,
}: TenantDetailTabsProps) {
  const [active, setActive] = useState("overview");

  return (
    <>
      <Tabs tabs={TABS} value={active} onChange={setActive} className="mb-6" />

      {active === "overview" && <OverviewPanel tenant={tenant} />}
      {active === "stats" && <StatsPanel stats={stats} error={statsError} />}
      {active === "subscription" && (
        <SubscriptionPanel subscription={subscription} error={subscriptionError} />
      )}
    </>
  );
}

/** One label/value row. Renders an em dash for an absent value. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-3 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-sm text-muted-foreground sm:w-48">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}

function OverviewPanel({ tenant }: { tenant: Tenant }) {
  const address = tenant.address;
  const addressLine = address
    ? [address.line1, address.city, address.state, address.country].filter(Boolean).join(", ")
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card header={<h2 className="text-sm font-semibold text-heading">Institution</h2>}>
        <dl>
          <Field label="Name" value={tenant.name} />
          <Field
            label="Institution code"
            value={<span className="font-mono text-xs">{tenant.slug}</span>}
          />
          <Field label="Type" value={INSTITUTION_TYPE_LABELS[tenant.type]} />
          <Field label="Established" value={tenant.establishedYear} />
          <Field label="Accreditation no." value={tenant.accreditationNo} />
          <Field label="Onboarded" value={formatDate(tenant.createdAt)} />
        </dl>
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-heading">Contact & locale</h2>}>
        <dl>
          <Field
            label="Email"
            value={
              tenant.contactEmail && (
                <a href={`mailto:${tenant.contactEmail}`} className="text-primary hover:underline">
                  {tenant.contactEmail}
                </a>
              )
            }
          />
          <Field label="Phone" value={tenant.contactPhone} />
          <Field
            label="Website"
            value={
              tenant.website && (
                <a
                  href={tenant.website}
                  target="_blank"
                  // noreferrer alongside noopener: without it the destination
                  // receives this console's URL in the Referer header.
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {tenant.website}
                </a>
              )
            }
          />
          <Field label="Address" value={addressLine} />
          <Field label="Time zone" value={tenant.timezone} />
          <Field label="Locale" value={`${tenant.locale.toUpperCase()} · ${tenant.country}`} />
        </dl>
      </Card>
    </div>
  );
}

function StatsPanel({ stats, error }: { stats: TenantStats | null; error: string | null }) {
  if (error || !stats) {
    return (
      <Alert variant="error" title="Usage unavailable">
        {error ?? "No usage figures were returned for this institution."}
      </Alert>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Students"
          value={formatNumber(stats.students.total)}
          icon={<GraduationCap className="size-5" />}
        />
        <StatCard label="Active Students" value={formatNumber(stats.students.active)} />
        <StatCard
          label="Total Faculty"
          value={formatNumber(stats.faculty.total)}
          icon={<Users className="size-5" />}
        />
        <StatCard label="Active Faculty" value={formatNumber(stats.faculty.active)} />
      </div>

      {/* Stated rather than assumed: the endpoint returns counts only, and a
          reader expecting revenue here should learn why it is absent. */}
      <p className="mt-4 text-xs text-muted-foreground">
        Enrolment counts only. Billing figures are on the Subscription tab.
      </p>
    </>
  );
}

function SubscriptionPanel({
  subscription,
  error,
}: {
  subscription: Subscription | null;
  error: string | null;
}) {
  if (error) {
    return (
      <Alert variant="error" title="Subscription unavailable">
        {error}
      </Alert>
    );
  }

  if (!subscription) {
    return (
      <Alert variant="info" title="No subscription">
        This institution has no subscription record yet.
      </Alert>
    );
  }

  return (
    <Card
      header={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-heading">Current plan</h2>
          <div className="flex items-center gap-2">
            <StatusBadge
              label={SUBSCRIPTION_PLAN_LABELS[subscription.plan]}
              variant={SUBSCRIPTION_PLAN_VARIANTS[subscription.plan]}
              withDot={false}
            />
            <StatusBadge
              label={SUBSCRIPTION_STATUS_LABELS[subscription.status]}
              variant={SUBSCRIPTION_STATUS_VARIANTS[subscription.status]}
            />
          </div>
        </div>
      }
    >
      <dl>
        <Field
          label="Price"
          value={
            subscription.pricePerMonth
              ? `${formatCurrency(subscription.pricePerMonth, subscription.currency)} / month`
              : "No charge during trial"
          }
        />
        <Field label="Billing cycle" value={BILLING_CYCLE_LABELS[subscription.billingCycle]} />
        <Field label="Started" value={formatDate(subscription.startDate)} />
        <Field label="Renews / ends" value={formatDate(subscription.endDate)} />
        <Field label="Trial ends" value={formatDate(subscription.trialEndsAt)} />
        <Field label="Student seats" value={formatNumber(subscription.maxStudents)} />
        <Field label="Faculty seats" value={formatNumber(subscription.maxFaculty)} />
        <Field label="Storage" value={formatBytes(subscription.maxStorage)} />
      </dl>
    </Card>
  );
}
