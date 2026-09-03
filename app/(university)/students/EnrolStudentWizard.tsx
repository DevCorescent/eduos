"use client";

import { useState } from "react";
import {
  PHONE_LENGTH_MESSAGE,
  PHONE_MAX_DIGITS,
  PHONE_MIN_DIGITS,
  PHONE_SHAPE,
  PHONE_SHAPE_MESSAGE,
  phoneDigits,
} from "@/lib/validations/phone";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select, type SelectOption } from "@/components/ui/Select";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import { enrolStudentAction } from "@/actions/students";
import { cn } from "@/lib/utils";

interface WizardValues {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone: string;
  enrollmentNo: string;
  programmeId: string;
  batchId: string;
  currentSemester: string;
  admissionDate: string;
}

const EMPTY: WizardValues = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  phone: "",
  enrollmentNo: "",
  programmeId: "",
  batchId: "",
  currentSemester: "1",
  admissionDate: "",
};

const STEPS = [
  { title: "Basic info", description: "Who the student is" },
  { title: "Academic", description: "Where they are placed" },
  { title: "Review", description: "Confirm and enrol" },
] as const;

type FieldErrors = Partial<Record<keyof WizardValues, string>>;

export interface EnrolStudentWizardProps {
  programmes: SelectOption[];
  batches: SelectOption[];
  /** Pre-selected when the list is already filtered by programme. */
  defaultProgrammeId?: string;
  defaultBatchId?: string;
}

/**
 * Three-step enrolment: basic info → academic placement → review.
 *
 * Stepped rather than one long form because enrolment spans two concerns —
 * a person and their academic placement — and because it performs *two* writes
 * (a User, then a Student). A reviewer needs to see what will be created before
 * either happens.
 *
 * Critically, nothing is submitted until the final step. Each step only
 * validates locally and advances; there are no partial writes, so abandoning
 * the wizard at step 2 leaves no orphaned account behind.
 */
