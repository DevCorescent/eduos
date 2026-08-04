import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { listFeeStructures, currentSemester } from "@/services/finance";
import { listAcademicYears, listBatches, listSemesters } from "@/services/calendar";
import { listProgrammes } from "@/services/setup";
import { GenerateDemandsForm } from "./GenerateDemandsForm";

export const metadata: Metadata = { title: "Generate Fee Demands" };

export default async function GenerateDemandsPage() {
  const [structuresResult, batchesResult, programmesResult, yearsResult] =
    await Promise.all([
      listFeeStructures({ page: 1, limit: 100 }),
      listBatches({ page: 1, limit: 100 }),
      listProgrammes({ page: 1, limit: 100 }),
      listAcademicYears({ page: 1, limit: 100 }),
    ]);

  const currentYear = yearsResult.success
    ? yearsResult.data.items.find((year) => year.isCurrent)
    : undefined;

  // Semesters hang off the current year, so this cannot join the batch above.
  const semestersResult = currentYear
    ? await listSemesters(currentYear.id, { page: 1, limit: 100 })
    : null;

  const header = (
    <>
      <Link
        href="/finance/fee-demands"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the ledger
      </Link>
      <PageHeader
        title="Generate Fee Demands"
        subtitle="Raise a demand for every active student in a batch."
      />
    </>
  );

  if (!structuresResult.success) {
    return (
      <>
        {header}
        <ErrorState
          title="Couldn't load fee structures"
          description={structuresResult.error}
        />
      </>
    );
  }

  const programmeById = new Map(
    (programmesResult.success ? programmesResult.data.items : []).map((p) => [p.id, p])
  );

  // Batches restricted to the current academic year: raising a bill against a
  // closed intake is almost always a mistake, and offering it invites one.
  const batches = (batchesResult.success ? batchesResult.data.items : []).filter(
    (batch) => batch.academicYearId === currentYear?.id
  );

  return (
    <>
      {header}

      <GenerateDemandsForm
        batches={batches.map((batch) => ({
          value: batch.id,
          label: `${batch.name} — ${programmeById.get(batch.programmeId)?.name ?? "—"}`,
        }))}
        semesters={
          semestersResult?.success
            ? semestersResult.data.items.map((s) => ({ value: s.id, label: s.name }))
            : []
        }
        structures={structuresResult.data.items
          .filter((s) => s.isActive)
          .map((s) => ({ value: s.id, label: s.name }))}
        defaultSemesterId={currentSemester().id}
      />
    </>
  );
}
