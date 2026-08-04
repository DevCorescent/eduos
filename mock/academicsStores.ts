// ============================================================================
// MODULE : Mock — Academic Operations Stores
// PURPOSE: Mutable stores for curriculum subjects, timetable slots and
//          attendance, so those screens can actually be used.
//
//          Attendance is the one that genuinely needs to be mutable: marking a
//          register is the primary action on its screen, and re-marking must
//          update rather than duplicate — see markAttendance in
//          services/academics.ts.
// ============================================================================

import type { Attendance, CurriculumSubject, Timetable } from "@/types";
import {
  MOCK_ATTENDANCE,
  MOCK_CURRICULUM_SUBJECTS,
  MOCK_TIMETABLE,
} from "./data/academics-ops";
import { createMockStore } from "./store";

export const curriculumSubjectStore = createMockStore<CurriculumSubject>(
  MOCK_CURRICULUM_SUBJECTS,
  "cus_new",
  4
);

export const timetableStore = createMockStore<Timetable>(MOCK_TIMETABLE, "tt_new", 4);

export const attendanceStore = createMockStore<Attendance>(MOCK_ATTENDANCE, "att_new", 5);
