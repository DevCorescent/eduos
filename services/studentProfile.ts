// ============================================================================
// MODULE : Services — Student Self-Service
// PURPOSE: The three endpoints a student may call about themselves.
//
// WHY THESE EXIST SEPARATELY FROM services/students.ts
//   That module serves the ADMINISTRATOR's view: it calls /api/students/[id]
//   and its sub-resources, every one of which is requireRole
//   ("UNIVERSITY_ADMIN"). A student calling any of them receives 403.
//
//   These three are the student's own view. They take no id — the route
//   resolves the caller's Student row from the session — and they are the only
//   profile, dashboard and achievement reads a STUDENT is permitted. Keeping
//   them apart is what stops a portal page reaching for the admin variant and
//   failing at runtime with a permissions error nobody expected.
// ============================================================================

import type {
  AchievementDto,
  StudentDashboardDto,
  StudentProfileDto,
} from "@/lib/dto/studentProfile.dto";
import type { AchievementCategory } from "@/app/generated/prisma/enums";
import type { ApiResponse } from "@/types";
import { apiRequest } from "./client";

/**
 * The signed-in student's full profile.
 *
 * Identity, personal details, academic placement, parents, documents,
 * certificates and achievements — one request, because the endpoint assembles
 * all seven server-side rather than making the portal issue seven.
 */
export async function getMyProfile(): Promise<ApiResponse<StudentProfileDto>> {
  return apiRequest<StudentProfileDto>("/api/student/profile");
}

/**
 * The signed-in student's dashboard figures.
 *
 * `notifications` bounds the notification panel. Every figure in the response
 * is nullable by design: a student whose results have not been computed gets
 * `sgpa: null`, which the UI must render as "—" and never as 0.00.
 */
export async function getMyDashboard(
  notifications?: number
): Promise<ApiResponse<StudentDashboardDto>> {
  return apiRequest<StudentDashboardDto>("/api/student/dashboard", {
    params: notifications === undefined ? undefined : { notifications },
  });
}

/** The signed-in student's achievements, optionally narrowed to one category. */
export async function getMyAchievements(
  category?: AchievementCategory
): Promise<ApiResponse<AchievementDto[]>> {
  return apiRequest<AchievementDto[]>("/api/student/achievements", {
    params: category ? { category } : undefined,
  });
}
