import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getPlatformSession } from "@/lib/auth/platformSession";
import { listPlatformUsers } from "@/services/platformUsers";
import type { PlatformUser } from "@/types";
import { formatDate } from "@/utils/format";
import { PlatformUserActions } from "./PlatformUserActions";

export const metadata: Metadata = {
  title: "Platform Users",
};

const PAGE_SIZE = 20;

/** searchParams is a Promise in Next.js 16, exactly like params. */
type SearchParams = Promise<{ q?: string; page?: string }>;

/**
 * The platform operator directory (W1.3).
 *
 * A Server Component that reads its search term straight from the URL and
 * fetches on the server, so the first paint already has rows — no spinner and
 * no client effect. The only client boundary is the per-row action group.
 *
 * THE SEARCH BOX HERE IS ENABLED, UNLIKE THE ONE ON /platform/tenants
 *   That is not an inconsistency to tidy up. The tenants route accepts page and
 *   limit only, so its box renders disabled with a note saying why — a search
 *   field that silently returns the unfiltered list is worse than none, because
 *   the reader believes they have searched. This collection's route DOES
 *   implement ?q, over email, firstName and lastName, so the control works.
 *
 * There is no status filter, because there is no ?status parameter on this
 * route. Adding a disabled one would be shape for its own sake: with one role
 * and two statuses, the list is small enough to read.
 */
export default async function PlatformUsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q, page } = await searchParams;

  // Clamped rather than trusted: ?page=0 or ?page=abc arrives from hand-edited
  // URLs and stale links, and a non-positive skip is a database error, not a
  // user-visible empty page.
  const currentPage = Math.max(1, Number(page) || 1);

  // The session is read for one purpose: to know which row is the reader's own,
  // so "Deactivate" is not offered on it. The layout above has already proved
  // this session exists and is an active PLATFORM_ADMIN.
  const [result, session] = await Promise.all([
    listPlatformUsers({ page: currentPage, limit: PAGE_SIZE, q }),
    getPlatformSession(),
  ]);

  const header = (
    <PageHeader
      title="Platform Users"
      subtitle="Operators of the EduOS platform itself. Not university staff."
      action={
        <Link href="/platform/users/new" className={buttonStyles({})}>
          Add operator
        </Link>
      }
    />
  );

  /**
   * The same header with its create control withheld.
   *
   * Rendered when the list request failed. A 403 there means this session has
   * no access to the collection at all, so an "Add operator" button beside the
   * refusal would offer an action the backend will reject — the control would
   * be a claim the API does not honour.
   */
  const failureHeader = (
    <PageHeader
      title="Platform Users"
      subtitle="Operators of the EduOS platform itself. Not university staff."
    />
  );

  if (!result.success) {
    return (
      <>
        {failureHeader}
        <StateView state={resolveFailureState(result)} subject="platform users" message={result.error} />
      </>
    );
  }

  const { items, pagination } = result.data;

  return (
    <>
      {header}

      <ListToolbar
        search={<ListSearch placeholder="Search by name or email…" />}
      />

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[56rem]"
          columns={columns(session?.sub ?? "")}
          data={items}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<ShieldCheck />}
              title={q ? "No matching operators" : "No platform users"}
              description={
                q
                  ? `Nothing matches “${q}”. Search covers name and email address.`
                  : "Add an operator to give somebody access to this console."
              }
            />
          }
        />
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/platform/users"
            searchParams={q ? { q } : {}}
          />
        </div>
      )}
    </>
  );
}

/**
 * Columns, built as a function because the actions cell needs the reader's own
 * id to decide whether to offer "Deactivate".
 */
function columns(currentUserId: string): TableColumn<PlatformUser>[] {
  return [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="min-w-0">
          <Link
            href={`/platform/users/${row.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {row.firstName} {row.lastName}
          </Link>
          {/* Surfaced in the list rather than only on the detail page: an
              operator who has not yet chosen their own password is the state a
              reader most often needs to notice at a glance. */}
          {row.mustChangePassword && (
            <p className="text-xs text-warning-bg-foreground">Temporary password</p>
          )}
        </div>
      ),
    },
    {
      key: "email",
      header: "Email",
      render: (row) => <span className="text-muted-foreground">{row.email}</span>,
    },
    {
      key: "roles",
      header: "Role",
      render: (row) =>
        row.roles.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.roles.map((role) => (
              <Badge key={role} variant="info" withDot={false}>
                {role}
              </Badge>
            ))}
          </div>
        ) : (
          // Not a dash. An operator with no role authenticates and is then
          // refused by every guard, which is a fault worth naming on sight.
          <Badge variant="danger">No role</Badge>
        ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (row) => (
        <StatusBadge
          label={row.isActive ? "Active" : "Inactive"}
          variant={row.isActive ? "success" : "neutral"}
        />
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (row) => <span className="text-muted-foreground">{formatDate(row.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (row) => <PlatformUserActions user={row} currentUserId={currentUserId} />,
    },
  ];
}
