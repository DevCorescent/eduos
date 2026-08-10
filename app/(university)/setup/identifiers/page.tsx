import type { Metadata } from "next";
import { Hash } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listIdSequences, type IdSequenceRow } from "@/services/identifiers";
import {
  createIdSequenceAction,
  updateIdSequenceAction,
} from "@/actions/identifiers";
import { IDENTIFIER_ENTITIES } from "@/lib/services/identifier.service";
import { SequenceReset } from "@/app/generated/prisma/enums";
import { enumOptions } from "@/constants/enumOptions";
import { formatNumber } from "@/utils/format";
import { SequencePreview } from "./SequencePreview";

export const metadata: Metadata = { title: "Identifier Sequences" };

/**
 * PRD §9 — how this university numbers its records.
 *
 * WHAT AN ADMINISTRATOR CAN AND CANNOT DO HERE, AND WHY
 *   They can change a format, a prefix, the padding and the reset cycle, and
 *   they can retire a sequence. They CANNOT move the counter, change which
 *   entity a sequence belongs to, or delete one.
 *
 *   Those three are withheld deliberately rather than by oversight. The counter
 *   is the only field on this table whose change can corrupt records that have
 *   already left the institution: rewinding it reissues numbers already printed
 *   on certificates and quoted in transcripts. Deleting a sequence loses the
 *   counter, and a sequence recreated at zero does the same thing indirectly —
 *   which is what `isActive` exists for instead.
 *
 * ENTITY LABELS RATHER THAN ENUM VALUES
 *   The enum is SCREAMING_CASE and this screen is read by a registrar, not a
 *   developer.
 */
const ENTITY_LABELS: Record<string, string> = {
  STUDENT: "Student enrolment number",
  FACULTY: "Faculty employee ID",
  EMPLOYEE: "Employee ID",
  CERTIFICATE: "Certificate number",
};

/** The fields shared by create and edit. Entity and scope are create-only. */
const FORMAT_FIELDS: FormField[] = [
  {
    name: "prefix",
    label: "Prefix",
    kind: "text",
    maxLength: 24,
    helperText: 'Rendered wherever the format contains {PREFIX}. For example "STU-".',
  },
  {
    name: "format",
    label: "Format",
    kind: "text",
    required: true,
    maxLength: 120,
    helperText:
      "Must contain {SEQ}. Also available: {PREFIX} {SUFFIX} {YEAR} {YY} {MONTH} {UNIV} {CAMPUS} {DEPT} {PROGRAMME} {COURSE} {BATCH} {ADMYEAR} {ROLE}",
  },
  {
    name: "padding",
    label: "Sequence width",
    kind: "number",
    required: true,
    min: 0,
    max: 12,
    helperText:
      "Zeros the counter is padded to. A number that outgrows its width is never truncated — it simply gets longer.",
  },
  {
    name: "resetCycle",
    label: "Reset the counter",
    kind: "select",
    required: true,
    options: enumOptions(SequenceReset),
    helperText:
      "Semesterly splits the year at July. Never keeps one continuous series.",
  },
  {
    name: "suffix",
    label: "Suffix",
    kind: "text",
    maxLength: 24,
    helperText: "Appended at the end unless the format places {SUFFIX} itself.",
  },
  { name: "isActive", label: "Issuing", kind: "switch" },
];

export default async function IdentifierSequencesPage() {
  const result = await listIdSequences();

  const header = (
    <PageHeader
      title="Identifier Sequences"
      subtitle="How this university numbers students, staff and certificates."
      action={
        <EntityCreateButton
          entityLabel="Sequence"
          label="Add sequence"
          fields={[
            {
              name: "entityType",
              label: "Applies to",
              kind: "select",
              required: true,
              options: IDENTIFIER_ENTITIES.map((value) => ({
                value,
                label: ENTITY_LABELS[value] ?? value,
              })),
              helperText: "Cannot be changed afterwards — it identifies the counter.",
            },
            {
              name: "scopeKey",
              label: "Scope",
              kind: "text",
              maxLength: 64,
              helperText:
                "Leave empty for one counter across the university. A campus or programme id gives that campus or programme its own series (PRD §9.3).",
            },
            ...FORMAT_FIELDS,
          ]}
          initialValues={{
            entityType: "",
            scopeKey: "",
            prefix: "",
            format: "{PREFIX}{YEAR}{SEQ}",
            padding: 4,
            resetCycle: SequenceReset.YEARLY,
            suffix: "",
            isActive: true,
          }}
          action={createIdSequenceAction}
          modalSize="lg"
        />
      }
    />
  );

  const failureHeader = (
    <PageHeader
      title="Identifier Sequences"
      subtitle="How this university numbers students, staff and certificates."
    />
  );

  if (!result.success) {
    return (
      <>
        {failureHeader}
        <StateView
          state={resolveFailureState(result)}
          subject="identifier sequences"
          message={result.error}
        />
      </>
    );
  }

  const { sequences } = result.data;

  const columns: TableColumn<IdSequenceRow>[] = [
    {
      key: "entityType",
      header: "Applies to",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">
            {ENTITY_LABELS[row.entityType] ?? row.entityType}
          </p>
          {row.scopeKey !== "" && (
            <p className="truncate font-mono text-xs text-muted-foreground">
              scope {row.scopeKey}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "format",
      header: "Format",
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.format}</span>
      ),
    },
    {
      key: "preview",
      header: "Next identifier",
      // Rendered by its own client island so the reader can refresh it without
      // reloading the page — and, importantly, WITHOUT issuing a number.
      render: (row) => (
        <SequencePreview entityType={row.entityType} scopeKey={row.scopeKey} />
      ),
    },
    {
      key: "lastSequence",
      header: "Issued",
      align: "right",
      render: (row) => (
        <span title="The last number this sequence issued.">
          {formatNumber(row.lastSequence)}
        </span>
      ),
    },
    {
      key: "resetCycle",
      header: "Resets",
      render: (row) => (
        <span className="text-sm text-muted-foreground">{row.resetCycle}</span>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (row) => (
        <Badge variant={row.isActive ? "success" : "neutral"} size="sm">
          {row.isActive ? "Issuing" : "Retired"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <EntityRowActions
          entityLabel="Sequence"
          recordName={ENTITY_LABELS[row.entityType] ?? row.entityType}
          editFields={FORMAT_FIELDS}
          editValues={{
            prefix: row.prefix ?? "",
            format: row.format,
            padding: row.padding,
            resetCycle: row.resetCycle,
            suffix: row.suffix ?? "",
            isActive: row.isActive,
          }}
          onUpdate={updateIdSequenceAction.bind(null, row.id)}
          modalSize="lg"
        />
      ),
    },
  ];

  return (
    <>
      {header}

      {/* Stated once, prominently, because it is the one non-obvious property
          of this screen and the one whose absence would surprise somebody. */}
      <Alert variant="info" className="mb-6">
        <p className="font-medium">A counter can move forward, never back.</p>
        <p className="mt-1 text-sm">
          Editing a sequence changes how future identifiers are written. It never
          renumbers records already issued, and the counter itself cannot be reset from
          this screen — numbers already printed on certificates and transcripts must stay
          unique. Retire a sequence to stop it issuing without losing its position.
        </p>
      </Alert>

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[56rem]"
          columns={columns}
          data={sequences}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<Hash />}
              title="No sequences configured"
              description="Until a sequence exists, enrolment numbers, employee IDs and certificate numbers must be typed in by hand when a record is created."
            />
          }
        />
      </Card>
    </>
  );
}
