"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Table, type TableColumn } from "@/components/ui/Table";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import { provisionTenantAdmin } from "@/services/tenants";
import type { TenantAdmin } from "@/types";
import { formatDateTime } from "@/utils/format";
import { TemporaryPasswordDialog } from "../../users/TemporaryPasswordDialog";

export interface TenantAdminsPanelProps {
  tenantId: string;
  tenantName: string;
  admins: TenantAdmin[] | null;
  /** The list request's failure message, when it failed. */
  error: string | null;
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
}

const EMPTY_FORM: FormState = { firstName: "", lastName: "", email: "" };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The university's administrators, and the control that adds one.
 *
 * WHY A PANEL RATHER THAN A LINK TO /users
 *   /users is the UNIVERSITY portal's own screen, served from the tenant's
 *   hostname and guarded by requireTenant against the caller's own tenantId. A
 *   platform operator has no tenant session, so they cannot open it — which is
 *   the isolation working, not a gap. This panel reads the same rows through
 *   the platform-guarded route instead.
 *
 * NO EDIT, NO DEACTIVATE, NO PASSWORD RESET HERE
 *   Those are the university's to perform on its own members, through its own
 *   console. The platform's legitimate interest is narrower: give an
 *   institution its first way in, and see whether it has one. Adding a
 *   platform-side "reset this university's admin" control would be a capability
 *   nothing in W1.4 asks for, over accounts the platform does not own.
 */
export function TenantAdminsPanel({
  tenantId,
  tenantName,
  admins,
  error,
}: TenantAdminsPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const modal = useDisclosure();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Held only while the dialog is open, then dropped. Never persisted and never
  // put in the URL — the server keeps nothing but its bcrypt hash.
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  function close() {
    modal.close();
    // Reset on close so reopening starts clean rather than showing the last
    // attempt's values and errors.
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors: Partial<Record<keyof FormState, string>> = {};
    if (!form.firstName.trim()) errors.firstName = "Enter a first name.";
    if (!form.lastName.trim()) errors.lastName = "Enter a last name.";
    if (!form.email.trim()) {
      errors.email = "Enter an email address.";
    } else if (!EMAIL_PATTERN.test(form.email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);
    const result = await provisionTenantAdmin(tenantId, {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim().toLowerCase(),
    });
    setIsSubmitting(false);

    if (!result.success) {
      // Field-level for a duplicate address: the clash is about this input, and
      // a page-level banner would lose which field it concerns.
      if (result.code === "CONFLICT") {
        setFieldErrors({ email: "A user with that email already exists in this university." });
        return;
      }
      setFormError(result.error);
      return;
    }

    toast({ variant: "success", title: "Administrator provisioned" });
    close();
    setCredential({
      email: result.data.admin.email,
      password: result.data.temporaryPassword,
    });
  }

  return (
    <>
      <Card noPadding>
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-heading">Administrators</h2>
            <p className="text-sm text-muted-foreground">
              Users of {tenantName} holding UNIVERSITY_ADMIN.
            </p>
          </div>
          <Button size="sm" onClick={modal.open}>
            Add administrator
          </Button>
        </div>

        {error ? (
          <div className="p-5">
            <StateView state="error" subject="administrators" message={error} />
          </div>
        ) : (
          <Table
            minWidthClassName="min-w-[44rem]"
            columns={columns}
            data={admins ?? []}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState
                icon={<UserCog />}
                title="No administrators"
                // Names the consequence rather than just the absence: this is
                // the state in which nobody can sign in to the university.
                description="Nobody can sign in to this university yet. Add an administrator to give it a way in."
              />
            }
          />
        )}
      </Card>

      <Modal
        isOpen={modal.isOpen}
        onClose={close}
        title="Add a university administrator"
        description={`Created inside ${tenantName} with the UNIVERSITY_ADMIN role. A temporary password is generated and shown once.`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={isSubmitting}>
              Cancel
            </Button>
            {/* Submits the form by id, since the footer sits outside <form>. */}
            <Button type="submit" form="add-tenant-admin-form" isLoading={isSubmitting}>
              Add administrator
            </Button>
          </div>
        }
      >
        {formError && (
          <Alert variant="error" className="mb-4">
            {formError}
          </Alert>
        )}

        <form
          id="add-tenant-admin-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="First name"
              required
              value={form.firstName}
              onChange={(e) => updateField("firstName", e.target.value)}
              error={fieldErrors.firstName}
              autoFocus
            />
            <Input
              label="Last name"
              required
              value={form.lastName}
              onChange={(e) => updateField("lastName", e.target.value)}
              error={fieldErrors.lastName}
            />
          </div>

          <Input
            label="Email"
            type="email"
            required
            value={form.email}
            onChange={(e) => updateField("email", e.target.value)}
            error={fieldErrors.email}
            helperText="The address they sign in with, at this university."
          />
        </form>
      </Modal>

      {credential && (
        <TemporaryPasswordDialog
          isOpen
          email={credential.email}
          password={credential.password}
          onClose={() => {
            setCredential(null);
            // Refreshed only now, so the new row appears once the password has
            // been dismissed deliberately rather than navigated past.
            router.refresh();
          }}
        />
      )}
    </>
  );
}

const columns: TableColumn<TenantAdmin>[] = [
  {
    key: "name",
    header: "Name",
    render: (row) => (
      <div className="min-w-0">
        <p className="font-medium text-foreground">
          {row.firstName} {row.lastName}
        </p>
        {row.mustChangePassword && (
          <p className="text-xs text-warning-bg-foreground">Temporary password</p>
        )}
      </div>
    ),
  },
  {
    key: "email",
    header: "Email",
    render: (row) => <span className="text-muted-foreground">{row.email}</span>,
  },
  {
    key: "isActive",
    header: "Status",
    render: (row) => (
      <StatusBadge
        label={row.isActive ? "Active" : "Inactive"}
        variant={row.isActive ? "success" : "neutral"}
      />
    ),
  },
  {
    key: "lastLoginAt",
    header: "Last sign-in",
    render: (row) => (
      <span className="text-muted-foreground">
        {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "Never"}
      </span>
    ),
  },
];
