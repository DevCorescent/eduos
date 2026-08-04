// ============================================================================
// MODULE : Mock Data — Academic Structure
// PURPOSE: The organisational spine of one university: campuses, schools,
//          departments, programmes, specialisations, academic years, semesters,
//          batches and sections.
//
//          Every level references the one above by real id, so the whole tree
//          is navigable and the cascading filters the Setup screens need
//          (school filtered by campus, department by school) have genuine data
//          to filter. A flat set of unrelated rows would let those screens look
//          finished while being untestable.
//
//          Sizes are chosen to exercise UI states rather than to look large:
//          two campuses so a campus filter is meaningful, one department with
//          no school so the nullable schoolId path is covered, and one inactive
//          programme so the isActive branch renders.
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
import { daysAgo } from "../utils";
import { MOCK_TENANT_ID, mockId } from "./context";

const CREATED = daysAgo(640);

// --- Campuses ---------------------------------------------------------------

export const MOCK_CAMPUSES: Campus[] = [
  {
    id: "cmp_001",
    tenantId: MOCK_TENANT_ID,
    name: "Jaipur Main Campus",
    code: "JPR",
    address: { line1: "Ajmer Road", city: "Jaipur", state: "Rajasthan", country: "India" },
    phone: "+91 141 4000 100",
    email: "jaipur@verify.edu",
    isMain: true,
    createdAt: CREATED,
    updatedAt: CREATED,
  },
  {
    id: "cmp_002",
    tenantId: MOCK_TENANT_ID,
    name: "Udaipur Campus",
    code: "UDR",
    address: { line1: "Lake Road", city: "Udaipur", state: "Rajasthan", country: "India" },
    phone: "+91 294 2400 200",
    email: "udaipur@verify.edu",
    isMain: false,
    createdAt: daysAgo(400),
    updatedAt: daysAgo(400),
  },
];

// --- Schools ----------------------------------------------------------------

export const MOCK_SCHOOLS: School[] = [
  { id: "sch_001", campusId: "cmp_001", name: "School of Engineering & Technology", code: "SOET", deanName: "Dr. Anil Kapoor" },
  { id: "sch_002", campusId: "cmp_001", name: "School of Management", code: "SOM", deanName: "Dr. Neha Gupta" },
  { id: "sch_003", campusId: "cmp_001", name: "School of Sciences", code: "SOS", deanName: "Dr. Ramesh Menon" },
  { id: "sch_004", campusId: "cmp_002", name: "School of Design", code: "SOD", deanName: "Dr. Kavita Joshi" },
].map((seed) => ({
  ...seed,
  tenantId: MOCK_TENANT_ID,
  email: `${seed.code.toLowerCase()}@verify.edu`,
  createdAt: CREATED,
  updatedAt: CREATED,
}));

// --- Departments ------------------------------------------------------------

export const MOCK_DEPARTMENTS: Department[] = [
  { id: "dep_001", campusId: "cmp_001", schoolId: "sch_001", name: "Computer Science & Engineering", code: "CSE", hodName: "Dr. Vikram Nair" },
  { id: "dep_002", campusId: "cmp_001", schoolId: "sch_001", name: "Electronics & Communication", code: "ECE", hodName: "Dr. Sunita Rao" },
  { id: "dep_003", campusId: "cmp_001", schoolId: "sch_001", name: "Mechanical Engineering", code: "MECH", hodName: "Dr. Arun Prasad" },
  { id: "dep_004", campusId: "cmp_001", schoolId: "sch_002", name: "Business Administration", code: "MBA", hodName: "Dr. Pooja Malhotra" },
  { id: "dep_005", campusId: "cmp_001", schoolId: "sch_002", name: "Commerce", code: "COM", hodName: "Dr. Sanjay Bhatt" },
  { id: "dep_006", campusId: "cmp_001", schoolId: "sch_003", name: "Physics", code: "PHY", hodName: "Dr. Latha Krishnan" },
  { id: "dep_007", campusId: "cmp_002", schoolId: "sch_004", name: "Product Design", code: "PDES", hodName: "Dr. Imran Sheikh" },
  // Deliberately unattached to a school: Department.schoolId is nullable, and a
  // standalone administrative department is the real case that exercises it.
  { id: "dep_008", campusId: "cmp_002", schoolId: null, name: "Physical Education", code: "PED", hodName: null },
].map((seed) => ({
  ...seed,
  tenantId: MOCK_TENANT_ID,
  email: `${seed.code.toLowerCase()}@verify.edu`,
  createdAt: CREATED,
  updatedAt: CREATED,
}));

// --- Programmes -------------------------------------------------------------

interface ProgrammeSeed {
  id: string;
  departmentId: string;
  name: string;
  code: string;
  type: Programme["type"];
  durationValue: number;
  totalCredits: number;
  isActive?: boolean;
}

