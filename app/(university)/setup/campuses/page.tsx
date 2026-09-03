import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listCampuses } from "@/services/setup";
import {
  createCampusAction,
  deleteCampusAction,
  updateCampusAction,
} from "@/actions/setup";
import type { Campus } from "@/types";

export const metadata: Metadata = { title: "Campuses" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{ q?: string; page?: string }>;

/**
 * Field list for both create and edit.
 *
 * Declared once at module scope: the two dialogs must accept exactly the same
 * columns, and keeping separate lists is how an edit form quietly loses a field
 * that create still writes.
 */
const FIELDS: FormField[] = [
  { kind: "text", name: "name", label: "Campus name", required: true, placeholder: "Jaipur Main Campus" },
  {
    kind: "text",
    name: "code",
    label: "Code",
    required: true,
    placeholder: "JPR",
    helperText: "Short unique identifier used in generated IDs.",
  },
  // kind "tel", not "text" — tester issue #18. This validates against the one
  // shared phone rule before the form is sent, and the API applies the same
  // rule so a direct request cannot get past it either.
  { kind: "tel", name: "phone", label: "Phone", placeholder: "+91 141 4000 100" },
  { kind: "email", name: "email", label: "Email", placeholder: "campus@university.edu" },
  {
    kind: "switch",
    name: "isMain",
    label: "Main campus",
    helperText: "The primary campus for this institution.",
  },
];

const EMPTY: Record<string, string | boolean> = {
  name: "",
  code: "",
  phone: "",
  email: "",
  isMain: false,
};

export default async function CampusesPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const result = await listCampuses({ page: currentPage, limit: PAGE_SIZE, q });

  const header = (
    <PageHeader
      title="Campuses"
      subtitle="Physical locations this institution operates from."
      action={
        <EntityCreateButton
          entityLabel="Campus"
          fields={FIELDS}
          initialValues={EMPTY}
          action={createCampusAction}
        />
      }
    />
  );

  /**
   * The same header with its create/manage controls withheld.
   *
   * Rendered when the list request itself failed. A 403 there means this role
   * has no access to the collection at all, so an "Invite user" button beside
   * the refusal would offer an action the backend will reject — the control
   * would be a claim the API does not honour.
   */
  const failureHeader = (
    <PageHeader title="Campuses" subtitle="Physical locations this institution operates from." />
  );

  if (!result.success) {
    return (
      <>
        {failureHeader}
        <StateView
          state={resolveFailureState(result)}
          subject="campuses"
          message={result.error}
        />
      </>
    );
  }

  const { items, pagination } = result.data;

  const columns: TableColumn<Campus>[] = [
    {
      key: "name",
      header: "Campus",
      render: (campus) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{campus.name}</span>
          {campus.isMain && (
            <Badge variant="info" size="sm">
              Main
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "code",
      header: "Code",
      render: (campus) => <span className="font-mono text-xs">{campus.code}</span>,
    },
    {
      key: "email",
      header: "Email",
      render: (campus) => <span className="text-muted-foreground">{campus.email ?? "—"}</span>,
    },
    {
      key: "phone",
      header: "Phone",
      render: (campus) => <span className="text-muted-foreground">{campus.phone ?? "—"}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (campus) => (
        <EntityRowActions
          entityLabel="Campus"
          recordName={campus.name}
          editFields={FIELDS}
          editValues={{
            name: campus.name,
            code: campus.code,
            phone: campus.phone ?? "",
            email: campus.email ?? "",
            isMain: campus.isMain,
          }}
          // Bound on the server, so the row's id is never a value the browser
          // can change before the action runs.
          onUpdate={updateCampusAction.bind(null, campus.id)}
          onDelete={deleteCampusAction.bind(null, campus.id)}
          deleteWarning={`"${campus.name}" will be permanently removed. Campuses with schools or departments cannot be deleted.`}
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar search={<ListSearch placeholder="Search campuses…" />} />

      <Card noPadding>
        <Table
          columns={columns}
          data={items}
          rowKey={(campus) => campus.id}
          emptyState={
            <EmptyState
              icon={<Building2 />}
              title={q ? "No matching campuses" : "No campuses yet"}
              description={
                q
                  ? "No campus matches that search."
                  : "Add the first campus to start building the academic structure."
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
            basePath="/setup/campuses"
            searchParams={q ? { q } : {}}
          />
        </div>
      )}
    </>
  );
}
