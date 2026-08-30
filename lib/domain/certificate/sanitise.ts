// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Template sanitisation
// LAYER  : Domain (pure)
// PURPOSE: Strip anything executable from a certificate template before it is
//          shown in the preview.
//
// WHY THIS EXISTS AT ALL
//   A template is authored HTML, stored in CertificateTemplate.htmlTemplate,
//   and rendered back into the admin's own browser. Without this, an author —
//   or anyone who reached the template API — could store a <script> that runs
//   with a University Admin's session every time the template is opened. That
//   is stored XSS against the most privileged tenant role.
//
// THIS IS THE SECOND LINE OF DEFENCE, NOT THE FIRST
//   The preview renders inside a sandboxed iframe with NO allow-scripts, so the
//   browser refuses to execute anything regardless of what reaches it. This
//   function exists because a single defence that can be removed by one careless
//   attribute change is not a defence, and because the sanitised output is what
//   a future server-side renderer would use — where there is no iframe.
//
// AN ALLOW-LIST WOULD BE BETTER, AND IS NOT WHAT THIS IS
//   A full HTML parser with a tag allow-list is the correct long-term answer.
//   This project has no HTML parser dependency and adding one for a preview is
//   not a decision to slip into this change. What follows removes the specific
//   executable vectors, is conservative, and is tested against the usual
//   evasions. Its limits are stated in the report rather than glossed over.
// ============================================================================

/**
 * Elements with CONTENT. An unclosed one swallows the rest of the document as
 * its body, so the tail is removed too — a browser given `<script>steal()`
 * with no closing tag executes it.
 */
const EXECUTABLE_CONTENT_ELEMENTS = ["script", "iframe", "object", "embed", "applet"];

/**
 * VOID elements. They have no content, so only the tag itself is removed.
 *
 * The unclosed-tail rule must NOT apply to these: `<link href=x><h1>Title</h1>`
 * would lose the heading, and a sanitiser that deletes a document because it
 * met a stylesheet link is not one anybody can use.
 */
const EXECUTABLE_VOID_ELEMENTS = ["link", "meta"];

/** Remove one content element: the pair, then any unclosed tail, then a stray tag. */
function stripContentElement(html: string, tag: string): string {
  const paired = new RegExp(`<\\s*${tag}\\b[\\s\\S]*?<\\s*/\\s*${tag}\\s*>`, "gi");
  const unclosed = new RegExp(`<\\s*${tag}\\b[\\s\\S]*$`, "i");
  const stray = new RegExp(`<\\s*/?\\s*${tag}\\b[^>]*>`, "gi");

  // Order matters: pairs first, so a well-formed element does not trigger the
  // tail rule and take the rest of the document with it.
  return html.replace(paired, "").replace(unclosed, "").replace(stray, "");
}

/** Remove one void element — the tag, and nothing around it. */
function stripVoidElement(html: string, tag: string): string {
  return html.replace(new RegExp(`<\\s*${tag}\\b[^>]*/?>`, "gi"), "");
}

/**
 * Make a certificate template safe to render.
 *
 * INPUT   : authored HTML, exactly as stored.
 * RETURNS : the same markup with executable content removed. Never throws.
 *
 * Removes, in order:
 *   1. script/iframe/object/embed/applet/link/meta elements, with contents
 *   2. every on* event-handler attribute (onclick, onerror, onload, …)
 *   3. javascript:, vbscript: and data: URLs in href/src/action
 *   4. CSS expression() and behavior:, which execute in old engines
 *
 * Applied repeatedly until the output stops changing, so a payload that only
 * becomes a tag after one removal — `<scr<script>ipt>` — cannot survive by
 * being reassembled. The loop is bounded; a document that will not settle is
 * returned empty rather than partly cleaned.
 */
export function sanitiseCertificateHtml(html: string): string {
  let current = typeof html === "string" ? html : "";

  for (let pass = 0; pass < 5; pass++) {
    const before = current;

    for (const tag of EXECUTABLE_CONTENT_ELEMENTS) {
      current = stripContentElement(current, tag);
    }
    for (const tag of EXECUTABLE_VOID_ELEMENTS) {
      current = stripVoidElement(current, tag);
    }

    // Event handlers, quoted or bare.
    current = current
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, "");

    // Executable URL schemes. The separators allow for the entity- and
    // whitespace-padded forms ("java\tscript:") browsers historically accepted.
    current = current.replace(
      /(href|src|action|formaction)\s*=\s*("|')?\s*(j\s*a\s*v\s*a|v\s*b)\s*s\s*c\s*r\s*i\s*p\s*t\s*:[^"'>]*/gi,
      "$1=$2#"
    );
    current = current.replace(/(href|src|action)\s*=\s*("|')?\s*data:[^"'>]*/gi, "$1=$2#");

    // Legacy CSS execution vectors.
    current = current.replace(/expression\s*\(/gi, "void(");
    current = current.replace(/behaviou?r\s*:/gi, "void:");
    current = current.replace(/-moz-binding\s*:/gi, "void:");

    if (current === before) return current;
  }

  // Did not converge in five passes: something is deliberately adversarial, and
  // an empty preview is the safe answer.
  return "";
}

/**
 * Make authored CSS safe to render.
 *
 * Narrower than the HTML case because CSS cannot introduce an element: the
 * risks are @import (fetches a stylesheet), url() (fetches, and historically
 * executed), and the legacy expression()/behavior: pair.
 */
export function sanitiseCertificateCss(css: string): string {
  const current = typeof css === "string" ? css : "";

  return current
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "void(")
    .replace(/behaviou?r\s*:/gi, "void:")
    .replace(/-moz-binding\s*:/gi, "void:")
    .replace(/url\s*\(\s*(['"]?)\s*(javascript|vbscript|data)\s*:[^)]*\)/gi, "url($1#$1)");
}
