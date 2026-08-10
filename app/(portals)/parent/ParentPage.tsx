import { PageHeader } from "@/components/layout/PageHeader";
import { ChildSelector } from "./ChildSelector";
import type { ParentChild } from "@/services/parentPortal";

/**
 * The header every child-scoped parent page shares: the title, and the selector
 * when there is more than one child.
 *
 * The selected child's name is in the subtitle so a parent with several is
 * never in doubt about whose record they are reading — the single most
 * confusing failure mode of a multi-child portal.
 */
export function ParentPageHeader({
  title,
  subtitle,
  childList,
  selected,
}: {
  title: string;
  subtitle: string;
  /** Named childList, not children: `children` is React's own prop. */
  childList: ParentChild[];
  selected: ParentChild;
}) {
  return (
    <>
      <PageHeader
        title={title}
        subtitle={`${subtitle} — ${selected.firstName} ${selected.lastName} (${selected.enrollmentNo})`}
      />
      <div className="mb-6">
        <ChildSelector childList={childList} />
      </div>
    </>
  );
}
