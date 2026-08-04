import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Layers } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EntityCreateButton } from "@/components/shared/EntityCrud";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getProgramme, listDepartments, listSpecialisations } from "@/services/setup";
import { createSpecialisationAction } from "@/actions/setup";
import { DURATION_UNIT_LABELS, PROGRAMME_TYPE_LABELS } from "@/constants/labels";
import { formatDate } from "@/utils/format";
import type { Specialisation } from "@/types";

/** params is a Promise in Next.js 16 — await before destructuring. */
type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const result = await getProgramme(id);
  return { title: result.success ? result.data.name : "Programme" };
}

const SPECIALISATION_FIELDS: FormField[] = [
  { kind: "text", name: "name", label: "Specialisation name", required: true, placeholder: "Artificial Intelligence & Machine Learning" },
  { kind: "text", name: "code", label: "Code", required: true, placeholder: "AIML" },
  { kind: "switch", name: "isActive", label: "Accepting intake" },
];

export default async function ProgrammeDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  const [programmeResult, specialisationsResult, departmentsResult] = await Promise.all([
    getProgramme(id),
    listSpecialisations(id, { page: 1, limit: 100 }),
    listDepartments({ page: 1, limit: 100 }),
  ]);

  if (!programmeResult.success) {
    // A missing programme is a 404, not an error page. Conflating the two would
    // tell the user something broke when the record simply is not there.
    if (programmeResult.code === "NOT_FOUND") notFound();
    throw new Error(programmeResult.error);
  }

  const programme = programmeResult.data;
  const department = departmentsResult.success
    ? departmentsResult.data.items.find((d) => d.id === programme.departmentId)
    : undefined;

  const columns: TableColumn<Specialisation>[] = [
    {
      key: "name",
      header: "Specialisation",
      render: (row) => <span className="font-medium text-foreground">{row.name}</span>,
    },
    {
      key: "code",
      header: "Code",
      render: (row) => <span className="font-mono text-xs">{row.code}</span>,
    },
    {
      key: "isActive",
      header: "Status",
      render: (row) => (
        <StatusBadge
          label={row.isActive ? "Active" : "Retired"}
          variant={row.isActive ? "success" : "neutral"}
        />
      ),
    },
    {
      key: "createdAt",
      header: "Added",
      render: (row) => (
        <span className="text-muted-foreground">{formatDate(row.createdAt)}</span>
      ),
    },
  ];

  return (
    <>
      <Link
        href="/setup/programmes"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to programmes
      </Link>

      <PageHeader
        title={programme.name}
        subtitle={programme.code}
        action={
          <StatusBadge
            label={programme.isActive ? "Accepting intake" : "Retired"}
            variant={programme.isActive ? "success" : "neutral"}
            size="md"
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-1"
          header={<h2 className="text-sm font-semibold text-heading">Details</h2>}
        >
          <dl className="flex flex-col">
            <Field label="Type" value={PROGRAMME_TYPE_LABELS[programme.type]} />
            <Field
              label="Duration"
              value={`${programme.durationValue} ${DURATION_UNIT_LABELS[programme.durationUnit].toLowerCase()}`}
            />
            <Field label="Total credits" value={programme.totalCredits ?? "—"} />
            <Field label="Department" value={department?.name ?? "—"} />
            <Field label="Eligibility" value={programme.eligibility ?? "—"} />
            <Field label="Created" value={formatDate(programme.createdAt)} />
          </dl>
        </Card>

        <div className="lg:col-span-2">
          <Card
            noPadding
            header={
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-heading">Specialisations</h2>
                <EntityCreateButton
                  entityLabel="Specialisation"
                  size="sm"
                  fields={SPECIALISATION_FIELDS}
                  initialValues={{ name: "", code: "", isActive: true }}
                  // Bound to this programme on the server: specialisations are
                  // created through /api/programmes/[id]/specialisations, so the
                  // parent is part of the address, not a form field.
                  action={createSpecialisationAction.bind(null, programme.id)}
                />
              </div>
            }
          >
            {!specialisationsResult.success ? (
              <ErrorState
                title="Couldn't load specialisations"
                description={specialisationsResult.error}
                className="border-0 bg-transparent"
              />
            ) : (
              <Table
                columns={columns}
                data={specialisationsResult.data.items}
                rowKey={(row) => row.id}
                emptyState={
                  <EmptyState
                    icon={<Layers />}
                    title="No specialisations"
                    description="Add a specialisation if students can major within this programme."
                  />
                }
              />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/** One label/value row in the details card. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-3 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}
