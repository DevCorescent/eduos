// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Editor Field Specification (W4, PRD §7.3)
// LAYER  : Domain (pure)
// PURPOSE: Describe each block's props as a form, so one editor component can
//          edit twelve block types without knowing what any of them are.
//
// WHY A HAND-WRITTEN SPEC AND NOT ZOD INTROSPECTION
//   Walking the Zod schema to generate a form is possible and tempting, and it
//   produces a bad form. A schema knows a field is `z.string().max(2000)`; it
//   does not know that it should be a textarea, that its label is "Subheading",
//   or that it belongs after the heading. Those are editorial decisions with no
//   representation in a validator.
//
//   So the spec is written once, beside the schema it describes. The COST is
//   that adding a prop means editing two files; the check on that is that a
//   field missing from this spec simply is not editable, while a field that
//   contradicts the schema is caught by validation on save — loudly, in the
//   editor, before anything is stored.
//
// PURE: no React. The editor renders these; nothing here knows how.
// ============================================================================

import { BLOCK_ICONS, type CmsBlockType } from "./blocks";
import { ENQUIRE_ICONS, SOCIAL_PLATFORMS } from "./site";
import {
  FONT_WEIGHTS,
  SCALE_LABELS,
  TEXT_SCALES,
  WEIGHT_LABELS,
} from "./typography";

/**
 * A leaf input.
 *
 * `color` is its own kind rather than a `text` field with a hint, because the
 * value it collects is a hex string and asking an editor to type one is asking
 * them to fail validation. The editor pairs a native swatch with the text so a
 * brand guideline's `#1E3A8A` can still be pasted.
 */
export type FieldKind = "text" | "textarea" | "url" | "number" | "select" | "color";

export interface LeafField {
  kind: FieldKind;
  /** Key within the props object, or within a list item. */
  name: string;
  label: string;
  /** Shown under the input. Use it to say what the field DOES, not what it is. */
  hint?: string;
  /** A field the schema marks optional. Rendered without a required marker. */
  optional?: boolean;
  /** For `select` only. */
  options?: readonly { value: string; label: string }[];
}

/** An object-valued prop, e.g. a call-to-action's label and href. */
export interface GroupField {
  kind: "group";
  name: string;
  label: string;
  optional?: boolean;
  /**
   * Leaves, and — for chrome like the enquire dock — nested lists.
   * FieldControl already recurses, so admitting BlockField here costs nothing
   * beyond letting an enquire-items list sit beside its enabled toggle.
   */
  fields: readonly BlockField[];
}

/**
 * An array-valued prop, e.g. the items of a card grid.
 *
 * `fields` admits another ListField, so a list can contain lists. That is not
 * generality for its own sake: the navigation bar is a list of menu items each
 * holding a list of dropdown links, and the footer is a list of columns each
 * holding a list of links. FieldControl already recurses by path, so nesting
 * costs nothing beyond widening this type.
 */
export interface ListField {
  kind: "list";
  name: string;
  label: string;
  /** Singular noun for the add button, e.g. "card". */
  itemNoun: string;
  min: number;
  max: number;
  fields: readonly BlockField[];
}

export type BlockField = LeafField | GroupField | ListField;

/** The icon picker's options, derived from the enum so the two cannot drift. */
const ICON_OPTIONS = BLOCK_ICONS.map((value) => ({
  value,
  // "graduation-cap" → "Graduation cap". Derived rather than hand-listed: a new
  // icon needs no second edit here, and no label can go stale.
  label: value.charAt(0).toUpperCase() + value.slice(1).replaceAll("-", " "),
}));

const ICON_FIELD: LeafField = {
  kind: "select",
  name: "icon",
  label: "Icon",
  optional: true,
  options: [{ value: "", label: "No icon" }, ...ICON_OPTIONS],
};

/** Enquire-dock icon picker — closed set, same reason as block icons. */
const ENQUIRE_ICON_OPTIONS = ENQUIRE_ICONS.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1).replaceAll("-", " "),
}));

