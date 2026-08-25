// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Institution Token Substitution (W4c, PRD §5.1, §7)
// LAYER  : Domain (pure)
// PURPOSE: Replace `{{institution}}` in a template's blocks with a real name.
//
// MOVED OUT OF THE SEED SO THE PREVIEW CAN USE IT TOO
//   Onboarding substitutes when it copies the template into a university's
//   page; the platform's template preview substitutes a placeholder so an
//   operator reads a page rather than a mail-merge source. Both must produce
//   the same result, which they can only be relied on to do if they run the
//   same function.
//
// A TOKEN RATHER THAN A PARAMETERISED BUILDER
//   The template is DATA — a platform operator edits it through the CMS — so
//   whatever they save has to go through the same substitution as the seeded
//   literal does. A builder function could only substitute into blocks it had
//   been written to know about.
// ============================================================================

import { blocksSchema, type CmsBlocks } from "./blocks";

/** The token an editor writes in the template. */
export const INSTITUTION_TOKEN = "{{institution}}";

/**
 * Substitute the institution's name into a copy of the blocks.
 *
 * Walks the tree over JSON rather than field by field, so a template edited in
 * the CMS — carrying blocks this function has never seen — is substituted just
 * the same.
 *
 * RE-VALIDATED AFTERWARDS, because a long institution name can push a string
 * past its schema bound. Failing here, where the caller can report it, beats
 * failing on a live homepage.
 */
export function applyInstitutionName(blocks: CmsBlocks, institution: string): CmsBlocks {
  const substituted: unknown = JSON.parse(
    JSON.stringify(blocks).replaceAll(INSTITUTION_TOKEN, institution)
  );

  return blocksSchema.parse(substituted);
}
