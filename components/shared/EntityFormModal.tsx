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
import type { FormEvent, ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import type { ApiResponse } from "@/types";

/** A form value, before it is coerced to the shape the service expects. */
export type FieldValue = string | number | boolean;

export type FormValues = Record<string, FieldValue>;

interface BaseField {
  name: string;
  label: string;
  required?: boolean;
  helperText?: string;
  /** Hidden and skipped by validation when this returns false. */
  visibleWhen?: (values: FormValues) => boolean;
}

export type FormField =
  | (BaseField & { kind: "text"; placeholder?: string; maxLength?: number })
  | (BaseField & { kind: "textarea"; placeholder?: string; rows?: number })
  | (BaseField & { kind: "number"; min?: number; max?: number })
  | (BaseField & { kind: "date" })
  | (BaseField & { kind: "email"; placeholder?: string })
  // Renders as a telephone input and is validated against the one shared phone
  // rule. Added for tester issue #18: the Add Campus form had no way to check a
  // number before sending it, and the API answers a rejection with a generic
  // "Invalid input" whose `details` never reach the client, so nothing could be
  // put beside the field. Declared as a kind rather than a per-field callback,
  // because that is exactly how "email" already works here.
  | (BaseField & { kind: "tel"; placeholder?: string })
  | (BaseField & { kind: "select"; options: SelectOption[]; placeholder?: string })
  | (BaseField & { kind: "switch" });

export interface EntityFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  fields: FormField[];
  /** Starting values. Empty for a create, the current row for an edit. */
  initialValues: FormValues;
  /** Label for the confirm button. @default "Save" */
  submitLabel?: string;
  size?: "sm" | "md" | "lg";
  /**
   * Performs the write. Returning a failure envelope with a CONFLICT code and
   * a `field` puts the message on that field rather than in the banner.
   */
  onSubmit: (values: FormValues) => Promise<ApiResponse<unknown> & { field?: string }>;
  /** Runs after a successful write, before the modal closes. */
  onSuccess?: () => void;
  /** Extra content below the generated fields. */
  children?: ReactNode;
}

/**
 * A modal form generated from a field list.
 *
 * Eight Setup screens need the same create-and-edit dialog over different
 * columns. Writing eight of them would mean eight copies of the same
 * validation, error-clearing, submit and reset logic — and in practice they
 * drift, so one form ends up clearing errors on change and another does not.
 *
 * Fields are declared as data rather than composed as children because the
 * component has to *read* them: required-field validation, resetting on open,
 * and conditional visibility all need the list, and children are opaque.
 *
 * Values are held as a flat `Record<string, FieldValue>` and coerced at the
 * boundary by the caller's onSubmit. Making this generic over the entity would
 * push a type parameter through every field variant for no real safety —
 * `values` would still need narrowing before it matched a service input.
 *
 * @example
 * ```tsx
 * <EntityFormModal
 *   isOpen={modal.isOpen}
 *   onClose={modal.close}
 *   title="Add campus"
 *   fields={[
 *     { kind: "text", name: "name", label: "Name", required: true },
 *     { kind: "text", name: "code", label: "Code", required: true },
 *     { kind: "switch", name: "isMain", label: "Main campus" },
 *   ]}
 *   initialValues={{ name: "", code: "", isMain: false }}
 *   onSubmit={(v) => createCampusAction(v)}
 * />
 * ```
 */