const ENQUIRE_ICON_FIELD: LeafField = {
  kind: "select",
  name: "icon",
  label: "Icon",
  optional: true,
  options: [{ value: "", label: "No icon" }, ...ENQUIRE_ICON_OPTIONS],
};

/** The link fields every call-to-action shares. */
const CTA_FIELDS: readonly LeafField[] = [
  { kind: "text", name: "label", label: "Button text" },
  {
    kind: "url",
    name: "href",
    label: "Links to",
    hint: "A path like /admissions, an #anchor, or an https:// address.",
  },
];

// --- Typography -------------------------------------------------------------

/** Options derived from the vocabularies, so a new step needs no edit here. */
const SCALE_OPTIONS = [
  { value: "", label: "Inherit" },
  ...TEXT_SCALES.map((value) => ({ value, label: SCALE_LABELS[value] })),
];

const WEIGHT_OPTIONS = [
  { value: "", label: "Inherit" },
  ...FONT_WEIGHTS.map((value) => ({ value, label: WEIGHT_LABELS[value] })),
];

/**
 * The six typography controls, on every block.
 *
 * "INHERIT" IS THE FIRST OPTION AND THE EMPTY ONE, NOT "DEFAULT"
 *   An unset control means this section takes whatever the site is set to —
 *   including a site-wide change made afterwards. Labelling it "Default" would
 *   suggest it pins the value, which is the opposite of what it does.
 *
 * Declared once and spread into every block's spec below, so the controls sit
 * in the same place, in the same order, on all eleven.
 */
const STYLE_FIELD: GroupField = {
  kind: "group",
  name: "style",
  label: "Text style for this section",
  optional: true,
  fields: [
    { kind: "color", name: "headingColor", label: "Heading colour", optional: true },
    { kind: "select", name: "headingScale", label: "Heading size", optional: true, options: SCALE_OPTIONS },
    { kind: "select", name: "headingWeight", label: "Heading weight", optional: true, options: WEIGHT_OPTIONS },
    { kind: "color", name: "bodyColor", label: "Text colour", optional: true },
    { kind: "select", name: "bodyScale", label: "Text size", optional: true, options: SCALE_OPTIONS },
    { kind: "select", name: "bodyWeight", label: "Text weight", optional: true, options: WEIGHT_OPTIONS },
  ],
};

/**
 * One hero panel's fields.
 *
 * Shared between the block's own first panel and each extra carousel panel, so
 * the two can never offer different controls — which is exactly what would
 * happen if a field were added to one list and forgotten in the other.
 */
const HERO_SLIDE_FIELDS: readonly (LeafField | GroupField)[] = [
  { kind: "text", name: "eyebrow", label: "Eyebrow", optional: true, hint: "Small line above the headline, e.g. “Admissions open”." },
  { kind: "text", name: "heading", label: "Headline" },
  { kind: "textarea", name: "subheading", label: "Subheading", optional: true },
  { kind: "url", name: "imageUrl", label: "Background image", optional: true, hint: "Also used as the video's poster while it loads." },
  { kind: "url", name: "videoUrl", label: "Background video", optional: true, hint: "Plays muted and looped. Leave empty to show the image alone." },
  { kind: "group", name: "primaryCta", label: "Primary button", optional: true, fields: CTA_FIELDS },
  { kind: "group", name: "secondaryCta", label: "Secondary button", optional: true, fields: CTA_FIELDS },
];

/**
 * Block type → its editable fields, in the order they should appear.
 *
 * `satisfies` makes this total over CmsBlockType: adding a block type without
 * describing its form is a compile error rather than a block that renders an
 * empty editor panel.
 */
