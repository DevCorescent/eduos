// ============================================================================
// MODULE : Mock — Examination Stores
// PURPOSE: Makes marks entry actually persist across a navigation.
//
//          The fixtures in mock/data/student-details.ts are a module-load
//          snapshot: writing to them and reading from them are two different
//          things, and a screen built that way silently loses every edit the
//          moment the page re-renders. This is the same lesson the grading
//          screen taught in Phase 12 — every read path for a collection that
//          the UI can write MUST go through its store, not through the seed.
// ============================================================================

import type { ExamResult } from "@/types";
import { MOCK_EXAM_RESULTS } from "./data/student-details";
import { createMockStore } from "./store";

export const examResultStore = createMockStore<ExamResult>(
  MOCK_EXAM_RESULTS,
  "res_new",
  6
);
