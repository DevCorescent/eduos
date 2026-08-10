import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { Card } from "@/components/ui/Card";
import { getMyBranding } from "@/services/branding";
import { BrandingForm } from "./BrandingForm";

export const metadata: Metadata = { title: "Branding" };

/**
 * PRD §45 — this university's own branding.
 *
 * IN (account), NOT (platform)
 *   §45 opens "Each university can configure:", so branding belongs to the
 *   institution rather than to the platform owner. The API is guarded by
 *   requireRole("UNIVERSITY_ADMIN") + requireTenant and takes no tenant id
 *   anywhere, so there is no parameter to change to reach another institution's
 *   settings. A non-admin who reaches this URL gets an Unavailable state from
 *   the 403, not an error — the capability simply is not theirs.
 *
 * WHAT IS NOT HERE, AND WHY
 *   §45 also lists typography, portal layout, splash screen, SMS sender ID,
 *   email domain and mobile app name. None has a column, and adding six the MVP
 *   cannot consume would be scope this work package did not agree to. Recorded
 *   in the completion matrix rather than half-built.
 */
export default async function BrandingPage() {
  const result = await getMyBranding();

  const header = (
    <PageHeader
      title="Branding"
      subtitle="Your logo, favicon and brand colours, across every screen on your domain."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="branding settings"
          message={result.error}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <Card>
        <BrandingForm branding={result.data} />
      </Card>
    </>
  );
}