export const BLOCK_FIELDS = {
  hero: [
    {
      kind: "select", name: "layout", label: "Hero style",
      hint: "Carousel rotates through the panels below. One panel shows only the first.",
      options: [
        { value: "single", label: "One panel" },
        { value: "carousel", label: "Carousel" },
      ],
    },
    ...HERO_SLIDE_FIELDS,
    {
      kind: "list", name: "slides", label: "Extra carousel panels", itemNoun: "panel", min: 0, max: 5,
      fields: HERO_SLIDE_FIELDS,
    },
    { kind: "number", name: "autoplaySeconds", label: "Seconds per panel", hint: "Between 3 and 20. Ignored when the hero shows one panel." },
    {
      kind: "select", name: "align", label: "Text position",
      options: [
        { value: "left", label: "Left" },
        { value: "center", label: "Centred" },
      ],
    },
    {
      kind: "select", name: "height", label: "Panel height",
      options: [
        { value: "compact", label: "Compact" },
        { value: "standard", label: "Standard" },
        { value: "tall", label: "Tall" },
      ],
    },
    STYLE_FIELD,
  ],

  stats: [
    { kind: "text", name: "heading", label: "Heading", optional: true },
    {
      kind: "list", name: "items", label: "Figures", itemNoun: "figure", min: 1, max: 6,
      fields: [
        { kind: "text", name: "value", label: "Figure", hint: "Written exactly as it should read: “94%”, “₹9.4 LPA”, “180+”." },
        { kind: "text", name: "label", label: "Caption" },
      ],
    },
    STYLE_FIELD,
  ],

  programmes: [
    { kind: "text", name: "heading", label: "Heading" },
    { kind: "textarea", name: "subheading", label: "Subheading", optional: true },
    { kind: "number", name: "limit", label: "How many to show", hint: "Read live from your programmes — nothing to type. Deactivating a programme removes it here automatically." },
    STYLE_FIELD,
  ],

  features: [
    { kind: "text", name: "heading", label: "Heading" },
    { kind: "textarea", name: "subheading", label: "Subheading", optional: true },
    {
      kind: "list", name: "items", label: "Points", itemNoun: "point", min: 1, max: 8,
      fields: [
        { kind: "text", name: "title", label: "Title" },
        { kind: "textarea", name: "body", label: "Description" },
        ICON_FIELD,
      ],
    },
    STYLE_FIELD,
  ],

  cardGrid: [
    { kind: "text", name: "heading", label: "Heading" },
    { kind: "textarea", name: "subheading", label: "Subheading", optional: true },
    {
      kind: "select", name: "columns", label: "Cards per row",
      options: [
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        { value: "4", label: "4" },
      ],
    },
    {
      kind: "list", name: "items", label: "Cards", itemNoun: "card", min: 1, max: 12,
      fields: [
        { kind: "text", name: "title", label: "Title" },
        { kind: "textarea", name: "body", label: "Description", optional: true },
        { kind: "url", name: "imageUrl", label: "Image", optional: true },
        { kind: "group", name: "link", label: "Link", optional: true, fields: CTA_FIELDS },
      ],
    },
    STYLE_FIELD,
  ],

  linkGrid: [
    { kind: "text", name: "heading", label: "Heading" },
    { kind: "textarea", name: "subheading", label: "Supporting text", optional: true },
    {
      kind: "list", name: "items", label: "Tiles", itemNoun: "tile", min: 1, max: 16,
      fields: [
        { kind: "text", name: "label", label: "Label" },
        { kind: "url", name: "href", label: "Links to", optional: true },
        ICON_FIELD,
      ],
    },
    STYLE_FIELD,
  ],

  splitBand: [
    {
      kind: "list", name: "stats", label: "Figures", itemNoun: "figure", min: 1, max: 3,
      fields: [
        { kind: "text", name: "value", label: "Figure" },
        { kind: "text", name: "label", label: "Caption" },
      ],
    },
    { kind: "textarea", name: "message", label: "Message" },
    { kind: "group", name: "cta", label: "Button", optional: true, fields: CTA_FIELDS },
    STYLE_FIELD,
  ],

  testimonials: [
    { kind: "text", name: "heading", label: "Heading" },
    {
      kind: "list", name: "items", label: "Quotes", itemNoun: "quote", min: 1, max: 8,
      fields: [
        { kind: "textarea", name: "quote", label: "Quote" },
        { kind: "text", name: "name", label: "Name" },
        { kind: "text", name: "role", label: "Role", optional: true, hint: "e.g. “B.Tech, Computer Science” or “Alumnus, 2025”." },
      ],
    },
    STYLE_FIELD,
  ],

  placements: [
    { kind: "text", name: "heading", label: "Heading" },
    { kind: "textarea", name: "subheading", label: "Subheading", optional: true },
    {
      kind: "list", name: "stats", label: "Placement figures", itemNoun: "figure", min: 1, max: 4,
      fields: [
        { kind: "text", name: "value", label: "Figure", hint: "e.g. “24,000+ Placements” or “94%”." },
        { kind: "textarea", name: "body", label: "Supporting text" },
        ICON_FIELD,
      ],
    },
    {
      kind: "list", name: "partners", label: "Recruiting partners", itemNoun: "partner", min: 0, max: 12,
      fields: [
        { kind: "text", name: "name", label: "Name" },
        { kind: "url", name: "logoUrl", label: "Logo", optional: true },
      ],
    },
    {
      kind: "list", name: "students", label: "Placed students (carousel)", itemNoun: "student", min: 1, max: 24,
      fields: [
        { kind: "text", name: "name", label: "Student name" },
        { kind: "text", name: "company", label: "Company" },
        { kind: "text", name: "programme", label: "Programme", optional: true },
        { kind: "url", name: "imageUrl", label: "Student photo", optional: true },
        { kind: "url", name: "companyLogoUrl", label: "Company logo", optional: true },
      ],
    },
    { kind: "number", name: "autoplaySeconds", label: "Seconds per slide", hint: "Between 3 and 20." },
    { kind: "group", name: "cta", label: "Button", optional: true, fields: CTA_FIELDS },
    STYLE_FIELD,
  ],

  faq: [
    { kind: "text", name: "heading", label: "Heading" },
    {
      kind: "list", name: "items", label: "Questions", itemNoun: "question", min: 1, max: 12,
      fields: [
        { kind: "text", name: "question", label: "Question" },
        { kind: "textarea", name: "answer", label: "Answer" },
      ],
    },
    STYLE_FIELD,
  ],

  cta: [
    { kind: "text", name: "heading", label: "Heading" },
    { kind: "textarea", name: "body", label: "Supporting text", optional: true },
    { kind: "group", name: "cta", label: "Button", fields: CTA_FIELDS },
    STYLE_FIELD,
  ],

  richText: [
    { kind: "text", name: "heading", label: "Heading", optional: true },
    { kind: "textarea", name: "body", label: "Text", hint: "Plain text. Line breaks are kept; formatting is not." },
    STYLE_FIELD,
  ],
} satisfies Record<CmsBlockType, readonly BlockField[]>;

