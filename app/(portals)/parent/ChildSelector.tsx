"use client";

import { Select } from "@/components/ui/Select";
import { useListParams } from "@/hooks/useListParams";
import type { ParentChild } from "@/services/parentPortal";

/**
 * Which child the parent is looking at.
 *
 * Writes `?child=` to the URL, so the selection is linkable, survives a reload
 * and lets every page fetch on the SERVER rather than in a client effect —
 * the same pattern every list screen in this product uses.
 *
 * THIS IS NOT A PERMISSION CONTROL. Changing the value by hand only changes
 * which id is sent; the backend proves the StudentParent link on every request
 * and answers 404 for a child that is not theirs. Nothing here is trusted.
 *
 * Rendered only when there is a choice to make — a parent with one child is not
 * asked to pick them.
 */
export function ChildSelector({ childList }: { childList: ParentChild[] }) {
  const { get, setParam } = useListParams();

  if (childList.length < 2) return null;

  const selected = get("child") ?? childList[0].studentId;

  return (
    <Select
      label="Child"
      value={selected}
      onChange={(value) => setParam("child", value)}
      options={childList.map((c) => ({
        value: c.studentId,
        label: `${c.firstName} ${c.lastName} — ${c.enrollmentNo}`,
      }))}
      containerClassName="w-full sm:w-80"
    />
  );
}
