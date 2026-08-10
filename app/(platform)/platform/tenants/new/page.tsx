import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProvisionUniversityForm } from "./ProvisionUniversityForm";

export const metadata: Metadata = {
  title: "Provision University",
};

/**
 * Onboard a university (W1.4).
 *
 * A Server Component wrapper with nothing to fetch. The form's only dynamic
 * input would be the list of roles, and there is nothing to choose: the initial
 * administrator of a university is its UNIVERSITY_ADMIN, and the backend uses a
 * constant rather than a value from the request.
 *
 * Reached from the tenants list, which links here instead of opening the modal
 * it used to. The modal is gone rather than kept alongside this page — two
 * create paths for one act is how they drift apart, and only one of them would
 * have gained the administrator section.
 */
export default function NewTenantPage() {
  return (
    <>
      <Link
        href="/platform/tenants"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to universities
      </Link>

      <PageHeader
        title="Provision a university"
        subtitle="Creates the institution, its subscription and its first administrator in one step."
      />

      <ProvisionUniversityForm />
    </>
  );
}