const PROGRAMME_SEEDS: ProgrammeSeed[] = [
  { id: "prg_001", departmentId: "dep_001", name: "B.Tech Computer Science & Engineering", code: "BTCSE", type: "UNDERGRADUATE", durationValue: 4, totalCredits: 160 },
  { id: "prg_002", departmentId: "dep_001", name: "M.Tech Computer Science", code: "MTCSE", type: "POSTGRADUATE", durationValue: 2, totalCredits: 80 },
  { id: "prg_003", departmentId: "dep_002", name: "B.Tech Electronics & Communication", code: "BTECE", type: "UNDERGRADUATE", durationValue: 4, totalCredits: 160 },
  { id: "prg_004", departmentId: "dep_003", name: "B.Tech Mechanical Engineering", code: "BTMECH", type: "UNDERGRADUATE", durationValue: 4, totalCredits: 160 },
  { id: "prg_005", departmentId: "dep_004", name: "Master of Business Administration", code: "MBA", type: "POSTGRADUATE", durationValue: 2, totalCredits: 96 },
  { id: "prg_006", departmentId: "dep_005", name: "B.Com (Honours)", code: "BCOMH", type: "UNDERGRADUATE", durationValue: 3, totalCredits: 120 },
  { id: "prg_007", departmentId: "dep_006", name: "M.Sc Physics", code: "MSCPHY", type: "POSTGRADUATE", durationValue: 2, totalCredits: 80 },
  { id: "prg_008", departmentId: "dep_006", name: "Ph.D Physics", code: "PHDPHY", type: "PHD", durationValue: 5, totalCredits: 60 },
  { id: "prg_009", departmentId: "dep_007", name: "B.Des Product Design", code: "BDESPD", type: "UNDERGRADUATE", durationValue: 4, totalCredits: 152 },
  { id: "prg_010", departmentId: "dep_001", name: "Diploma in Data Engineering", code: "DIPDE", type: "DIPLOMA", durationValue: 1, totalCredits: 40 },
  { id: "prg_011", departmentId: "dep_004", name: "Certificate in Business Analytics", code: "CERTBA", type: "CERTIFICATE", durationValue: 6, totalCredits: 20 },
  // Retired intake — exercises the inactive branch on the programmes screen.
  { id: "prg_012", departmentId: "dep_003", name: "B.Tech Production Engineering", code: "BTPROD", type: "UNDERGRADUATE", durationValue: 4, totalCredits: 160, isActive: false },
];

export const MOCK_PROGRAMMES: Programme[] = PROGRAMME_SEEDS.map((seed) => ({
  id: seed.id,
  tenantId: MOCK_TENANT_ID,
  departmentId: seed.departmentId,
  name: seed.name,
  code: seed.code,
  type: seed.type,
  durationValue: seed.durationValue,
  // The certificate programme runs in months; everything else in years.
  durationUnit: seed.type === "CERTIFICATE" ? "MONTHS" : "YEARS",
  totalCredits: seed.totalCredits,
  eligibility:
    seed.type === "UNDERGRADUATE"
      ? "10+2 with Physics, Chemistry and Mathematics; minimum 60%"
      : seed.type === "POSTGRADUATE"
        ? "Bachelor's degree in a relevant discipline; minimum 55%"
        : null,
  description: null,
  isActive: seed.isActive ?? true,
  createdAt: CREATED,
  updatedAt: CREATED,
}));

// --- Specialisations --------------------------------------------------------

export const MOCK_SPECIALISATIONS: Specialisation[] = [
  { id: "spc_001", programmeId: "prg_001", name: "Artificial Intelligence & Machine Learning", code: "AIML" },
  { id: "spc_002", programmeId: "prg_001", name: "Cyber Security", code: "CYS" },
  { id: "spc_003", programmeId: "prg_001", name: "Data Science", code: "DS" },
  { id: "spc_004", programmeId: "prg_003", name: "VLSI Design", code: "VLSI" },
  { id: "spc_005", programmeId: "prg_005", name: "Finance", code: "MBAFIN" },
  { id: "spc_006", programmeId: "prg_005", name: "Marketing", code: "MBAMKT" },
  { id: "spc_007", programmeId: "prg_005", name: "Human Resources", code: "MBAHR" },
].map((seed) => ({
  ...seed,
  tenantId: MOCK_TENANT_ID,
  description: null,
  isActive: true,
  createdAt: CREATED,
}));

// --- Academic years & semesters ---------------------------------------------

export const MOCK_ACADEMIC_YEARS: AcademicYear[] = [
  { id: "ayr_001", name: "2024-25", startDate: "2024-07-01T00:00:00.000Z", endDate: "2025-06-30T00:00:00.000Z", isCurrent: false },
  { id: "ayr_002", name: "2025-26", startDate: "2025-07-01T00:00:00.000Z", endDate: "2026-06-30T00:00:00.000Z", isCurrent: false },
  // Exactly one current year. The Setup screen's "Set as current" action has to
  // enforce that, so the fixture must not start out violating it.
  { id: "ayr_003", name: "2026-27", startDate: "2026-07-01T00:00:00.000Z", endDate: "2027-06-30T00:00:00.000Z", isCurrent: true },
].map((seed) => ({ ...seed, tenantId: MOCK_TENANT_ID, createdAt: CREATED }));

