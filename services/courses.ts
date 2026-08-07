// ============================================================================
// MODULE : Services — Courses
// PURPOSE: The course catalogue.
//
//          No backend route serves this yet — courses are backend Phase 8. The
//          live branch is written against the contract the other collections
//          follow, so wiring it up later is a change here alone.
//
//          Read-only for now: Phase 10 needs the catalogue to populate a
//          teaching-assignment picker, and the catalogue's own CRUD screen is
//          Phase 11.
// ============================================================================

import type { ApiResponse, Course, ListParams, PaginatedResult } from "@/types";
import { apiList, apiRequest } from "./client";

export async function listCourses(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Course>>> {
  return apiList<Course>("/api/courses", "courses", params);
}

export async function getCourse(id: string): Promise<ApiResponse<Course>> {
  return apiRequest<Course>(`/api/courses/${id}`);
}

export interface CourseInput {
  name: string;
  code: string;
  type?: Course["type"];
  credits: number;
  departmentId?: string;
  description?: string;
  isActive?: boolean;
}

export async function createCourse(input: CourseInput): Promise<ApiResponse<Course>> {
  return apiRequest<Course>("/api/courses", { method: "POST", body: input });
}

export async function updateCourse(
  id: string,
  input: Partial<CourseInput>
): Promise<ApiResponse<Course>> {
  return apiRequest<Course>(`/api/courses/${id}`, { method: "PATCH", body: input });
}

/**
 * Delete a course.
 *
 * Refused while the course is timetabled, assigned to a lecturer or placed in a
 * curriculum — removing it would orphan every one of those. Retiring it
 * (isActive false) is the operation that is almost always meant instead, and
 * the UI says so.
 */
export async function deleteCourse(id: string): Promise<ApiResponse<null>> {
  return apiRequest<null>(`/api/courses/${id}`, { method: "DELETE" });
}
