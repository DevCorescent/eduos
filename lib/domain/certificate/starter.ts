// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Starter template
// LAYER  : Domain (pure)
// PURPOSE: The markup a new certificate template opens on.
//
// WHY A STARTER RATHER THAN AN EMPTY BOX
//   An empty textarea is not a starting point for anybody who has not written
//   certificate markup before, and the first thing an author needs to see is
//   how a placeholder is written. This demonstrates the {{token}} syntax the
//   picker inserts, in a layout that already looks like a document.
//
// WHAT IT DELIBERATELY DOES NOT CONTAIN
//   No seal, no signature image, no crest, no accreditation line, and no
//   university name — every one of those would be a claim this product is not
//   entitled to make on an institution's behalf. The university's own name
//   arrives through {{universityName}} at issue time, and any emblem is a URL
//   the administrator supplies from their own assets.
//
//   The signature areas are RULED LINES with a role beneath them. A ruled line
//   is a place for a signature; a drawn squiggle would be a forged one.
// ============================================================================

/** Opening content for a new template. */
export const STARTER_TEMPLATE = {
  html: [
    '<div class="certificate">',
    '  <header class="certificate__head">',
    '    <p class="certificate__institution">{{universityName}}</p>',
    '    <p class="certificate__address">{{universityAddress}}</p>',
    "  </header>",
    "",
    '  <hr class="certificate__rule" />',
    "",
    '  <h1 class="certificate__title">Certificate of Completion</h1>',
    "",
    '  <p class="certificate__lead">This is to certify that</p>',
    '  <p class="certificate__recipient">{{studentName}}</p>',
    '  <p class="certificate__lead">has successfully completed</p>',
    '  <p class="certificate__subject">{{programName}}</p>',
    '  <p class="certificate__lead">',
    "    in the Department of {{departmentName}} during the academic year {{academicYear}},",
    "    achieving {{grade}}.",
    "  </p>",
    "",
    '  <dl class="certificate__meta">',
    "    <div><dt>Certificate ID</dt><dd>{{certificateId}}</dd></div>",
    "    <div><dt>Enrolment number</dt><dd>{{enrollmentNo}}</dd></div>",
    "    <div><dt>Date of issue</dt><dd>{{issueDate}}</dd></div>",
    "  </dl>",
    "",
    '  <footer class="certificate__signatures">',
    '    <div class="certificate__signature"><span></span><p>Registrar</p></div>',
    '    <div class="certificate__signature"><span></span><p>Dean</p></div>',
    "  </footer>",
    "</div>",
  ].join("\n"),

  css: [
    "/* A4 portrait proportions, printed rather than screen-shaped. */",
    ".certificate {",
    "  box-sizing: border-box;",
    "  min-height: 100%;",
    "  padding: 56px 64px;",
    "  border: 2px solid #1f2937;",
    "  outline: 1px solid #1f2937;",
    "  outline-offset: 6px;",
    "  text-align: center;",
    "  color: #111827;",
    "}",
    "",
    ".certificate__institution { margin: 0; font-size: 22px; letter-spacing: 0.08em; text-transform: uppercase; }",
    ".certificate__address { margin: 4px 0 0; font-size: 12px; color: #4b5563; }",
    ".certificate__rule { margin: 24px auto; width: 96px; border: 0; border-top: 2px solid #1f2937; }",
    "",
    ".certificate__title { margin: 0 0 28px; font-size: 26px; letter-spacing: 0.14em; text-transform: uppercase; }",
    ".certificate__lead { margin: 10px 0; font-size: 13px; color: #374151; }",
    ".certificate__recipient { margin: 12px 0; font-size: 30px; }",
    ".certificate__subject { margin: 12px 0; font-size: 18px; font-style: italic; }",
    "",
    ".certificate__meta { display: flex; justify-content: center; gap: 36px; margin: 34px 0 0; font-size: 11px; }",
    ".certificate__meta dt { color: #6b7280; letter-spacing: 0.04em; text-transform: uppercase; }",
    ".certificate__meta dd { margin: 2px 0 0; }",
    "",
    "/* Ruled lines to sign ON. Never a drawn signature. */",
    ".certificate__signatures { display: flex; justify-content: space-around; margin-top: 52px; }",
    ".certificate__signature span { display: block; width: 168px; border-top: 1px solid #1f2937; }",
    ".certificate__signature p { margin: 6px 0 0; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }",
  ].join("\n"),
} as const;
