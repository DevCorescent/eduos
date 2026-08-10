import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { getPlatformSession } from "@/lib/auth/platformSession";
import { unwrapResource } from "@/lib/require-resource";
import { getPlatformUser } from "@/services/platformUsers";
import { formatDateTime } from "@/utils/format";
import { EditPlatformUserForm } from "./EditPlatformUserForm";
import { ResetPasswordAction } from "../ResetPasswordAction";

/** params is a Promise in Next.js 16 — it must be awaited before destructuring. */
type Params = Promise<{ id: string }>;

/**
 * Sets the browser tab title to the operator's name.
 *
 * The fetch here is not a second round trip in practice: Next.js dedupes
 * identical fetches within one render pass, so this and the page below share a
 * single request.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const result = await getPlatformUser(id);

  return {
    title: result.success ? `${result.data.firstName} ${result.data.lastName}` : "Platform User",
  };
}

/**
 * View and edit one platform operator (W1.3).
 *
 * The read-only facts (last sign-in, created, updated) sit beside the form
 * rather than inside it, because they are not editable and a disabled input is
 * a worse way to say so than plain text.
 */
export default async function PlatformUserDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  const [result, session] = await Promise.all([getPlatformUser(id), getPlatformSession()]);

  // notFound() renders the 404 page. Any other failure is a real error and is
  // surfaced by the route's error boundary instead — the two must not be
  // conflated, or a transient outage would report the account as deleted.
  const user = unwrapResource(result, "platform user");

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
        title={`${user.firstName} ${user.lastName}`}
        subtitle={user.email}
        action={
          <StatusBadge
            label={user.isActive ? "Active" : "Inactive"}
            variant={user.isActive ? "success" : "neutral"}
            size="md"
          />
        }
      />

      {user.mustChangePassword && (
        <Alert variant="warning" className="mb-6">
          This operator is still using a generated password. They can sign in, but the console
          refuses every other request until they choose their own.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EditPlatformUserForm user={user} currentUserId={session?.sub ?? ""} />
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="text-sm font-semibold text-heading">Account</h2>
            <dl className="mt-3 flex flex-col gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Last sign-in</dt>
                <dd className="text-foreground">
                  {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Created</dt>
                <dd className="text-foreground">{formatDateTime(user.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last updated</dt>
                <dd className="text-foreground">{formatDateTime(user.updatedAt)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-heading">Password</h2>
            <p className="mt-1 mb-3 text-sm text-muted-foreground">
              Issues a new temporary password and shows it to you once. Use this when an operator
              has lost access — you never choose their password, and the stored hash is never
              displayed.
            </p>
            <ResetPasswordAction user={user} />
          </Card>
        </div>
      </div>
    </>
  );
}
