import type { Metadata } from "next";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import {
  SCHEME_DEFAULTS,
  schemeEditValues,
  schemeFields,
} from "@/components/shared/evaluationSchemeFields";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listGradeScales, listSchemes } from "@/services/evaluation";
import { getPortalSession } from "@/services/session";
import {
  createSchemeAction,
  deleteSchemeAction,
  updateSchemeAction,
} from "@/actions/evaluation";
import { EVALUATION_SCHEME_MANAGE_ROLES } from "@/lib/constants/evaluationScheme";
import { hasAnyRole } from "@/constants/roles";
import type { EvaluationSchemeDTO } from "@/lib/dto/evaluationScheme.dto";
import { EvaluationSchemeStatus } from "@/app/generated/prisma/enums";
import { enumOptions } from "@/constants/enumOptions";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Evaluation Schemes" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{ status?: string; page?: string }>;

/** DRAFT is editable, ACTIVE is in force, ARCHIVED is history. */
function statusVariant(status: EvaluationSchemeDTO["status"]) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "DRAFT") return "warning" as const;
  return "neutral" as const;
}

/**
 * Every evaluation regulation, current and historic.
 *
 * Schemes are VERSIONED rather than edited in place — an active regulation is
 * superseded by a new revision, and `supersededById` records which. The version
 * is therefore shown next to the code on every row: two rows sharing a code are
 * the same regulation at different points in time, not a duplicate.
 */
