import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listFeeComponents, listFeeStructures } from "@/services/finance";
import { listProgrammes } from "@/services/setup";
import { FEE_TYPE_LABELS } from "@/constants/labels";
import { formatCurrency } from "@/utils/format";
import type { FeeComponent } from "@/types";

export const metadata: Metadata = { title: "Fee Structures" };

type SearchParams = Promise<{ q?: string; structureId?: string }>;

export default async function FeeStructuresPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q, structureId } = await searchParams;

  const [structuresResult, programmesResult] = await Promise.all([
    listFeeStructures({ page: 1, limit: 100, q }),
    listProgrammes({ page: 1, limit: 100 }),
  ]);

  const header = (
    <PageHeader
      title="Fee Structures"
      subtitle="The fee plans demands are generated from."
    />
  );

  if (!structuresResult.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load fee structures" description={structuresResult.error} />
      </>
    );
  }

  const structures = structuresResult.data.items;
  const programmeById = new Map(
    (programmesResult.success ? programmesResult.data.items : []).map((p) => [p.id, p])
  );

  // The structure whose components are expanded below. Defaults to the first,
  // so the page never opens on an empty detail panel.
  const selected = structures.find((s) => s.id === structureId) ?? structures[0];
  const componentsResult = selected ? await listFeeComponents(selected.id) : null;
  const components = componentsResult?.success ? componentsResult.data : [];

  const total = components.reduce((sum, c) => sum + Number(c.amount), 0);

  const componentColumns: TableColumn<FeeComponent>[] = [
    {
      key: "name",
      header: "Component",
      render: (component) => (
        <span className="font-medium text-foreground">{component.name}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (component) => (
        <Badge variant="neutral" size="sm">
          {FEE_TYPE_LABELS[component.type]}
        </Badge>
      ),
    },
    {
      key: "isOptional",
      header: "Required",
      render: (component) =>
        component.isOptional ? (
          <span className="text-muted-foreground">Optional</span>
        ) : (
          <span className="text-foreground">Mandatory</span>
        ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (component) => (
        <span className="font-medium">{formatCurrency(component.amount)}</span>
      ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar search={<ListSearch placeholder="Search fee structures…" />} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-1"
          noPadding
          header={<h2 className="text-sm font-semibold text-heading">Structures</h2>}
        >
          {structures.length === 0 ? (
            <EmptyState
              icon={<Wallet />}
              title={q ? "No matching structures" : "No fee structures"}
              description={
                q
                  ? "No structure matches that search."
                  : "A fee structure defines what a programme costs."
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {structures.map((structure) => {
                const isSelected = structure.id === selected?.id;
                const programme = structure.programmeId
                  ? programmeById.get(structure.programmeId)
                  : undefined;

                return (
                  <li key={structure.id}>
                    {/* A link, not a click handler: the selection lives in the
                        URL so a particular structure can be shared or
                        bookmarked, and the page stays a Server Component. */}
                    <a
                      href={`/finance/fee-structures?structureId=${structure.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                      aria-current={isSelected ? "true" : undefined}
                      className={
                        isSelected
                          ? "block bg-primary-bg px-5 py-3"
                          : "block px-5 py-3 transition-colors hover:bg-muted"
                      }
                    >
                      <p
                        className={
                          isSelected
                            ? "text-sm font-medium text-primary-bg-foreground"
                            : "text-sm font-medium text-foreground"
                        }
                      >
                        {structure.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {programme?.name ?? "All programmes"}
                      </p>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="lg:col-span-2">
          {selected ? (
            <Card
              noPadding
              header={
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-heading">{selected.name}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {components.length} component{components.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <StatusBadge
                    label={selected.isActive ? "Active" : "Inactive"}
                    variant={selected.isActive ? "success" : "neutral"}
                  />
                </div>
              }
              footer={
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium text-heading">Total per semester</span>
                  <span className="text-lg font-semibold text-heading">
                    {formatCurrency(total)}
                  </span>
                </div>
              }
            >
              <Table
                columns={componentColumns}
                data={components}
                rowKey={(component) => component.id}
                emptyState={
                  <EmptyState
                    icon={<Wallet />}
                    title="No components"
                    description="Add a component so this structure has an amount to bill."
                  />
                }
              />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