/** Two semesters per academic year — odd runs Jul–Dec, even Jan–Jun. */
export const MOCK_SEMESTERS: Semester[] = MOCK_ACADEMIC_YEARS.flatMap((year, yearIndex) => {
  const startYear = Number(year.name.slice(0, 4));

  return [1, 2].map((half): Semester => {
    const isOdd = half === 1;
    return {
      id: mockId("sem", yearIndex * 2 + half),
      tenantId: MOCK_TENANT_ID,
      academicYearId: year.id,
      name: `${year.name} ${isOdd ? "Odd" : "Even"}`,
      semesterNumber: half,
      startDate: isOdd
        ? `${startYear}-07-01T00:00:00.000Z`
        : `${startYear + 1}-01-01T00:00:00.000Z`,
      endDate: isOdd
        ? `${startYear}-12-31T00:00:00.000Z`
        : `${startYear + 1}-06-30T00:00:00.000Z`,
      // The current year's odd semester is the one in progress on the fixture
      // epoch (2026-07-01), which is what the dashboard reports as "current".
      isCurrent: year.isCurrent && isOdd,
      createdAt: CREATED,
    };
  });
});

export const CURRENT_ACADEMIC_YEAR = MOCK_ACADEMIC_YEARS.find((y) => y.isCurrent)!;
export const CURRENT_SEMESTER = MOCK_SEMESTERS.find((s) => s.isCurrent)!;

// --- Batches ----------------------------------------------------------------

/**
 * One batch per active programme per academic year.
 *
 * Generated rather than listed: twelve programmes across three years is
 * thirty-odd rows whose only interesting property is that they reference a real
 * programme and a real year.
 */
export const MOCK_BATCHES: Batch[] = MOCK_ACADEMIC_YEARS.flatMap((year, yearIndex) =>
  MOCK_PROGRAMMES.filter((programme) => programme.isActive).map(
    (programme, programmeIndex): Batch => ({
      id: mockId("bat", yearIndex * 100 + programmeIndex + 1),
      tenantId: MOCK_TENANT_ID,
      programmeId: programme.id,
      academicYearId: year.id,
      name: `${programme.code} ${year.name}`,
      code: `${programme.code}-${year.name.slice(0, 4)}`,
      maxStrength: programme.type === "UNDERGRADUATE" ? 120 : 60,
      createdAt: CREATED,
    })
  )
);

// --- Sections ---------------------------------------------------------------

/**
 * Sections for the current semester only.
 *
 * A section is scoped to (batch, semester), so generating them for every batch
 * across every semester would produce hundreds of rows that no screen reads.
 * The current semester is the one the timetable and attendance modules work in.
 */
export const MOCK_SECTIONS: Section[] = MOCK_BATCHES.filter(
  (batch) => batch.academicYearId === CURRENT_ACADEMIC_YEAR.id
).flatMap((batch, batchIndex) => {
  const programme = MOCK_PROGRAMMES.find((p) => p.id === batch.programmeId);
  // Undergraduate intakes are large enough to split; postgraduate ones are not.
  const sectionNames = programme?.type === "UNDERGRADUATE" ? ["A", "B"] : ["A"];

  return sectionNames.map(
    (name, nameIndex): Section => ({
      id: mockId("sec", batchIndex * 10 + nameIndex + 1),
      tenantId: MOCK_TENANT_ID,
      batchId: batch.id,
      semesterId: CURRENT_SEMESTER.id,
      name,
      maxStrength: 60,
      createdAt: CREATED,
    })
  );
});

// --- Lookups ----------------------------------------------------------------
// Built once at module load. Every screen that joins a student to a programme
// name, or a department to its campus, does it through these — repeated
// Array.find() inside a render is O(rows x fixtures) for no reason.

export const CAMPUS_BY_ID = new Map(MOCK_CAMPUSES.map((c) => [c.id, c]));
export const SCHOOL_BY_ID = new Map(MOCK_SCHOOLS.map((s) => [s.id, s]));
export const DEPARTMENT_BY_ID = new Map(MOCK_DEPARTMENTS.map((d) => [d.id, d]));
export const PROGRAMME_BY_ID = new Map(MOCK_PROGRAMMES.map((p) => [p.id, p]));
export const BATCH_BY_ID = new Map(MOCK_BATCHES.map((b) => [b.id, b]));
export const SECTION_BY_ID = new Map(MOCK_SECTIONS.map((s) => [s.id, s]));
export const SEMESTER_BY_ID = new Map(MOCK_SEMESTERS.map((s) => [s.id, s]));
export const ACADEMIC_YEAR_BY_ID = new Map(MOCK_ACADEMIC_YEARS.map((y) => [y.id, y]));
export const SPECIALISATION_BY_ID = new Map(MOCK_SPECIALISATIONS.map((s) => [s.id, s]));
