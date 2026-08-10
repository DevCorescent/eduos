"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, GraduationCap } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import {
  advanceMyStage,
  convertMyApplication,
  type AdmissionStageName,
  type Application,
} from "@/services/admissions";
import { TemporaryPasswordDialog } from "@/app/(platform)/platform/users/TemporaryPasswordDialog";

/**
 * The university-side stage and conversion actions (TD-W3-6).
 *
 * Calls the tenant-scoped endpoints, which run the SAME service as the platform
 * surface: the twelve stages, the one-step-only rule and the conversion
 * transaction are unchanged and defined once.
 */
export function TenantApplicationActions({
  application,
  nextStage,
  nextStageLabel,
  programmes,
  batches,
}: {
  application: Application;
  nextStage: AdmissionStageName | null;
  nextStageLabel: string | null;
  programmes: { id: string; code: string; name: string }[];
  batches: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const convert = useDisclosure();

  const [isAdvancing, setIsAdvancing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [programmeId, setProgrammeId] = useState(application.preferences[0]?.programme.id ?? "");
  const [batchId, setBatchId] = useState("");
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);

  const converted = Boolean(application.studentId);
  const canConvert =
    !converted &&
    ["STUDENT_ID_GENERATION", "COURSE_ALLOCATION", "PORTAL_ACTIVATION"].includes(application.stage);

  async function onAdvance() {
    if (!nextStage) return;
    setError(null);
    setIsAdvancing(true);
    const result = await advanceMyStage(application.id, nextStage);
    setIsAdvancing(false);
    if (!result.success) return setError(result.error);
    toast({ variant: "success", title: `Moved to ${nextStageLabel}` });
    router.refresh();
  }

  async function onConvert() {
    setConvertError(null);
    if (!programmeId || !batchId) {
      setConvertError("Choose both a programme and a batch.");
      return;
    }
    setIsConverting(true);
    const result = await convertMyApplication(application.id, { programmeId, batchId });
    setIsConverting(false);
    if (!result.success) return setConvertError(result.error);

    convert.close();
    toast({
      variant: "success",
      title: "Converted to student",
      description: `Enrolment number ${result.data.enrollmentNo}`,
    });
    setCredential({ email: result.data.email, password: result.data.temporaryPassword });
  }

  return (
    <>
      <Card>
        <h2 className="text-sm font-semibold text-heading">Workflow</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          An application advances one stage at a time. Skipping and reversing are not permitted.
        </p>

        {error && (
          <Alert variant="error" className="mt-3">
            {error}
          </Alert>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {nextStage ? (
            <Button onClick={onAdvance} isLoading={isAdvancing} leftIcon={<ArrowRight className="size-4" />}>
              Move to {nextStageLabel}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">This application is at the final stage.</p>
          )}

          {canConvert && (
            <Button
              variant="secondary"
              onClick={convert.open}
              leftIcon={<GraduationCap className="size-4" />}
            >
              Convert to student
            </Button>
          )}
        </div>

        {converted && (
          <Alert variant="success" className="mt-4">
            Converted to a student record. An application can be converted only once.
          </Alert>
        )}
      </Card>

      <Modal
        isOpen={convert.isOpen}
        onClose={convert.close}
        title="Convert to student"
        description="Creates the student profile, enrolment number and sign-in account. This cannot be undone."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={convert.close} disabled={isConverting}>
              Cancel
            </Button>
            <Button onClick={onConvert} isLoading={isConverting}>
              Convert
            </Button>
          </div>
        }
      >
        {convertError && (
          <Alert variant="error" className="mb-4">
            {convertError}
          </Alert>
        )}

        <div className="flex flex-col gap-4">
          <Select
            label="Programme"
            value={programmeId}
            onChange={setProgrammeId}
            placeholder="Select a programme"
            options={programmes.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))}
            helperText="Defaults to the applicant's first preference."
          />
          <Select
            label="Batch"
            value={batchId}
            onChange={setBatchId}
            placeholder="Select a batch"
            options={batches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))}
          />
          <Input label="Email" value={application.email} readOnly helperText="Becomes their sign-in address." />
          <Alert variant="info">
            A temporary password is generated and shown once. They must change it before using the
            portal. Courses, fee plan and mentor are not assigned — those rules are not defined.
          </Alert>
        </div>
      </Modal>

      {credential && (
        <TemporaryPasswordDialog
          isOpen
          email={credential.email}
          password={credential.password}
          onClose={() => {
            setCredential(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