// ============================================================================
// SITE CHROME
// ============================================================================
// The header, footer, contact block and site-wide typography — everything that
// wraps a page rather than sitting in it.
//
// SAME SPEC LANGUAGE AS A BLOCK, SO THE SAME EDITOR RENDERS IT
//   The navigation bar is a list of items each holding a list of dropdown
//   links; the footer is a list of columns each holding a list of links. That
//   is the recursion FieldControl already performs, so there is no second form
//   implementation and no second place for "remove is disabled at the minimum"
//   to be got wrong.

/** A link, wherever one is edited. */
const LINK_FIELDS: readonly LeafField[] = [
  { kind: "text", name: "label", label: "Label" },
  {
    kind: "url",
    name: "href",
    label: "Links to",
    hint: "A path like /admissions, an #anchor, or an https:// address.",
  },
];

/**
 * Navigation, footer and social accounts.
 *
 * Shared by the tenant's own chrome editor and the platform's template chrome
 * editor, because they edit the same shapes — the difference is only which row
 * they land in.
 */
const NAV_AND_FOOTER_FIELDS: readonly BlockField[] = [
  {
    kind: "list", name: "navItems", label: "Navigation bar", itemNoun: "menu item", min: 0, max: 10,
    fields: [
      ...LINK_FIELDS,
      {
        kind: "list", name: "children", label: "Dropdown (opens on hover)", itemNoun: "dropdown link", min: 0, max: 8,
        fields: [
          ...LINK_FIELDS,
          {
            kind: "text", name: "description", label: "Description", optional: true,
            hint: "A short second line under the link, e.g. “Four-year degrees”.",
          },
        ],
      },
    ],
  },
  {
    kind: "list", name: "footerColumns", label: "Footer columns", itemNoun: "column", min: 0, max: 4,
    fields: [
      { kind: "text", name: "heading", label: "Heading" },
      {
        kind: "list", name: "links", label: "Links", itemNoun: "link", min: 1, max: 10,
        fields: LINK_FIELDS,
      },
    ],
  },
  {
    kind: "list", name: "socialLinks", label: "Social accounts", itemNoun: "account", min: 0, max: 6,
    fields: [
      {
        kind: "select", name: "platform", label: "Platform",
        // Derived from the enum the footer's icon map is keyed by, so a platform
        // that can be chosen here always has a glyph to draw.
        options: SOCIAL_PLATFORMS.map((value) => ({
          value,
          label: value === "x" ? "X" : value.charAt(0).toUpperCase() + value.slice(1),
        })),
      },
      { kind: "url", name: "href", label: "Address", hint: "The full https:// address of the account." },
    ],
  },
];

