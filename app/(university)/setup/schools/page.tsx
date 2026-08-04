import type { Metadata } from "next";
import { School as SchoolIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listCampuses, listSchools } from "@/services/setup";
import { createSchoolAction, deleteSchoolAction, updateSchoolAction } from "@/actions/setup";
import type { School } from "@/types";

export const metadata: Metadata = { title: "Schools" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{ q?: string; campusId?: string; page?: string }>;

export default async function SchoolsPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, campusId, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  // The campus list is needed twice — for the filter and for the form's parent
  // selector — so both come from one call rather than two. limit is the API's
  // maximum; a tenant with more than 100 campuses would need a lookup endpoint
  // rather than a bigger page.
  const [result, campusesResult] = await Promise.all([
    listSchools({ page: currentPage, limit: PAGE_SIZE, q, campusId }),
    listCampuses({ page: 1, limit: 100 }),
  ]);

  const campuses = campusesResult.success ? campusesResult.data.items : [];
  const campusOptions = campuses.map((campus) => ({ value: campus.id, label: campus.name }));
  const campusNameById = new Map(campuses.map((campus) => [campus.id, campus.name]));

  const fields: FormField[] = [
    {
      kind: "select",
      name: "campusId",
      label: "Campus",
      required: true,
      options: campusOptions,
      placeholder: "Select a campus",
      helperText: "The campus this school belongs to.",
    },
    { kind: "text", name: "name", label: "School name", required: true, placeholder: "School of Engineering" },
    { kind: "text", name: "code", label: "Code", required: true, placeholder: "SOET" },
    { kind: "text", name: "deanName", label: "Dean", placeholder: "Dr. Anil Kapoor" },
    { kind: "email", name: "email", label: "Email", placeholder: "soet@university.edu" },
  ];

  const emptyValues = {
    // Pre-selected when the user is already filtering by a campus — they have
    // said which one they mean, so asking again is friction.
    campusId: campusId ?? "",
    name: "",
    code: "",
    deanName: "",
    email: "",
  };

  const header = (
    <PageHeader
      title="Schools"
      subtitle="Faculties and schools within each campus."
      action={
        <EntityCreateButton
          entityLabel="School"
          fields={fields}
          initialValues={emptyValues}
          action={createSchoolAction}
        />
      }
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load schools" description={result.error} />
      </>
    );
  }

  const { items, pagination } = result.data;

  const columns: TableColumn<School>[] = [
    {
      key: "name",
      header: "School",
      render: (school) => <span className="font-medium text-foreground">{school.name}</span>,
    },
    {
      key: "code",
      header: "Code",
      render: (school) => <span className="font-mono text-xs">{school.code}</span>,
    },
    {
      key: "campusId",
      header: "Campus",
      render: (school) => (
        <span className="text-muted-foreground">
          {campusNameById.get(school.campusId) ?? "—"}
        </span>
      ),
    },
    {
      key: "deanName",
      header: "Dean",
      render: (school) => <span className="text-muted-foreground">{school.deanName ?? "—"}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (school) => (
        <EntityRowActions
          entityLabel="School"
          recordName={school.name}
          editFields={fields}
          editValues={{
            campusId: school.campusId,
            name: school.name,
            code: school.code,
            deanName: school.deanName ?? "",
            email: school.email ?? "",
          }}
          onUpdate={updateSchoolAction.bind(null, school.id)}
          onDelete={deleteSchoolAction.bind(null, school.id)}
          deleteWarning={`"${school.name}" will be permanently removed. Schools with departments cannot be deleted.`}
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar
        search={<ListSearch placeholder="Search schools…" />}
        filters={
          <ListFilter
            paramKey="campusId"
            label="Campus"
            hideLabel
            allLabel="All campuses"
            options={campusOptions}
          />
        }
      />

      <Card noPadding>
        <Table
          columns={columns}
          data={items}
          rowKey={(school) => school.id}
          emptyState={
            <EmptyState
              icon={<SchoolIcon />}
              title={q || campusId ? "No matching schools" : "No schools yet"}
              description={
                q || campusId
                  ? "No school matches these filters."
                  : "Add a school to group departments under a campus."
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
            basePath="/setup/schools"
            searchParams={{ ...(q ? { q } : {}), ...(campusId ? { campusId } : {}) }}
          />
        </div>
      )}
    </>
  );
}
