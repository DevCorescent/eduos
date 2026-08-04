import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getUser, listRoles } from "@/services/users";
import { formatDateTime, formatRelative } from "@/utils/format";
import { UserRolesPanel } from "./UserRolesPanel";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const result = await getUser(id);
  return {
    title: result.success ? `${result.data.firstName} ${result.data.lastName}` : "User",
  };
}

export default async function UserDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  const [userResult, rolesResult] = await Promise.all([
    getUser(id),
    listRoles({ page: 1, limit: 100 }),
  ]);

  if (!userResult.success) {
    if (userResult.code === "NOT_FOUND") notFound();
    throw new Error(userResult.error);
  }

  const user = userResult.data;
  const fullName = `${user.firstName} ${user.lastName}`;
  const allRoles = rolesResult.success ? rolesResult.data.items : [];

  return (
    <>
      <Link
        href="/users"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to users
      </Link>

      <PageHeader
        title={fullName}
        subtitle={user.email}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge
              label={user.isActive ? "Active" : "Inactive"}
              variant={user.isActive ? "success" : "neutral"}
              size="md"
            />
            {!user.isVerified && <Badge variant="warning">Unverified</Badge>}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-1"
          header={<h2 className="text-sm font-semibold text-heading">Profile</h2>}
        >
          <div className="mb-4 flex items-center gap-3">
            <Avatar name={fullName} src={user.avatarUrl ?? undefined} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{fullName}</p>
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>

          <dl className="flex flex-col">
            <Field label="Phone" value={user.phone ?? "—"} />
            <Field
              label="Last sign-in"
              value={user.lastLoginAt ? formatRelative(user.lastLoginAt) : "Never"}
            />
            <Field label="Verified" value={user.isVerified ? "Yes" : "No"} />
            <Field label="Created" value={formatDateTime(user.createdAt)} />
          </dl>
        </Card>

        <div className="lg:col-span-2">
          {/* Role changes are single-click writes, so they get their own client
              panel rather than an edit dialog — the whole point is that granting
              and revoking should be fast. */}
          <UserRolesPanel
            userId={user.id}
            userName={fullName}
            assignedRoles={user.roles}
            allRoles={allRoles.map((role) => ({ id: role.id, name: role.name }))}
          />
        </div>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-3 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}