export function EnrolStudentWizard({
  programmes,
  batches,
  defaultProgrammeId,
  defaultBatchId,
}: EnrolStudentWizardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const modal = useDisclosure();

  const [step, setStep] = useState(0);
  const [values, setValues] = useState<WizardValues>({
    ...EMPTY,
    programmeId: defaultProgrammeId ?? "",
    batchId: defaultBatchId ?? "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setValue<K extends keyof WizardValues>(key: K, value: WizardValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }

  function close() {
    modal.close();
    // Reset on close so reopening starts clean rather than mid-wizard with the
    // previous attempt's values.
    setStep(0);
    setValues({ ...EMPTY, programmeId: defaultProgrammeId ?? "", batchId: defaultBatchId ?? "" });
    setFieldErrors({});
    setFormError(null);
  }

  /** Validates only the current step, so step 1 does not complain about step 2. */
  function validateStep(index: number): FieldErrors {
    const errors: FieldErrors = {};

    if (index === 0) {
      if (!values.firstName.trim()) errors.firstName = "Enter a first name.";
      if (!values.lastName.trim()) errors.lastName = "Enter a last name.";
      if (!values.email.trim()) errors.email = "Enter an email address.";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()))
        errors.email = "Enter a valid email address.";
      if (values.password.length < 8) errors.password = "Use at least 8 characters.";

      // Tester issue #24. Optional, but validated when supplied — the same
      // convention the email above follows, and the same rule the API applies,
      // imported rather than restated so the two cannot drift.
      const phone = values.phone.trim();
      if (phone) {
        const digits = phoneDigits(phone);
        if (!PHONE_SHAPE.test(phone)) errors.phone = PHONE_SHAPE_MESSAGE;
        else if (digits < PHONE_MIN_DIGITS || digits > PHONE_MAX_DIGITS) {
          errors.phone = PHONE_LENGTH_MESSAGE;
        }
      }
    }

    if (index === 1) {
      if (!values.enrollmentNo.trim()) errors.enrollmentNo = "Enter an enrolment number.";
      if (!values.admissionDate) errors.admissionDate = "Choose an admission date.";
    }

    return errors;
  }

  function handleNext() {
    const errors = validateStep(step);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFormError(null);
    setStep((current) => current + 1);
  }

  async function handleSubmit() {
    setFormError(null);
    setIsSubmitting(true);

    // One call, on the final step only. The action performs both writes.
    const result = await enrolStudentAction({ ...values });
    setIsSubmitting(false);

    if (!result.success) {
      // A conflict belongs on the field that caused it — and on the step that
      // field lives on, so the user is sent back to fix it rather than left
      // staring at a review screen with an error about an input they cannot see.
      if (result.field) {
        setFieldErrors({ [result.field]: result.error } as FieldErrors);
        setStep(result.field === "enrollmentNo" ? 1 : 0);
        return;
      }
      setFormError(result.error);
      return;
    }

    toast({
      variant: "success",
      title: "Student enrolled",
      description: `${values.firstName} ${values.lastName} — ${values.enrollmentNo}`,
    });
    close();
    router.refresh();
  }

  const programmeLabel =
    programmes.find((p) => p.value === values.programmeId)?.label ?? "Not assigned";
  const batchLabel = batches.find((b) => b.value === values.batchId)?.label ?? "Not assigned";

  return (
    <>
      <Button leftIcon={<Plus className="size-4" />} onClick={modal.open}>
        Enrol student
      </Button>

      {modal.isOpen && (
        <Modal
          isOpen
          onClose={close}
          title="Enrol student"
          description={STEPS[step].description}
          size="lg"
          footer={
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                onClick={() => setStep((current) => current - 1)}
                disabled={step === 0 || isSubmitting}
              >
                Back
              </Button>

              <div className="flex gap-2">
                <Button variant="secondary" onClick={close} disabled={isSubmitting}>
                  Cancel
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button onClick={handleNext}>Continue</Button>
                ) : (
                  <Button
                    onClick={handleSubmit}
                    isLoading={isSubmitting}
                    leftIcon={<Check className="size-4" />}
                  >
                    Enrol student
                  </Button>
                )}
              </div>
            </div>
          }
        >
          {/* Progress. aria-current marks the active step for screen readers,
              which cannot see the colour change. */}
          <ol className="mb-6 flex items-center gap-2">
            {STEPS.map((entry, index) => (
              <li key={entry.title} className="flex flex-1 items-center gap-2">
                <span
                  aria-current={index === step ? "step" : undefined}
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    index < step && "bg-success text-success-foreground",
                    index === step && "bg-primary text-primary-foreground",
                    index > step && "bg-muted text-muted-foreground"
                  )}
                >
                  {index < step ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "hidden text-xs font-medium sm:inline",
                    index === step ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {entry.title}
                </span>
                {index < STEPS.length - 1 && (
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                )}
              </li>
            ))}
          </ol>

          {formError && (
            <Alert variant="error" className="mb-4">
              {formError}
            </Alert>
          )}

          {step === 0 && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="First name"
                  required
                  value={values.firstName}
                  onChange={(e) => setValue("firstName", e.target.value)}
                  error={fieldErrors.firstName}
                  autoFocus
                />
                <Input
                  label="Last name"
                  required
                  value={values.lastName}
                  onChange={(e) => setValue("lastName", e.target.value)}
                  error={fieldErrors.lastName}
                />
              </div>
              <Input
                label="Email"
                type="email"
                required
                value={values.email}
                onChange={(e) => setValue("email", e.target.value)}
                error={fieldErrors.email}
                placeholder="rahul.verma@student.university.edu"
              />
              <Input
                label="Temporary password"
                required
                value={values.password}
                onChange={(e) => setValue("password", e.target.value)}
                error={fieldErrors.password}
                helperText="At least 8 characters. The student changes it after signing in."
              />
              <Input
                label="Phone"
                value={values.phone}
                onChange={(e) => setValue("phone", e.target.value)}
                error={fieldErrors.phone}
                placeholder="+91 98765 43210"
              />
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <Input
                label="Enrolment number"
                required
                value={values.enrollmentNo}
                onChange={(e) => setValue("enrollmentNo", e.target.value)}
                error={fieldErrors.enrollmentNo}
                placeholder="BTCSE/2026/0001"
                helperText="Unique within this university."
                autoFocus
              />
              <Select
                label="Programme"
                value={values.programmeId}
                onChange={(value) => setValue("programmeId", value)}
                placeholder="Select a programme"
                options={programmes}
              />
              <Select
                label="Batch"
                value={values.batchId}
                onChange={(value) => setValue("batchId", value)}
                placeholder="Select a batch"
                options={batches}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Current semester"
                  type="number"
                  min={1}
                  max={12}
                  value={values.currentSemester}
                  onChange={(e) => setValue("currentSemester", e.target.value)}
                />
                <Input
                  label="Admission date"
                  type="date"
                  required
                  value={values.admissionDate}
                  onChange={(e) => setValue("admissionDate", e.target.value)}
                  error={fieldErrors.admissionDate}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <>
              <Alert variant="info" className="mb-4">
                Enrolling creates a sign-in account and a student record together. Nothing has
                been saved yet.
              </Alert>

              <dl className="flex flex-col">
                <ReviewRow label="Name" value={`${values.firstName} ${values.lastName}`} />
                <ReviewRow label="Email" value={values.email} />
                <ReviewRow label="Phone" value={values.phone || "—"} />
                <ReviewRow
                  label="Enrolment number"
                  value={<span className="font-mono text-xs">{values.enrollmentNo}</span>}
                />
                <ReviewRow label="Programme" value={programmeLabel} />
                <ReviewRow label="Batch" value={batchLabel} />
                <ReviewRow label="Current semester" value={values.currentSemester} />
                <ReviewRow label="Admission date" value={values.admissionDate} />
                <ReviewRow label="Status on creation" value="Active" />
              </dl>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2.5 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-sm text-muted-foreground sm:w-44">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}
