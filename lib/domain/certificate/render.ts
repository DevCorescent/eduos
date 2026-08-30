// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Rendering
// LAYER  : Domain (pure)
// PURPOSE: Turn a template plus one student's real record into the finished
//          certificate document.
//
// ONE RENDERER, USED TWICE
//   The builder's preview and the issued certificate both come through here.
//   That is the whole reason the preview can be trusted: if they were two code
//   paths, "what I designed" and "what the graduate received" could differ, and
//   nobody would find out until a document was already in someone's hands. The
//   only difference between the two calls is the values passed in — sample data
//   for the preview, the student's own record at issuance.
//
// SANITISED ON THE WAY OUT, ALWAYS
//   Rendering sanitises. A template is authored HTML and the output is shown to
//   administrators and students, so nothing executable may survive, whether it
//   came from the stored template or from a value substituted into it.
//
// VALUES ARE ESCAPED, MARKUP IS NOT
//   A student's name is text, not markup. It is HTML-escaped before it is
//   substituted, so a record containing "<b>" prints those characters rather
//   than emboldening the rest of the certificate — and a hostile record cannot
//   inject anything through a placeholder.
// ============================================================================

import { sanitiseCertificateCss, sanitiseCertificateHtml } from "./sanitise";

/** The design a certificate is rendered from. */
export interface CertificateDesign {
  readonly html: string;
  readonly css: string | null | undefined;
}

/** Resolved placeholder values — plain text, one per variable key. */
export type CertificateValues = Readonly<Record<string, string>>;

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Escape a value so it is rendered as text.
 *
 * Applied to every substituted value without exception. The five characters
 * below are the ones that can change the meaning of surrounding markup.
 */
export function escapeValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Substitute values into a template body.
 *
 * A placeholder with no value is left EXACTLY as written rather than blanked.
 * On a preview that shows the author their typo; on an issued certificate it
 * makes a missing field obvious instead of producing a silent blank where a
 * qualification should be.
 */
export function substitute(html: string, values: CertificateValues): string {
  return html.replace(PLACEHOLDER, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : escapeValue(value);
  });
}

/**
 * The finished certificate document.
 *
 * INPUT   : the design (a stored template, or the snapshot taken at issuance)
 *           and the resolved values.
 * RETURNS : a complete, self-contained HTML document at A4 portrait, safe to
 *           put in a sandboxed iframe or to print. Never throws.
 *
 * The page box is declared with @page so printing produces A4 with real
 * margins rather than whatever the browser's default happens to be, and
 * print-color-adjust keeps borders and rules from being dropped by "economy"
 * print settings — a certificate with its border silently removed is not the
 * document that was issued.
 */
export function renderCertificateDocument(
  design: CertificateDesign,
  values: CertificateValues
): string {
  // Sanitise BEFORE substituting: a payload cannot hide inside a placeholder
  // and be assembled into a tag afterwards, because values are escaped too.
  const body = substitute(sanitiseCertificateHtml(design.html), values);
  const css = sanitiseCertificateCss(design.css ?? "");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { size: A4 portrait; margin: 0; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #111827;
    font-family: Georgia, "Times New Roman", serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* The paper. Fixed at A4 so the preview, the screen and the print are the
     same document rather than three reflowings of it. */
  .certificate-page {
    box-sizing: border-box;
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    background: #ffffff;
  }
  @media print {
    .certificate-page { width: auto; min-height: auto; margin: 0; }
  }
${css}
</style>
</head>
<body><div class="certificate-page">${body}</div></body>
</html>`;
}
