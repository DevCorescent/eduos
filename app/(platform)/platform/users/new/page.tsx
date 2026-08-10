import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { NewPlatformUserForm } from "./NewPlatformUserForm";

export const metadata: Metadata = {
  title: "Add Platform User",
};

/**
 * Create a platform operator (W1.3).
 *
 * A Server Component wrapper with nothing to fetch: the only dynamic input the
 * form needs is the role list, and that is a single constant rather than a
 * round trip — PlatformRole holds one row and the API's schema accepts one
 * name. Fetching a one-element list to discover what the enum already states
 * would add a request that cannot return anything else.
 */
export default function NewPlatformUserPage() {
  return (
    <>
      <Link
        href="/platform/users"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to platform users
      </Link>

      <PageHeader
        title="Add operator"
        subtitle="Gives somebody access to the EduOS platform console. This is not a university account."
      />

      <NewPlatformUserForm />
    </>
  );
}
