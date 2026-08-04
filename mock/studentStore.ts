// ============================================================================
// MODULE : Mock — Student Store
// PURPOSE: Mutable store for the student register, so enrolment and edits
//          persist for the session.
//
//          Holds StudentWithUser rather than Student: the register is always
//          read with a name attached, and keeping the join denormalised here
//          means a newly enrolled student appears in the list with their name
//          immediately, rather than as a blank row until the next reload.
//
//          Separate file from mock/stores.ts for the same import-graph reason
//          as rbacStores — this needs mock/data/people.ts, the setup stores do
//          not.
// ============================================================================

import type { StudentWithUser } from "@/types";
import { MOCK_STUDENTS_WITH_USER } from "./data/people";
import { createMockStore } from "./store";

export const studentStore = createMockStore<StudentWithUser>(
  MOCK_STUDENTS_WITH_USER,
  "stu_new",
  3
);
