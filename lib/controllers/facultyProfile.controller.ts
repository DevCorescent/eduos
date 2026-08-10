// ============================================================================
// OWNER      : Gauransh
// MODULE     : Faculty Profile & Performance Analytics (Phase 23)
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised, already-
//              validated input from the route and delegates.
// ARCHITECTURE:
//   • Controller performs ONLY delegation.
//   • No auth, no tenant resolution, no request or response handling, no
//     validation, no business logic, no arithmetic, no Prisma of its own.
//
// THE COMPOSITION ROOT
//   The single place FacultyProfileService is wired to its repository and to
//   the one narrow port it needs. Every route in this module shares one
//   instance, so none can construct a differently-wired one.
//
// THE FEEDBACK ADAPTER REUSES PHASE 20 RATHER THAN RE-DERIVING IT
//   The average rating is computed by Phase 20's OWN repository reads and its
//   OWN statistics module — `mean` and `descale` from
//   lib/domain/feedback/statistics.ts, over the submissions
//   feedbackRepository already knows how to find. Nothing here re-implements an
//   average, and nothing here decides which submissions are analysable: that is
//   ANALYSABLE_STATUS, applied inside findSubmissionsForFaculty.
//
//   Recomputing the figure independently would give a faculty member two
//   different ratings on two pages of the same product, and the day Phase 20's
//   scale changed only one of them would follow.
// ============================================================================

import { facultyProfileRepository } from "@/lib/repositories/facultyProfile.repository";
import { feedbackRepository } from "@/lib/repositories/feedback.repository";
import { descale, mean } from "@/lib/domain/feedback/statistics";
import {
  FacultyProfileService,
  type FacultyAccessContext,
  type FacultyFeedbackPort,
} from "@/lib/services/facultyProfile.service";
import type {
  FacultyAnalyticsDto,
  FacultyPerformanceDto,
  FacultyProfileDto,
  FacultyWorkloadDto,
} from "@/lib/dto/facultyProfile.dto";
import type {
  FacultyScopeQuery,
  UpdateFacultyProfileInput,
} from "@/lib/validations/facultyProfile.validation";

/**
 * The average student rating for one faculty member.
 *
 * Two reads, both Phase 20's: the analysable submissions about this member,
 * then their answers. The mean is taken over every RATED answer — a question
 * that invited only a comment carries a null rating and is skipped, because
 * counting it as zero would drag an otherwise good score down for the offence
 * of having been asked an open question.
 *
 * `mean` returns a value at Phase 20's internal scale and `descale` brings it
 * back to the 1-5 scale a client reads. Both come from that module rather than
 * being restated, so this figure and the feedback page's cannot diverge.
 *
 * Returns a zero-count, null-rating result when nobody has responded. That is
 * the honest answer, and it is also what the service degrades to if this throws.
 */
const feedbackPort: FacultyFeedbackPort = {
  async findAverageRating(tenantId, facultyId, semesterId) {
    const submissions = await feedbackRepository.findSubmissionsForFaculty(
      tenantId,
      facultyId,
      semesterId === undefined ? {} : { semesterId }
    );

    if (submissions.length === 0) {
      return { averageRating: null, responseCount: 0 };
    }

    const answers = await feedbackRepository.findAnswersForSubmissions(
      tenantId,
      submissions.map((submission) => submission.id)
    );

    const ratings = answers
      .map((answer) => answer.rating)
      .filter((rating): rating is number => rating !== null);

    return {
      averageRating: descale(mean(ratings)),
      // The RESPONSE count is submissions, not answers: one student filling in
      // twelve questions is one response, and reporting twelve would inflate
      // every faculty member's apparent sample by the length of the form.
      responseCount: submissions.length,
    };
  },
};

/** The single wired instance every route in this module delegates to. */
const facultyProfileService = new FacultyProfileService(
  facultyProfileRepository,
  feedbackPort
);

export class FacultyProfileController {
  /** GET /api/faculty/profile/[facultyId] */
  async getProfile(
    context: FacultyAccessContext,
    facultyId: string
  ): Promise<FacultyProfileDto> {
    return facultyProfileService.getProfile(context, facultyId);
  }

  /** PATCH /api/faculty/profile/[facultyId] */
  async updateProfile(
    context: FacultyAccessContext,
    facultyId: string,
    input: UpdateFacultyProfileInput
  ): Promise<FacultyProfileDto> {
    return facultyProfileService.updateProfile(context, facultyId, input);
  }

  /** GET /api/faculty/workload/[facultyId] */
  async getWorkload(
    context: FacultyAccessContext,
    facultyId: string,
    query: FacultyScopeQuery
  ): Promise<FacultyWorkloadDto> {
    return facultyProfileService.getWorkload(context, facultyId, query);
  }

  /** GET /api/faculty/performance/[facultyId] */
  async getPerformance(
    context: FacultyAccessContext,
    facultyId: string,
    query: FacultyScopeQuery
  ): Promise<FacultyPerformanceDto> {
    return facultyProfileService.getPerformance(context, facultyId, query);
  }

  /** GET /api/faculty/analytics/[facultyId] */
  async getAnalytics(
    context: FacultyAccessContext,
    facultyId: string,
    query: FacultyScopeQuery
  ): Promise<FacultyAnalyticsDto> {
    return facultyProfileService.getAnalytics(context, facultyId, query);
  }
}

export const facultyProfileController = new FacultyProfileController();
