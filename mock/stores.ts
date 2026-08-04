// ============================================================================
// MODULE : Mock — Store Registry
// PURPOSE: One mutable store per setup entity, created once at module load.
//
//          Declared together rather than inside each service so that a service
//          importing a store cannot accidentally construct a second one — two
//          stores over the same seed would each hold half the edits, and a row
//          created through one would be invisible to the other.
// ============================================================================

import type {
  AcademicYear,
  Batch,
  Campus,
  Department,
  Programme,
  School,
  Section,
  Semester,
  Specialisation,
} from "@/types";
import {
  MOCK_ACADEMIC_YEARS,
  MOCK_BATCHES,
  MOCK_CAMPUSES,
  MOCK_DEPARTMENTS,
  MOCK_PROGRAMMES,
  MOCK_SCHOOLS,
  MOCK_SECTIONS,
  MOCK_SEMESTERS,
  MOCK_SPECIALISATIONS,
} from "./data/academics";
import { createMockStore } from "./store";

export const campusStore = createMockStore<Campus>(MOCK_CAMPUSES, "cmp");
export const schoolStore = createMockStore<School>(MOCK_SCHOOLS, "sch");
export const departmentStore = createMockStore<Department>(MOCK_DEPARTMENTS, "dep");
export const programmeStore = createMockStore<Programme>(MOCK_PROGRAMMES, "prg");
export const specialisationStore = createMockStore<Specialisation>(MOCK_SPECIALISATIONS, "spc");
export const academicYearStore = createMockStore<AcademicYear>(MOCK_ACADEMIC_YEARS, "ayr");
export const semesterStore = createMockStore<Semester>(MOCK_SEMESTERS, "sem");
export const batchStore = createMockStore<Batch>(MOCK_BATCHES, "bat");
export const sectionStore = createMockStore<Section>(MOCK_SECTIONS, "sec");
