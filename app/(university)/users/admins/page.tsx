import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listUsers, type UserRow } from "@/services/users";
import { ROLES } from "@/constants/roles";
import { formatDate, formatNumber } from "@/utils/format";

export const metadata: Metadata = { title: "Administrators" };

/**
 * The roles that administer the university, in order of reach.
 *
 * Kept separate from UNIVERSITY_ROLES — that constant answers "who may enter
 * the university portal", which includes the heads of department this screen
 * exists to distinguish FROM the administrators.
 */
const ADMIN_ROLES: readonly string[] = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CAMPUS_ADMIN,
  ROLES.CONTROLLER_OF_EXAMINATION,
  ROLES.HOD,
  ROLES.DEPARTMENT_HOD,
];

/** How many pages of the directory to walk. See the scan note below. */
const SCAN_PAGE_CAP = 10;
const SCAN_PAGE_SIZE = 100;

type SearchParams = Promise<{ role?: string }>;

/**
 * Who administers this university.
 *
 * WHY THIS SCANS RATHER THAN FILTERS
 *   GET /api/users takes page and limit and nothing else — listUsersQuerySchema
 *   defines no ?role. So the directory is walked and filtered here. That is
 *   bounded work: SCAN_PAGE_CAP pages of 100, and administrators are a small
 *   set within any tenant.
 *
 *   A tenant larger than the cap gets a banner saying the list is partial,
 *   rather than a silently truncated roster. Someone checking who holds
 *   administrative access must not be shown an incomplete answer that looks
 *   complete.
 */
export default async function AdministratorsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { role } = await searchParams;

  const rows: UserRow[] = [];
  let scanFailed: string | null = null;
  let truncated = false;

  for (let page = 1; page <= SCAN_PAGE_CAP; page++) {
    const result = await listUsers({ page, limit: SCAN_PAGE_SIZE });

    if (!result.success) {
      scanFailed = result.error;
      break;
    }

    rows.push(...result.data.items);

    if (page >= result.data.pagination.totalPages) break;
    if (page === SCAN_PAGE_CAP) truncated = true;
  }

  const header = (
    <PageHeader
      title="Administrators"
      subtitle="Everyone holding administrative access to this university."
      action={
        <Link
          href="/users"
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          Full directory
        </Link>
      }
    />
  );

  if (scanFailed !== null) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load the directory" description={scanFailed} />
      </>
    );
  }

  const admins = rows.filter((user) =>
    user.roles.some((granted) =>
      role ? granted.name === role : ADMIN_ROLES.includes(granted.name)
    )
  );

  const countByRole = new Map<string, number>();
  for (const user of admins) {
    for (const granted of user.roles) {
      if (!ADMIN_ROLES.includes(granted.name)) continue;
      countByRole.set(granted.name, (countByRole.get(granted.name) ?? 0) + 1);
    }
  }

  const columns: TableColumn<UserRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (user) => (
        <Link href={`/users/${user.id}`} className="min-w-0 hover:underline">
          <p className="truncate font-medium text-foreground">{user.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </Link>
      ),
    },
    {
      key: "roles",
      header: "Roles",
      render: (user) => (
        <div className="flex flex-wrap gap-1">
          {user.roles.map((granted) => (
            <Badge
              key={granted.id}
              variant={ADMIN_ROLES.includes(granted.name) ? "info" : "neutral"}
              size="sm"
            >
              {granted.name}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (user) => (
        <Badge variant={user.isActive ? "success" : "neutral"} size="sm">
          {user.isActive ? "Active" : "Disabled"}
        </Badge>
      ),
    },
    {
      key: "lastLoginAt",
      header: "Last signed in",
      render: (user) =>
        // Never-signed-in is not "no date" — it is an administrator who has an
        // account and has not used it, which is worth seeing plainly.
        user.lastLoginAt ? (
          formatDate(user.lastLoginAt)
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
  ];

  return (
    <>
      {header}

      {truncated && (
        <Alert variant="warning" className="mb-4">
          This directory is larger than {formatNumber(SCAN_PAGE_CAP * SCAN_PAGE_SIZE)} users,
          so the list below covers only the first {formatNumber(SCAN_PAGE_CAP)} pages. Use the
          full directory to search beyond it.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Administrators" value={formatNumber(admins.length)} />
        <StatCard
          label="University admins"
          value={formatNumber(countByRole.get(ROLES.UNIVERSITY_ADMIN) ?? 0)}
        />
        <StatCard
          label="Campus admins"
          value={formatNumber(countByRole.get(ROLES.CAMPUS_ADMIN) ?? 0)}
        />
        <StatCard
          label="Heads of department"
          value={formatNumber(
            (countByRole.get(ROLES.HOD) ?? 0) + (countByRole.get(ROLES.DEPARTMENT_HOD) ?? 0)
          )}
        />
      </div>

      <div className="mt-6">
        <ListToolbar
          filters={
            <ListFilter
              paramKey="role"
              label="Role"
              hideLabel
              allLabel="All administrative roles"
              options={ADMIN_ROLES.map((value) => ({ value, label: value }))}
            />
          }
        />
      </div>

      <Card noPadding>
        <Table
          columns={columns}
          data={admins}
          rowKey={(user) => user.id}
          emptyState={
            <EmptyState
              icon={<ShieldCheck />}
              title="No administrators"
              description={
                role
                  ? `Nobody currently holds the ${role} role.`
                  : "Nobody holds an administrative role in this university yet."
              }
            />
          }
        />
      </Card>
    </>
  );
}
