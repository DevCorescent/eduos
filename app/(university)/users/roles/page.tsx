import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listRoles } from "@/services/users";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "@/actions/users";
import { roleLabel } from "@/constants/roles";
import { formatNumber } from "@/utils/format";
import type { RoleWithCounts } from "@/types";

export const metadata: Metadata = { title: "Roles" };

const FIELDS: FormField[] = [
  {
    kind: "text",
    name: "name",
    label: "Role name",
    required: true,
    placeholder: "Exam Controller",
    helperText: "Stored in upper case with underscores, e.g. EXAM_CONTROLLER.",
  },
  {
    kind: "textarea",
    name: "description",
    label: "Description",
    rows: 2,
    placeholder: "What this role is allowed to do.",
  },
];

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  // Unpaginated: a tenant defines a handful of roles, and paging nine rows adds
  // a control that never does anything.
  const result = await listRoles({ page: 1, limit: 100, q });

  const header = (
    <PageHeader
      title="Roles"
      subtitle="What each role is permitted to do, and how many people hold it."
      breadcrumb={
        <Link
          href="/users"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to users
        </Link>
      }
      action={
        <EntityCreateButton
          entityLabel="Role"
          fields={FIELDS}
          initialValues={{ name: "", description: "" }}
          action={createRoleAction}
        />
      }
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load roles" description={result.error} />
      </>
    );
  }

  const roles = result.data.items;

  const columns: TableColumn<RoleWithCounts>[] = [
    {
      key: "name",
      header: "Role",
      render: (role) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{roleLabel(role.name)}</span>
            {role.isSystem && <StatusBadge label="System" variant="info" withDot={false} />}
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">{role.name}</p>
        </div>
      ),
    },
    {
      key: "description",
      header: "Description",
      render: (role) => (
        <span className="text-muted-foreground">{role.description ?? "—"}</span>
      ),
    },
    {
      key: "permissionCount",
      header: "Permissions",
      align: "right",
      // Zero means "not reported by this endpoint" as well as "none granted",
      // and the two are indistinguishable here — so a dash is the honest render.
      render: (role) => (role.permissionCount > 0 ? formatNumber(role.permissionCount) : "—"),
    },
    {
      key: "userCount",
      header: "Users",
      align: "right",
      render: (role) =>
        role.userCount > 0 ? (
          <Link
            href={`/users?roleId=${role.id}`}
            className="font-medium text-primary hover:underline"
          >
            {formatNumber(role.userCount)}
          </Link>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (role) => (
        <EntityRowActions
          entityLabel="Role"
          recordName={roleLabel(role.name)}
          editFields={FIELDS}
          editValues={{ name: role.name, description: role.description ?? "" }}
          onUpdate={updateRoleAction.bind(null, role.id)}
          // A system role is offered no delete at all. Rendering the control and
          // then refusing on click teaches the user the button is a lie; the
          // service still refuses, so this is presentation, not the guard.
          onDelete={role.isSystem ? undefined : deleteRoleAction.bind(null, role.id)}
          deleteWarning={`"${roleLabel(role.name)}" will be permanently removed. Roles still held by a user cannot be deleted.`}
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar search={<ListSearch placeholder="Search roles…" />} />

      <Card noPadding>
        <Table
          columns={columns}
          data={roles}
          rowKey={(role) => role.id}
          emptyState={
            <EmptyState
              icon={<ShieldCheck />}
              title={q ? "No matching roles" : "No roles yet"}
              description={
                q ? "No role matches that search." : "Create a role to grant people access."
              }
            />
          }
        />
      </Card>
    </>
  );
}
