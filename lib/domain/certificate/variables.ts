// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Template variables
// LAYER  : Domain (pure)
// PURPOSE: The closed set of {{placeholders}} a certificate template may carry,
//          and the sample values the preview substitutes for them.
//
// WHY A CLOSED SET
//   A template is authored once and rendered against many students. Every
//   placeholder therefore has to correspond to something the issuing flow can
//   actually supply; a typo like {{studentname}} would render as literal braces
//   on an official document that has already been handed to somebody. The
//   picker below is the only way to insert one, and the linter reports any
//   placeholder in a template that is not in this list.
//
// SAMPLE DATA IS OBVIOUSLY SAMPLE DATA
//   The preview substitutes the SAMPLE_VALUES below, which are visibly
//   placeholder — "Sample Student", "CERT-YYYY-0000". They are never written
//   anywhere: the preview is rendered in the browser from the draft and no
//   student record, certificate row or number is created by looking at a
//   template. A real name is not used because a designer working on a template
//   should not be handling anybody's record.
// ============================================================================

/** One placeholder an author may insert. */
export interface CertificateVariable {
  /** The token, without braces. Stable — renaming one breaks saved templates. */
  readonly key: string;
  /** Shown in the picker. */
  readonly label: string;
  /** Which group the picker files it under. */
  readonly category: CertificateVariableCategory;
  /** Stand-in used by the preview. Visibly not real data. */
  readonly sample: string;
}

export type CertificateVariableCategory =
  | "Student"
  | "Academic"
  | "Certificate"
  | "University";

export const CERTIFICATE_VARIABLES: readonly CertificateVariable[] = [
  // --- Student -------------------------------------------------------------
  { key: "studentName", label: "Student name", category: "Student", sample: "Sample Student" },
  { key: "studentId", label: "Student ID", category: "Student", sample: "STU-0000" },
  { key: "enrollmentNo", label: "Enrolment number", category: "Student", sample: "ENR-0000" },
  { key: "studentEmail", label: "Student email", category: "Student", sample: "student@example.edu" },

  // --- Academic ------------------------------------------------------------
  { key: "programName", label: "Programme", category: "Academic", sample: "Sample Programme" },
  { key: "degreeName", label: "Degree", category: "Academic", sample: "Sample Degree" },
  { key: "departmentName", label: "Department", category: "Academic", sample: "Sample Department" },
  { key: "schoolName", label: "School", category: "Academic", sample: "Sample School" },
  { key: "academicYear", label: "Academic year", category: "Academic", sample: "0000-0000" },
  { key: "grade", label: "Grade / result", category: "Academic", sample: "Sample Grade" },
  { key: "duration", label: "Duration", category: "Academic", sample: "0 years" },

  // --- Certificate ---------------------------------------------------------
  {
    key: "certificateId",
    label: "Certificate ID",
    category: "Certificate",
    // Deliberately not a plausible number: the real one comes from the
    // identifier engine at issue time, and a preview must never look like a
    // certificate that exists.
    sample: "CERT-YYYY-0000",
  },
  { key: "issueDate", label: "Issue date", category: "Certificate", sample: "0 Month 0000" },
  { key: "certificateType", label: "Certificate type", category: "Certificate", sample: "Sample Type" },

  // --- University ----------------------------------------------------------
  { key: "universityName", label: "University name", category: "University", sample: "Sample University" },
  { key: "universityAddress", label: "University address", category: "University", sample: "Sample Address" },
  { key: "universityWebsite", label: "University website", category: "University", sample: "example.edu" },
] as const;

export const CERTIFICATE_VARIABLE_CATEGORIES: readonly CertificateVariableCategory[] = [
  "Student",
  "Academic",
  "Certificate",
  "University",
];

const VARIABLE_KEYS = new Set(CERTIFICATE_VARIABLES.map((v) => v.key));

/** True when `key` is a placeholder the issuing flow can supply. */
export function isCertificateVariable(key: string): boolean {
  return VARIABLE_KEYS.has(key);
}

/** The token as it appears in a template. */
export function variableToken(key: string): string {
  return `{{${key}}}`;
}

/**
 * Matches a placeholder and captures its key.
 *
 * Whitespace inside the braces is tolerated — {{ studentName }} is what a
 * person types — and the key itself is restricted to word characters so the
 * pattern cannot run away across a document.
 */
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Every placeholder in a template that this product cannot fill.
 *
 * Returned rather than thrown: an author mid-edit will legitimately have a
 * half-typed token, so this feeds a warning beside the editor rather than a
 * blocked save. Deduplicated and in first-seen order, which is the order an
 * author will find them in.
 */
export function unknownVariables(template: string): string[] {
  const seen = new Set<string>();

  for (const match of template.matchAll(PLACEHOLDER)) {
    const key = match[1];
    if (!isCertificateVariable(key)) seen.add(key);
  }

  return [...seen];
}

/**
 * Substitute the sample values, for the preview only.
 *
 * A placeholder this product does not recognise is left EXACTLY as written. It
 * is not blanked and not guessed at: showing `{{studnetName}}` untouched is how
 * an author sees their typo, and blanking it would hide the very mistake the
 * preview exists to catch.
 *
 * Substitution happens AFTER sanitisation in the preview path, so a sample
 * value can never introduce markup — every value above is plain text anyway.
 */
export function applySampleValues(template: string): string {
  return template.replace(PLACEHOLDER, (whole, key: string) => {
    const variable = CERTIFICATE_VARIABLES.find((v) => v.key === key);
    return variable ? variable.sample : whole;
  });
}