/**
 * The optional enquire dock — a bottom-right action cluster, not a mid-page rail.
 *
 * WHY BOTTOM-RIGHT AND NOT THE REFERENCE'S VERTICAL STRIP
 *   A sticky mid-right column covers carousel controls and body copy on every
 *   section it scrolls past. A collapsed FAB in the thumb zone stays out of the
 *   way until opened, and on phones it does not steal horizontal space from the
 *   page. Institutions that do not want it turn `enabled` off.
 */
const ENQUIRE_RAIL_FIELD: GroupField = {
  kind: "group",
  name: "enquireRail",
  label: "Enquire dock (optional)",
  optional: true,
  fields: [
    {
      kind: "select",
      name: "enabled",
      label: "Show on the public site",
      hint: "Off by default. When on, a compact button sits at the bottom-right and opens these links.",
      options: [
        { value: "false", label: "Hidden" },
        { value: "true", label: "Visible" },
      ],
    },
    {
      kind: "text",
      name: "label",
      label: "Button label",
      hint: "Shown on the closed button, e.g. “Enquire Now”.",
    },
    {
      kind: "list",
      name: "items",
      label: "Quick actions",
      itemNoun: "action",
      min: 0,
      max: 8,
      fields: [
        { kind: "text", name: "label", label: "Label" },
        {
          kind: "url",
          name: "href",
          label: "Links to",
          hint: "A path, mailto:, https://, or a WhatsApp link.",
        },
        ENQUIRE_ICON_FIELD,
      ],
    },
  ],
};

/** Site-wide type — the same six controls a section can override. */
const SITE_TYPOGRAPHY_FIELD: GroupField = {
  ...STYLE_FIELD,
  name: "typography",
  label: "Site-wide text style",
};

/** What a UNIVERSITY edits on its own website. */
export const SITE_CHROME_FIELDS: readonly BlockField[] = [
  ...NAV_AND_FOOTER_FIELDS,
  ENQUIRE_RAIL_FIELD,
  { kind: "textarea", name: "contactAddress", label: "Address", optional: true },
  { kind: "text", name: "contactPhone", label: "Phone", optional: true },
  { kind: "text", name: "contactEmail", label: "Email", optional: true },
  SITE_TYPOGRAPHY_FIELD,
];

/**
 * What the PLATFORM edits on the shared template.
 *
 * NO CONTACT DETAILS, deliberately. An address, a phone number and an email are
 * facts about one institution; seeding every new university with a placeholder
 * address is how a real one ends up published on a live homepage.
 */
export const TEMPLATE_CHROME_FIELDS: readonly BlockField[] = [
  ...NAV_AND_FOOTER_FIELDS,
  ENQUIRE_RAIL_FIELD,
  SITE_TYPOGRAPHY_FIELD,
];
