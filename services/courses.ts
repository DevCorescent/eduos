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
import { USE_MOCKS } from "./config";
import { MOCK_TENANT_ID } from "@/mock/data/context";
import { courseStore } from "@/mock/courseStore";
import { curriculumSubjectStore, timetableStore } from "@/mock/academicsStores";
import { assignmentStore } from "@/mock/staffStores";
import { mockFail, mockList, mockOk } from "@/mock/utils";

export async function listCourses(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Course>>> {
  if (USE_MOCKS) {
    return mockList(courseStore.all(), params, {
      searchFields: ["name", "code"],
      filterKeys: ["departmentId", "type"],
      sort: (a, b) => a.code.localeCompare(b.code),
    });
  }
  return apiList<Course>("/api/courses", "courses", params);
}

export async function getCourse(id: string): Promise<ApiResponse<Course>> {
  if (USE_MOCKS) {
    const course = courseStore.find(id);
    return course ? mockOk(course) : mockFail<Course>("Course not found", "NOT_FOUND");
  }
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
  if (USE_MOCKS) {
    // @@unique([tenantId, code]) — a course code is the identifier staff and
    // students actually use, so a clash is reported against that field.
    if (courseStore.all().some((c) => c.code.toLowerCase() === input.code.toLowerCase())) {
      return mockFail<Course>("Course code already in use", "CONFLICT");
    }

    const timestamp = new Date().toISOString();
    return mockOk(
      courseStore.insert({
        id: courseStore.nextId(),
        tenantId: MOCK_TENANT_ID,
        departmentId: input.departmentId || null,
        name: input.name,
        code: input.code,
        type: input.type ?? "CORE",
        credits: input.credits,
        description: input.description ?? null,
        syllabus: null,
        isActive: input.isActive ?? true,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      "Course created"
    );
  }
  return apiRequest<Course>("/api/courses", { method: "POST", body: input });
}

export async function updateCourse(
  id: string,
  input: Partial<CourseInput>
): Promise<ApiResponse<Course>> {
  if (USE_MOCKS) {
    const duplicate = courseStore
      .all()
      .some((c) => c.id !== id && input.code && c.code.toLowerCase() === input.code.toLowerCase());
    if (duplicate) return mockFail<Course>("Course code already in use", "CONFLICT");

    const updated = courseStore.update(id, {
      ...input,
      // A cleared select is "", which must land as null on a nullable column.
      ...(input.departmentId !== undefined
        ? { departmentId: input.departmentId || null }
        : {}),
      updatedAt: new Date().toISOString(),
    });

    return updated
      ? mockOk(updated, "Course updated")
      : mockFail<Course>("Course not found", "NOT_FOUND");
  }
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
  if (USE_MOCKS) {
    if (!courseStore.find(id)) return mockFail<null>("Course not found", "NOT_FOUND");

    if (assignmentStore.all().some((a) => a.courseId === id)) {
      return mockFail<null>("Course is assigned to faculty — retire it instead", "CONFLICT");
    }
    if (timetableStore.all().some((slot) => slot.courseId === id)) {
      return mockFail<null>("Course is on a timetable — retire it instead", "CONFLICT");
    }
    if (curriculumSubjectStore.all().some((s) => s.courseId === id)) {
      return mockFail<null>("Course is in a curriculum — retire it instead", "CONFLICT");
    }

    courseStore.remove(id);
    return mockOk(null, "Course deleted");
  }
  return apiRequest<null>(`/api/courses/${id}`, { method: "DELETE" });
}
