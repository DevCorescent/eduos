// ============================================================================
// MODULE : Mock — Course Store
// PURPOSE: Mutable store for the course catalogue.
//
//          Separate file for the same import-graph reason as the other stores:
//          mock/data/courses.ts depends on people and academics, which the
//          setup stores do not.
// ============================================================================

import type { Course } from "@/types";
import { MOCK_COURSES } from "./data/courses";
import { createMockStore } from "./store";

export const courseStore = createMockStore<Course>(MOCK_COURSES, "crs_new", 3);
