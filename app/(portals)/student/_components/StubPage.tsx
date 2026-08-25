// ============================================================================
// MODULE : Student Portal — Template UI (PRD §57)
// LAYER  : Presentation
// PURPOSE: The page behind a §57 nav entry whose module has not been built.
//
// WHY THESE PAGES EXIST AT ALL
//   §57 specifies a sixteen-item Student Portal menu. Seven of those items name
//   modules that are NOT_STARTED — §14 Learning, §26 Library, §29 Placements,
//   §34 Events, §38 Support, §40 AI Assistant — so the nav has a choice: omit
//   them and show a portal smaller than the specification, or link them and
//   land the reader somewhere honest. This is the somewhere.
//
// WHAT MAKES IT HONEST RATHER THAN A PLACEHOLDER
//   It renders UnavailableState, which the design system defines as "there is
//   no query to make" — distinct from EmptyState ("the query succeeded and you
//   have nothing") and ErrorState ("the query failed, try again"). A student
//   who lands here is told the capability is not built yet, not that their
//   library record is empty. It names the PRD section so the reader inside the
//   team knows exactly what would fill it, and it offers no retry, because
//   retrying will never help.
//
//   It deliberately renders NO fabricated rows, charts or figures. A template
//   that invents a reading list to look finished teaches everyone who demos it
//   that the module exists.
// ============================================================================

import { PageHeader } from "@/components/layout/PageHeader";
import { UnavailableState } from "@/components/shared/UnavailableState";
import { Card } from "@/components/ui/Card";

export interface StubPageProps {
  /** The §57 menu label, verbatim. */
  title: string;
  /** One line on what the module is for, in the student's own terms. */
  subtitle: string;
  /**
   * The PRD section this page will be built from, e.g. "§26 Library
   * Management". Shown to the reader — an institution evaluating the product
   * can see the roadmap item behind the empty screen.
   */
  prdSection: string;
}

export function StubPage({ title, subtitle, prdSection }: StubPageProps) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />

      <Card>
        <UnavailableState
          title={`${title} is not available yet`}
          description={`This portal section is specified by PRD ${prdSection} and has no backend to read from yet. It will appear here once that module is built — nothing is missing from your record.`}
        />
      </Card>
    </>
  );
}
