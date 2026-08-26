import type { ReactNode } from "react";
import { ModuleGate } from "@/components/layout/ModuleGate";

/**
 * Module gate for /website and everything beneath it.
 *
 * The mapping from this path to its module lives in
 * lib/constants/moduleRoutes.ts, so this file states WHICH segment is governed
 * and nothing about WHICH module governs it — one place to read the policy, and
 * one place to change it.
 */
export default function WebsiteSegmentLayout({ children }: { children: ReactNode }) {
  return <ModuleGate path="/website">{children}</ModuleGate>;
}
