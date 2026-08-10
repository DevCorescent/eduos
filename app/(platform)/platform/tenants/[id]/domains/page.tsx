import type { Metadata } from "next";
import Link from "next/link";
import { Globe } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listTenantDomains, type DomainRow } from "@/services/branding";
import { getTenant } from "@/services/tenants";
import {
  createDomainAction,
  deleteDomainAction,
  updateDomainAction,
} from "@/actions/branding";
import { DomainType } from "@/app/generated/prisma/enums";
import { enumOptions } from "@/constants/enumOptions";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Domains" };

/**
 * PRD §5.2 — the hostnames one university is served on.
 *
 * WHY THIS IS A PLATFORM SCREEN
 *   A hostname is globally unique: one university claiming it denies it to
 *   every other, so §2.1 puts "Domain configuration" under the platform owner.
 *   Branding, which §45 gives to each university, is a separate screen inside
 *   the university's own settings.
 *
 * WHAT THE VERIFICATION COLUMN HONESTLY SAYS
 *   PRD §5.2 asks for "Automated DNS verification". It is NOT built — the PRD
 *   names no mechanism, no token format and no schedule, and this stack has no
 *   worker to poll with. The flag is real and load-bearing (an unverified
 *   domain does not resolve), and the banner says plainly that an operator sets
 *   it. A "Verify now" button that did nothing, or printed DNS instructions
 *   nobody had specified, would be worse than none.
 */
const DOMAIN_FIELDS: FormField[] = [
  {
    name: "type",
    label: "Kind",
    kind: "select",
    required: true,
    options: enumOptions(DomainType),
    helperText:
      "Subdomain is the address every tenant gets on the platform root. Custom is the institution's own hostname.",
  },
  {
    name: "verified",
    label: "Verified",
    kind: "switch",
    helperText:
      "Set by an operator — automated DNS checking is not implemented. An unverified domain does not resolve.",
  },
  {
    name: "isPrimary",
    label: "Canonical",
    kind: "switch",
    helperText: "At most one per university. Turning this on demotes the current one.",
  },
  {
    name: "isActive",
    label: "Serving",
    kind: "switch",
    helperText: "Turn off to stop a hostname resolving without freeing it for another tenant.",
  },
];

export default async function TenantDomainsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [tenantResult, domainsResult] = await Promise.all([
    getTenant(id),
    listTenantDomains(id),
  ]);

  const tenantName = tenantResult.success ? tenantResult.data.name : "University";

  const header = (
    <PageHeader
      title="Domains"
      subtitle={`Hostnames ${tenantName} is served on.`}
      action={
        <div className="flex items-center gap-2">
          <Link
            href={`/platform/tenants/${id}`}
            className={buttonStyles({ variant: "secondary", size: "sm" })}
          >
            Back to tenant
          </Link>
          <EntityCreateButton
            entityLabel="Domain"
            label="Add domain"
            fields={[
              {
                name: "domain",
                label: "Hostname",
                kind: "text",
                required: true,
                maxLength: 253,
                helperText:
                  "For example portal.university.edu. No scheme, no path — it is normalised and stored lower-case without a port.",
              },
              ...DOMAIN_FIELDS,
            ]}
            initialValues={{
              domain: "",
              type: DomainType.CUSTOM,
              verified: false,
              isPrimary: false,
              isActive: true,
            }}
            action={createDomainAction.bind(null, id)}
            modalSize="lg"
          />
        </div>
      }
    />
  );

  if (!domainsResult.success) {
    return (
      <>
        <PageHeader title="Domains" subtitle={`Hostnames ${tenantName} is served on.`} />
        <StateView
          state={resolveFailureState(domainsResult)}
          subject="domains"
          message={domainsResult.error}
        />
      </>
    );
  }

  const { domains } = domainsResult.data;

  const columns: TableColumn<DomainRow>[] = [
    {
      key: "domain",
      header: "Hostname",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-sm text-foreground">{row.domain}</p>
          <p className="truncate text-xs text-muted-foreground">{row.type}</p>
        </div>
      ),
    },
    {
      key: "verified",
      header: "Verification",
      render: (row) => (
        <Badge variant={row.verified ? "success" : "warning"} size="sm">
          {row.verified ? "Verified" : "Unverified"}
        </Badge>
      ),
    },
    {
      key: "isPrimary",
      header: "Canonical",
      render: (row) =>
        row.isPrimary ? (
          <Badge variant="info" size="sm">
            Canonical
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "isActive",
      header: "Serving",
      render: (row) => (
        <Badge variant={row.isActive ? "success" : "neutral"} size="sm">
          {row.isActive ? "Serving" : "Stopped"}
        </Badge>
      ),
    },
    { key: "createdAt", header: "Added", render: (row) => formatDate(row.createdAt) },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <EntityRowActions
          entityLabel="Domain"
          recordName={row.domain}
          editFields={DOMAIN_FIELDS}
          editValues={{
            type: row.type,
            verified: row.verified,
            isPrimary: row.isPrimary,
            isActive: row.isActive,
          }}
          onUpdate={updateDomainAction.bind(null, id, row.id)}
          onDelete={deleteDomainAction.bind(null, id, row.id)}
          deleteWarning="Removing a hostname frees it for another institution to claim, and any link still pointing at it stops working. Turning off Serving stops it resolving without that risk."
          modalSize="lg"
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <Alert variant="warning" className="mb-6">
        <p className="font-medium">Automated DNS verification is not implemented.</p>
        <p className="mt-1 text-sm">
          PRD §5.2 requires it, but specifies no record type, token format or checking
          schedule — so the mechanism is a pending product decision rather than a guess
          made here. The flag below is real and load-bearing: an unverified domain does
          not resolve. Set it only once control of the hostname has been confirmed out of
          band.
        </p>
      </Alert>

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[52rem]"
          columns={columns}
          data={domains}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<Globe />}
              title="No domains configured"
              description="This university is reachable on its platform subdomain. Add a hostname here to serve it on the institution's own domain."
            />
          }
        />
      </Card>
    </>
  );
}
