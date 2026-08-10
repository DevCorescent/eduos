import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { Users } from "lucide-react";
import { listMyChildren, type ParentChild } from "@/services/parentPortal";

/**
 * The children of the signed-in parent, and which one is selected.
 *
 * Every parent page begins here, so the "which child" question is answered in
 * one place. The selection comes from `?child=`, and an id that is not in the
 * list falls back to the first child rather than being passed through — a
 * hand-edited URL therefore shows a real child instead of an error, and the
 * backend would refuse it anyway.
 */
export type ChildContext =
  | { kind: "ok"; children: ParentChild[]; selected: ParentChild }
  | { kind: "empty" }
  | { kind: "failed"; node: React.ReactNode };

export async function resolveChildContext(childParam?: string): Promise<ChildContext> {
  const result = await listMyChildren();

  if (!result.success) {
    return {
      kind: "failed",
      node: (
        <StateView
          state={resolveFailureState(result)}
          subject="children"
          message={result.error}
        />
      ),
    };
  }

  const { children } = result.data;

  if (children.length === 0) return { kind: "empty" };

  const selected = children.find((c) => c.studentId === childParam) ?? children[0];

  return { kind: "ok", children, selected };
}

/** Shown when the account is linked to no student — a real, explainable state. */
export function NoChildren() {
  return (
    <EmptyState
      icon={<Users />}
      title="No children linked"
      description="This account is not linked to any student yet. Your university's administrator can link it."
    />
  );
}
