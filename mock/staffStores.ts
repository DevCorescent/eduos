// ============================================================================
// MODULE : Mock — Staff Stores
// PURPOSE: Mutable stores for faculty, employees and teaching assignments.
//
//          Faculty and employees are held as *WithUser rows for the same
//          reason the student store is: the directory is always read with a
//          name attached, so denormalising the join here means a newly added
//          member appears named rather than as a blank row.
// ============================================================================

import type { EmployeeWithUser, FacultyCourseAssignment, FacultyWithUser } from "@/types";
import { MOCK_EMPLOYEES_WITH_USER, MOCK_FACULTY_WITH_USER } from "./data/people";
import { MOCK_FACULTY_ASSIGNMENTS } from "./data/courses";
import { createMockStore } from "./store";

export const facultyStore = createMockStore<FacultyWithUser>(
  MOCK_FACULTY_WITH_USER,
  "fac_new",
  3
);

export const employeeStore = createMockStore<EmployeeWithUser>(
  MOCK_EMPLOYEES_WITH_USER,
  "emp_new",
  3
);

export const assignmentStore = createMockStore<FacultyCourseAssignment>(
  MOCK_FACULTY_ASSIGNMENTS,
  "fca_new",
  4
);