export function EntityFormModal({
  isOpen,
  onClose,
  title,
  description,
  fields,
  initialValues,
  submitLabel = "Save",
  size = "md",
  onSubmit,
  onSuccess,
  children,
}: EntityFormModalProps) {
  // Seeded once, on mount.
  //
  // Callers mount this only while the dialog is open (see EntityCrud), so
  // closing and reopening remounts it and the values reseed for free. The
  // alternative — keeping it mounted and resetting from an effect on `isOpen` —
  // is the pattern React explicitly warns against: it renders once with the
  // previous row's values before the effect corrects them, which is visible as
  // a flash of the wrong record when editing a second row.
  const [values, setValues] = useState<FormValues>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const visibleFields = fields.filter((field) => !field.visibleWhen || field.visibleWhen(values));

  function setValue(name: string, value: FieldValue) {
    setValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};

    for (const field of visibleFields) {
      const value = values[field.name];

      // A switch is never "missing" — false is a real answer, so `required` on
      // a boolean would make it impossible to say no.
      if (field.required && field.kind !== "switch") {
        const isEmpty = value === undefined || value === null || String(value).trim() === "";
        if (isEmpty) {
          errors[field.name] = `${field.label} is required.`;
          continue;
        }
      }

      if (field.kind === "email" && String(value ?? "").trim()) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())) {
          errors[field.name] = "Enter a valid email address.";
        }
      }

      // Optional, but validated when supplied — the same shape as email above.
      // The rule is imported, not restated, so this cannot drift from what the
      // API will accept.
      if (field.kind === "tel" && String(value ?? "").trim()) {
        const phone = String(value).trim();
        const digits = phoneDigits(phone);

        if (!PHONE_SHAPE.test(phone)) {
          errors[field.name] = PHONE_SHAPE_MESSAGE;
        } else if (digits < PHONE_MIN_DIGITS || digits > PHONE_MAX_DIGITS) {
          errors[field.name] = PHONE_LENGTH_MESSAGE;
        }
      }

      if (field.kind === "number" && String(value ?? "").trim()) {
        const numeric = Number(value);
        if (Number.isNaN(numeric)) {
          errors[field.name] = "Enter a number.";
        } else if (field.min !== undefined && numeric < field.min) {
          errors[field.name] = `Must be at least ${field.min}.`;
        } else if (field.max !== undefined && numeric > field.max) {
          errors[field.name] = `Must be at most ${field.max}.`;
        }
      }
    }

    return errors;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);

    // Only visible fields are submitted: a field hidden by visibleWhen is not
    // part of what the user filled in, and sending its stale value would write
    // something they never chose.
    const payload: FormValues = {};
    for (const field of visibleFields) payload[field.name] = values[field.name];

    const result = await onSubmit(payload);
    setIsSubmitting(false);

    if (!result.success) {
      // A conflict belongs on the field the user has to change — a duplicate
      // code is fixed by editing the code, not by reading a banner.
      if (result.field) {
        setFieldErrors({ [result.field]: result.error });
      } else {
        setFormError(result.error);
      }
      return;
    }

    onSuccess?.();
    onClose();
  }

  const formId = `entity-form-${title.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          {/* The footer sits outside <form>, so the button reaches it by id. */}
          <Button type="submit" form={formId} isLoading={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      }
    >
      {formError && (
        <Alert variant="error" className="mb-4">
          {formError}
        </Alert>
      )}

      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {visibleFields.map((field, index) => {
          const error = fieldErrors[field.name];
          const raw = values[field.name];

          switch (field.kind) {
            case "switch":
              return (
                <Switch
                  key={field.name}
                  label={field.label}
                  helperText={field.helperText}
                  error={error}
                  checked={Boolean(raw)}
                  onChange={(e) => setValue(field.name, e.target.checked)}
                />
              );

            case "select":
              return (
                <Select
                  key={field.name}
                  label={field.label}
                  required={field.required}
                  helperText={field.helperText}
                  error={error}
                  placeholder={field.placeholder}
                  value={String(raw ?? "")}
                  onChange={(value) => setValue(field.name, value)}
                  options={field.options}
                />
              );

            case "textarea":
              return (
                <Textarea
                  key={field.name}
                  label={field.label}
                  required={field.required}
                  helperText={field.helperText}
                  error={error}
                  placeholder={field.placeholder}
                  rows={field.rows ?? 3}
                  value={String(raw ?? "")}
                  onChange={(e) => setValue(field.name, e.target.value)}
                />
              );

            default:
              return (
                <Input
                  key={field.name}
                  label={field.label}
                  required={field.required}
                  helperText={field.helperText}
                  error={error}
                  type={
                    field.kind === "number"
                      ? "number"
                      : field.kind === "date"
                        ? "date"
                        : field.kind === "tel"
                        ? "tel"
                        : field.kind === "email"
                          ? "email"
                          : "text"
                  }
                  placeholder={"placeholder" in field ? field.placeholder : undefined}
                  maxLength={field.kind === "text" ? field.maxLength : undefined}
                  min={field.kind === "number" ? field.min : undefined}
                  max={field.kind === "number" ? field.max : undefined}
                  value={String(raw ?? "")}
                  onChange={(e) => setValue(field.name, e.target.value)}
                  // Focus the first field so the dialog is usable from the
                  // keyboard without reaching for the mouse.
                  autoFocus={index === 0}
                />
              );
          }
        })}

        {children}
      </form>
    </Modal>
  );
}
