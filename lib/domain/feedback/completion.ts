// ============================================================================
// OWNER  : Gauransh
// MODULE : Feedback — Completion
// LAYER  : Domain (pure)
// PURPOSE: Decide whether a set of answers finishes a form — and therefore
//          whether a submission is DRAFT or SUBMITTED.
//
// PURITY
//   No Prisma, no HTTP, no repository, no service, no DTO.
//
// THIS MODULE ENFORCES THE TWO RULES THE SCHEMA COULD ONLY STATE
//   Batch 2 recorded two constraints the database cannot express, because both
//   need the question set:
//
//     • an answer citing a question that is not on the form
//     • a comment on a question whose `allowsComment` is false
//
//   Both are checked here. The first is a client bug or an attack; the second
//   is free text on a question with no place to display it, which would sit in
//   the database unread forever.
//
// WHY A PARTIAL SUBMISSION IS NOT AN ERROR
//   Validation deliberately accepts an incomplete answer set, because
//   completeness is decidable only against the form. A student saving progress
//   is doing something ordinary; refusing them with a 400 would force a client
//   to reimplement this logic to know whether saving was allowed.
//
//   So: incomplete is DRAFT, complete is SUBMITTED, and neither is a failure.
//   What IS a failure is asking to finish while required questions are
//   unanswered — and that is a distinct verdict, not the same one.
//
// COMPLEXITY
//   O(a + q), two passes and one Map. No nested scan.
// ============================================================================

/** A question, as the completion check needs it. */
export interface CompletionQuestion {
  readonly id: string;
  readonly isRequired: boolean;
  readonly allowsComment: boolean;
}

/** One answer, as the completion check needs it. */
export interface CompletionAnswer {
  readonly questionId: string;
  readonly comment?: string | null;
}

/** What is wrong with an answer set, if anything. */
export const COMPLETION_PROBLEM = {
  UNKNOWN_QUESTION: "UNKNOWN_QUESTION",
  COMMENT_NOT_INVITED: "COMMENT_NOT_INVITED",
  MISSING_REQUIRED: "MISSING_REQUIRED",
} as const;

export type CompletionProblem =
  (typeof COMPLETION_PROBLEM)[keyof typeof COMPLETION_PROBLEM];

/** Whether an answer set is coherent, and whether it is finished. */
export interface CompletionVerdict {
  /** True when the answers are well-formed against this form. */
  readonly isValid: boolean;
  /** True when every REQUIRED question is answered. */
  readonly isComplete: boolean;
  /** Question ids answered that the form does not contain. */
  readonly unknownQuestions: readonly string[];
  /** Question ids given a comment that does not invite one. */
  readonly uninvitedComments: readonly string[];
  /** Required question ids left unanswered. */
  readonly missingRequired: readonly string[];
  /** The first problem found, for a single-message error path. */
  readonly problem: CompletionProblem | null;
}

/**
 * Check an answer set against a form's questions.
 *
 * `isValid` and `isComplete` are SEPARATE, and the distinction is the point:
 *
 *   valid + complete   -> may be SUBMITTED
 *   valid + incomplete -> a legitimate DRAFT
 *   invalid            -> refused, whatever the caller intended
 *
 * A caller asking to finish an incomplete-but-valid set gets `isComplete:
 * false` and decides what to do; a caller handing over an answer to a question
 * that does not exist gets `isValid: false` and has nothing to decide.
 *
 * COMPLEXITY : O(a + q).
 */
export function evaluateCompletion(
  questions: readonly CompletionQuestion[],
  answers: readonly CompletionAnswer[]
): CompletionVerdict {
  const index = new Map<string, CompletionQuestion>();

  for (const question of questions) {
    index.set(question.id, question);
  }

  const unknownQuestions: string[] = [];
  const uninvitedComments: string[] = [];
  const answered = new Set<string>();

  for (const answer of answers) {
    const question = index.get(answer.questionId);

    if (question === undefined) {
      unknownQuestions.push(answer.questionId);
      continue;
    }

    answered.add(answer.questionId);

    // A comment is "given" only when it carries something. An empty string is
    // treated as absent rather than as an uninvited comment — validation
    // already refuses a blank one, and refusing it twice with a different
    // message would be confusing.
    const hasComment =
      typeof answer.comment === "string" && answer.comment.trim().length > 0;

    if (hasComment && !question.allowsComment) {
      uninvitedComments.push(answer.questionId);
    }
  }

  const missingRequired: string[] = [];

  for (const question of questions) {
    if (question.isRequired && !answered.has(question.id)) {
      missingRequired.push(question.id);
    }
  }

  const isValid = unknownQuestions.length === 0 && uninvitedComments.length === 0;
  const isComplete = isValid && missingRequired.length === 0;

  return {
    isValid,
    isComplete,
    unknownQuestions,
    uninvitedComments,
    missingRequired,
    // Ordered by severity: a malformed set is a worse problem than an
    // unfinished one, and a caller rendering one message should see the worse.
    problem:
      unknownQuestions.length > 0
        ? COMPLETION_PROBLEM.UNKNOWN_QUESTION
        : uninvitedComments.length > 0
          ? COMPLETION_PROBLEM.COMMENT_NOT_INVITED
          : missingRequired.length > 0
            ? COMPLETION_PROBLEM.MISSING_REQUIRED
            : null,
  };
}

/**
 * The status an answer set earns.
 *
 * `intendsFinal` is the student's request, not the outcome: asking to finish an
 * incomplete form yields DRAFT, so a client that got its own completeness check
 * wrong saves the student's work instead of losing it. Whether to ALSO raise an
 * error is the service's decision — this module reports what the answers
 * support.
 *
 * COMPLEXITY : O(1).
 */
export function resolveStatus(
  verdict: CompletionVerdict,
  intendsFinal: boolean
): "DRAFT" | "SUBMITTED" {
  return intendsFinal && verdict.isComplete ? "SUBMITTED" : "DRAFT";
}
