import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { childNotices } from "@/services/parentPortal";
import { formatDateTime } from "@/utils/format";
import { resolveChildContext, NoChildren } from "../childContext";
import { ParentPageHeader } from "../ParentPage";

export const metadata: Metadata = { title: "Notices" };
type SearchParams = Promise<{ child?: string }>;

/**
 * PRD §32 "Notices" — published announcements addressed to this child's cohort.
 *
 * Audience filtering is the server's: INSTITUTION, or the child's own
 * department, batch or section. A parent sees what their child was told and
 * nothing wider.
 */
export default async function ParentNoticesPage({ searchParams }: { searchParams: SearchParams }) {
  const { child } = await searchParams;
  const context = await resolveChildContext(child);
  if (context.kind === "failed") return context.node;
  if (context.kind === "empty") return <NoChildren />;

  const result = await childNotices(context.selected.studentId);

  return (
    <>
      <ParentPageHeader
        title="Notices"
        subtitle="Announcements"
        childList={context.children}
        selected={context.selected}
      />

      {!result.success ? (
        <StateView state={resolveFailureState(result)} subject="notices" message={result.error} />
      ) : result.data.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title="No notices"
          description="Nothing has been published for this child's group yet."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {result.data.map((notice) => (
            <Card key={notice.id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-sm font-semibold text-heading">{notice.title}</h2>
                {notice.isPinned && (
                  <Badge variant="warning" size="sm" withDot={false}>
                    Pinned
                  </Badge>
                )}
                <Badge variant="neutral" size="sm" withDot={false}>
                  {notice.audience}
                </Badge>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{notice.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {formatDateTime(notice.publishAt ?? notice.createdAt)}
              </p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