export default async function EvaluationSchemesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { status, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const session = await getPortalSession();

  // The write half of this screen, gated on the SAME constant every scheme
  // endpoint applies. This portal also admits DEPARTMENT_HOD, CAMPUS_ADMIN and
  // (through EVALUATION_SCHEME_READ_ROLES) anyone who may read a regulation but
  // not amend one, so an ungated control would be a button that always answers
  // 403. This is presentation, never the authorization: POST, PATCH and DELETE
  // each re-apply EVALUATION_SCHEME_MANAGE_ROLES server-side.
  const canManage = hasAnyRole(session?.roles ?? [], EVALUATION_SCHEME_MANAGE_ROLES);

  const [result, gradeScaleResult] = await Promise.all([
    listSchemes({
      page: currentPage,
      limit: PAGE_SIZE,
      status: status as EvaluationSchemeDTO["status"] | undefined,
    }),
    // Only a manager can use them, so a reader pays nothing for the lookup.
    canManage ? listGradeScales() : Promise.resolve(null),
  ]);

  // A scheme cites a grade scale and the field is REQUIRED, so with none on
  // file there is nothing valid to create. The control is withheld and the
  // reason said out loud, rather than opening a dialog whose select is empty.
  const gradeScales =
    gradeScaleResult && gradeScaleResult.success ? gradeScaleResult.data : [];

  const gradeScaleOptions = gradeScales.map((scale) => ({
    value: scale.id,
    // The status is part of the label because a scheme citing a non-ACTIVE
    // scale can be drafted but not activated — better seen when choosing than
    // discovered from a 409 at activation.
    label: `${scale.code} v${scale.version} — ${scale.name} (${scale.status})`,
  }));

  const canCreate = canManage && gradeScaleOptions.length > 0;

  const header = (
    <PageHeader
      title="Evaluation Schemes"
      subtitle="The regulations results are computed against."
      action={
        canCreate ? (
          <EntityCreateButton
            entityLabel="Scheme"
            label="Create scheme"
            fields={schemeFields(gradeScaleOptions, "create")}
            initialValues={{ ...SCHEME_DEFAULTS }}
            action={createSchemeAction}
            modalSize="lg"
          />
        ) : undefined
      }
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="evaluation schemes"
          message={result.error}
        />
      </>
    );
  }

  const { items, pagination } = result.data;

  const columns: TableColumn<EvaluationSchemeDTO>[] = [
    {
      key: "code",
      header: "Scheme",
      render: (scheme) => (
        <Link href={`/evaluation/schemes/${scheme.id}`} className="min-w-0 hover:underline">
          <p className="truncate font-medium text-foreground">{scheme.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {scheme.code} · v{scheme.version}
          </p>
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (scheme) => (
        <Badge variant={statusVariant(scheme.status)} size="sm">
          {scheme.status}
        </Badge>
      ),
    },
    {
      key: "attemptPolicy",
      header: "Attempt policy",
      render: (scheme) => (
        <span className="text-sm text-muted-foreground">{scheme.attemptPolicy}</span>
      ),
    },
    {
      key: "rounding",
      header: "Rounding",
      render: (scheme) => (
        <span className="text-xs text-muted-foreground">
          Marks {scheme.marksRounding} ({scheme.marksPrecision}) · GPA {scheme.gpaRounding} (
          {scheme.gpaPrecision})
        </span>
      ),
    },
    {
      key: "activatedAt",
      header: "In force since",
      render: (scheme) =>
        scheme.activatedAt ? (
          formatDate(scheme.activatedAt)
        ) : (
          // A draft has never been in force. "—" would read as a missing date
          // rather than as a regulation that has not been authorised.
          <span className="text-muted-foreground">Not activated</span>
        ),
    },
    // The actions column exists only for a manager. A reader's table keeps its
    // five columns rather than gaining an empty sixth.
    ...(canManage
      ? ([
          {
            key: "actions",
            header: "",
            align: "right",
            render: (scheme) => (
              <EntityRowActions
                entityLabel="Scheme"
                recordName={`${scheme.code} v${scheme.version}`}
                viewHref={`/evaluation/schemes/${scheme.id}`}
                // Amending and discarding are DRAFT-only: an ACTIVE or ARCHIVED
                // revision is part of the historical record, because results
                // computed under it must stay explicable. The endpoints answer
                // 409, and the row does not offer what cannot succeed —
                // archival is the retirement path, on the detail page.
                editFields={
                  scheme.status === "DRAFT"
                    ? schemeFields(gradeScaleOptions, "edit")
                    : undefined
                }
                editValues={
                  scheme.status === "DRAFT" ? schemeEditValues(scheme) : undefined
                }
                onUpdate={
                  scheme.status === "DRAFT"
                    ? updateSchemeAction.bind(null, scheme.id)
                    : undefined
                }
                onDelete={
                  scheme.status === "DRAFT"
                    ? deleteSchemeAction.bind(null, scheme.id)
                    : undefined
                }
                deleteWarning={`Draft "${scheme.name}" and everything defined under it — components, rules and passing criteria — will be permanently removed. This cannot be undone.`}
                modalSize="lg"
              />
            ),
          },
        ] as TableColumn<EvaluationSchemeDTO>[])
      : []),
  ];

  return (
    <>
      {header}

      {canManage && gradeScaleOptions.length === 0 && (
        // The reason the Create scheme button is absent. Without this the
        // screen looks identical to one where the feature does not exist —
        // which is exactly how this module presented before.
        <Alert variant="info" title="No grade scale on file" className="mb-6">
          A regulation is graded against a grade scale, and this university has
          none. A scheme cannot be created until one exists.
        </Alert>
      )}

      <ListToolbar
        filters={
          <ListFilter
            paramKey="status"
            label="Status"
            hideLabel
            allLabel="All statuses"
            options={enumOptions(EvaluationSchemeStatus)}
          />
        }
      />

      <Card noPadding>
        <Table
          columns={columns}
          data={items}
          rowKey={(scheme) => scheme.id}
          emptyState={
            <EmptyState
              icon={<SlidersHorizontal />}
              title="No schemes"
              description={
                status
                  ? `No scheme is currently ${status.toLowerCase()}.`
                  : "No evaluation regulation has been created yet."
              }
            />
          }
        />
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4 flex justify-center">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/evaluation/schemes"
            searchParams={status ? { status } : {}}
          />
        </div>
      )}
    </>
  );
}
