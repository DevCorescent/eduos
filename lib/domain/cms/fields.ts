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

/** A leaf input. */
export type FieldKind = "text" | "textarea" | "url" | "number" | "select";

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
  fields: readonly LeafField[];
}

/** An array-valued prop, e.g. the items of a card grid. */
export interface ListField {
  kind: "list";
  name: string;
  label: string;
  /** Singular noun for the add button, e.g. "card". */
  itemNoun: string;
  min: number;
  max: number;
  fields: readonly (LeafField | GroupField)[];
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

/**
 * Block type → its editable fields, in the order they should appear.
 *
 * `satisfies` makes this total over CmsBlockType: adding a block type without
 * describing its form is a compile error rather than a block that renders an
 * empty editor panel.
 */
export const BLOCK_FIELDS = {
  hero: [
    { kind: "text", name: "eyebrow", label: "Eyebrow", optional: true, hint: "Small line above the headline, e.g. “Admissions open”." },
    { kind: "text", name: "heading", label: "Headline" },
    { kind: "textarea", name: "subheading", label: "Subheading", optional: true },
    { kind: "url", name: "imageUrl", label: "Background image", optional: true, hint: "Also used as the video's poster while it loads." },
    { kind: "url", name: "videoUrl", label: "Background video", optional: true, hint: "Plays muted and looped. Leave empty to show the image alone." },
    { kind: "group", name: "primaryCta", label: "Primary button", optional: true, fields: CTA_FIELDS },
    { kind: "group", name: "secondaryCta", label: "Secondary button", optional: true, fields: CTA_FIELDS },
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
  ],

  programmes: [
    { kind: "text", name: "heading", label: "Heading" },
    { kind: "textarea", name: "subheading", label: "Subheading", optional: true },
    { kind: "number", name: "limit", label: "How many to show", hint: "Read live from your programmes — nothing to type. Deactivating a programme removes it here automatically." },
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
  ],

  cta: [
    { kind: "text", name: "heading", label: "Heading" },
    { kind: "textarea", name: "body", label: "Supporting text", optional: true },
    { kind: "group", name: "cta", label: "Button", fields: CTA_FIELDS },
  ],

  richText: [
    { kind: "text", name: "heading", label: "Heading", optional: true },
    { kind: "textarea", name: "body", label: "Text", hint: "Plain text. Line breaks are kept; formatting is not." },
  ],
} satisfies Record<CmsBlockType, readonly BlockField[]>;
