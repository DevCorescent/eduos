"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/providers/ToastProvider";
import { generateFeeDemandsAction } from "@/actions/finance";

interface Option {
  value: string;
  label: string;
}

export interface GenerateDemandsFormProps {
  batches: Option[];
  semesters: Option[];
  structures: Option[];
  defaultSemesterId: string;
}

/**
 * Raise demands for a batch.
 *
 * A plain form rather than EntityFormModal: this is not a create dialog over a
 * record, it is a bulk operation whose result — how many were raised and how
 * many skipped — is the point, and needs somewhere to be reported.
 */
export function GenerateDemandsForm({
  batches,
  semesters,
  structures,
  defaultSemesterId,
}: GenerateDemandsFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [batchId, setBatchId] = useState("");
  const [semesterId, setSemesterId] = useState(
    semesters.some((s) => s.value === defaultSemesterId) ? defaultSemesterId : ""
  );
  const [structureId, setStructureId] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  const canRun = Boolean(batchId && semesterId && structureId);

  async function handleGenerate() {
    setIsRunning(true);
    setResult(null);

    const response = await generateFeeDemandsAction(batchId, semesterId, structureId);
    setIsRunning(false);

    if (!response.success) {
      toast({ variant: "error", title: "Couldn't generate", description: response.error });
      return;
    }

    const data = response.data as { created: number; skipped: number };
    setResult(data);

    toast({
      variant: "success",
      title: `${data.created} demand${data.created === 1 ? "" : "s"} raised`,
      description: data.skipped > 0 ? `${data.skipped} already billed.` : undefined,
    });

    router.refresh();
  }

  if (batches.length === 0) {
    return (
      <Alert variant="warning" title="No batches in the current academic year">
        Create a batch for the current year before raising fee demands.
      </Alert>
    );
  }

  return (
    <div className="max-w-2xl">
      <Card header={<h2 className="text-sm font-semibold text-heading">Select a target</h2>}>
        <div className="flex flex-col gap-4">
          <Select
            label="Batch"
            required
            value={batchId}
            onChange={setBatchId}
            placeholder="Select a batch"
            options={batches}
            helperText="Every active student in this batch will be billed."
          />

          <Select
            label="Semester"
            required
            value={semesterId}
            onChange={setSemesterId}
            placeholder="Select a semester"
            options={semesters}
          />

          <Select
            label="Fee structure"
            required
            value={structureId}
            onChange={setStructureId}
            placeholder="Select a fee structure"
            options={structures}
            helperText="The total is the sum of the structure's components."
          />
        </div>

        {/* Stated before the run, not after: re-running is safe, and knowing
            that up front is what stops an operator hesitating over whether the
            first attempt worked. */}
        <Alert variant="info" className="mt-6">
          Running this twice is safe. A student who already holds a demand for the same
          semester and structure is skipped rather than billed again.
        </Alert>

        <div className="mt-6 flex justify-end">
          <Button
            onClick={handleGenerate}
            disabled={!canRun}
            isLoading={isRunning}
            leftIcon={<Receipt className="size-4" />}
          >
            Generate demands
          </Button>
        </div>
      </Card>

      {result && (
        <Alert
          variant={result.created > 0 ? "success" : "info"}
          title={
            result.created > 0
              ? `${result.created} demand${result.created === 1 ? "" : "s"} raised`
              : "Nothing new to raise"
          }
          className="mt-6"
        >
          {result.skipped > 0
            ? `${result.skipped} student${result.skipped === 1 ? " already held" : "s already held"} a demand for this semester and structure, and ${result.skipped === 1 ? "was" : "were"} skipped.`
            : "Every active student in this batch has been billed."}
        </Alert>
      )}
    </div>
  );
}
