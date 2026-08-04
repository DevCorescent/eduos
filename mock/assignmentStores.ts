// ============================================================================
// MODULE : Mock — Assignment Stores
// PURPOSE: Mutable store for submissions, so grading actually persists.
//
//          Assignments themselves stay immutable for now: nothing in the
//          faculty portal creates or edits one yet, and a store that is only
//          ever read is state with no owner.
// ============================================================================

import type { AssignmentSubmission } from "@/types";
import { MOCK_SUBMISSIONS } from "./data/assignments";
import { createMockStore } from "./store";

export const submissionStore = createMockStore<AssignmentSubmission>(
  MOCK_SUBMISSIONS,
  "sub_new",
  5
);
