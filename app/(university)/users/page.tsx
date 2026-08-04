import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Users as UsersIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listRoles, listUsers, type UserRow } from "@/services/users";
import { createUserAction, deleteUserAction, updateUserAction } from "@/actions/users";
import { roleLabel } from "@/constants/roles";
import { formatRelative } from "@/utils/format";

export const metadata: Metadata = { title: "Users & Roles" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{
  q?: string;
  roleId?: string;
  isActive?: string;
  page?: string;
}>;

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, roleId, isActive, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const [result, rolesResult] = await Promise.all([
    listUsers({ page: currentPage, limit: PAGE_SIZE, q, roleId, isActive }),
    listRoles({ page: 1, limit: 100 }),
  ]);

  const roles = rolesResult.success ? rolesResult.data.items : [];
  const roleOptions = roles.map((role) => ({ value: role.id, label: roleLabel(role.name) }));

  // Invite carries a password because POST /api/users requires one — there is
  // no invite-token endpoint. Named "temporary password" rather than
  // "password", since the person receiving it did not choose it.
  const inviteFields: FormField[] = [
    { kind: "text", name: "firstName", label: "First name", required: true, placeholder: "Ananya" },
    { kind: "text", name: "lastName", label: "Last name", required: true, placeholder: "Rao" },
    { kind: "email", name: "email", label: "Email", required: true, placeholder: "ananya.rao@university.edu" },
    {
      kind: "text",
      name: "password",
      label: "Temporary password",
      required: true,
      helperText: "At least 8 characters. The user should change it after signing in.",
    },
    { kind: "text", name: "phone", label: "Phone", placeholder: "+91 98765 43210" },
    {
      kind: "select",
      name: "roleId",
      label: "Role",
      options: roleOptions,
      placeholder: "Select a role",
      helperText: "A user with no role can sign in but reach nothing.",
    },
    { kind: "switch", name: "isActive", label: "Active" },
  ];

  const editFields: FormField[] = [
    { kind: "text", name: "firstName", label: "First name", required: true },
    { kind: "text", name: "lastName", label: "Last name", required: true },
    { kind: "email", name: "email", label: "Email", required: true },
    { kind: "text", name: "phone", label: "Phone" },
    {
      kind: "switch",
      name: "isActive",
      label: "Active",
      helperText: "Deactivating blocks sign-in without deleting the account.",
    },
  ];

  const header = (
    <PageHeader
      title="Users & Roles"
      subtitle="Everyone with an account in this university."
      action={
        <div className="flex items-center gap-2">
          <Link href="/users/roles" className={buttonStyles({ variant: "secondary" })}>
            <ShieldCheck className="size-4" aria-hidden="true" />
            Manage roles
          </Link>
          <EntityCreateButton
            entityLabel="User"
            label="Invite user"
            fields={inviteFields}
            initialValues={{
              firstName: "",
              lastName: "",
              email: "",
              password: "",
              phone: "",
              roleId: roleId ?? "",
              isActive: true,
            }}
            action={createUserAction}
            modalSize="lg"
          />
        </div>
      }
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load users" description={result.error} />
      </>
    );
  }

  const { items, pagination } = result.data;
  const hasFilters = Boolean(q || roleId || isActive);

  const columns: TableColumn<UserRow>[] = [
    {
      key: "fullName",
      header: "User",
      render: (user) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={user.fullName} src={user.avatarUrl ?? undefined} size="sm" />
          <div className="min-w-0">
            <Link
              href={`/users/${user.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {user.fullName}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "roles",
      header: "Roles",
      render: (user) =>
        user.roles.length === 0 ? (
          // Not an empty cell: a user with no role is a real problem — they can
          // sign in and reach nothing — so it is called out rather than blank.
          <Badge variant="warning" size="sm">
            No role
          </Badge>
        ) : (
          <div className="flex flex-wrap gap-1">
            {user.roles.map((role) => (
              <Badge key={role.id} variant="neutral" size="sm">
                {roleLabel(role.name)}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (user) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge
            label={user.isActive ? "Active" : "Inactive"}
            variant={user.isActive ? "success" : "neutral"}
          />
          {!user.isVerified && (
            <Badge variant="warning" size="sm">
              Unverified
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "lastLoginAt",
      header: "Last seen",
      render: (user) => (
        <span className="text-muted-foreground">
          {user.lastLoginAt ? formatRelative(user.lastLoginAt) : "Never"}
        </span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (user) => (
        <EntityRowActions
          entityLabel="User"
          recordName={user.fullName}
          editFields={editFields}
          editValues={{
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone ?? "",
            isActive: user.isActive,
          }}
          onUpdate={updateUserAction.bind(null, user.id)}
          onDelete={deleteUserAction.bind(null, user.id)}
          deleteWarning={`"${user.fullName}" will be permanently removed, along with every role they hold. Deactivate instead to block sign-in but keep the record.`}
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar
        search={<ListSearch placeholder="Search by name, email or role…" />}
        filters={
          <>
            <ListFilter
              paramKey="roleId"
              label="Role"
              hideLabel
              allLabel="All roles"
              options={roleOptions}
            />
            <ListFilter
              paramKey="isActive"
              label="Status"
              hideLabel
              allLabel="All statuses"
              options={[
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" },
              ]}
            />
          </>
        }
      />

      <Card noPadding>
        <Table
          columns={columns}
          data={items}
          rowKey={(user) => user.id}
          emptyState={
            <EmptyState
              icon={<UsersIcon />}
              title={hasFilters ? "No matching users" : "No users yet"}
              description={
                hasFilters
                  ? "No user matches these filters."
                  : "Invite the first user to give someone access."
              }
            />
          }
        />
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/users"
            searchParams={{
              ...(q ? { q } : {}),
              ...(roleId ? { roleId } : {}),
              ...(isActive ? { isActive } : {}),
            }}
          />
          <p className="text-xs text-muted-foreground">
            Showing {items.length} of {pagination.total} users
          </p>
        </div>
      )}
    </>
  );
}
