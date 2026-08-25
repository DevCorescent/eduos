"use client";

// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Field Controls (W4c, PRD §7.3)
// LAYER  : Presentation (client)
// PURPOSE: Render one field of any kind from lib/domain/cms/fields.ts, and the
//          two path helpers that let it write back into a nested value.
//
// EXTRACTED FROM BlockEditor SO THE CHROME EDITOR CAN USE IT
//   The navigation bar is a list of items, each with a nested list of dropdown
//   links; the footer is a list of columns, each with a nested list of links.
//   That is the same recursion the block editor already does, so it is the same
//   component — a second implementation would be a second place for "remove is
//   disabled at the minimum" to be got wrong.
//
// RECURSIVE BY PATH, NOT BY STATE
//   Nothing here holds state. Every control receives the path to its own value
//   and calls one `onChange` with that path, so the owner keeps a single value
//   object and there are no per-field handlers to wire up. The path grows as
//   the tree descends, which is what makes a list inside a list inside a form
//   work with no extra code.
// ============================================================================

import { Plus, Trash2 } from "lucide-react";
import type { BlockField } from "@/lib/domain/cms/fields";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/lib/utils";

// --- Path helpers -----------------------------------------------------------

/** Immutably set `value` at `path` within an object. */
export function setAt(
  source: Record<string, unknown>,
  path: readonly (string | number)[],
  value: unknown
): Record<string, unknown> {
  if (path.length === 0) return value as Record<string, unknown>;

  const [head, ...rest] = path;

  if (typeof head === "number") {
    const list = Array.isArray(source) ? [...(source as unknown[])] : [];
    list[head] = setAt((list[head] ?? {}) as Record<string, unknown>, rest, value);
    return list as unknown as Record<string, unknown>;
  }

  return {
    ...source,
    [head]: setAt((source[head] ?? {}) as Record<string, unknown>, rest, value),
  };
}

/** Read the value at `path`, or undefined. */
export function getAt(source: unknown, path: readonly (string | number)[]): unknown {
  return path.reduce<unknown>(
    (acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key as string]),
    source
  );
}

export type FieldChange = (path: (string | number)[], value: unknown) => void;

// --- Small controls ---------------------------------------------------------

export function IconButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
        destructive && "hover:bg-danger-bg hover:text-danger-bg-foreground"
      )}
    >
      {children}
    </button>
  );
}

/**
 * A colour, as a swatch beside the hex it stands for.
 *
 * BOTH CONTROLS WRITE THE SAME VALUE, and both are needed. The swatch is how
 * somebody picks a colour they are choosing; the text box is how somebody
 * enters the one their brand guideline already specifies. A picker alone makes
 * "#1E3A8A, exactly" a game of nudging a gradient.
 *
 * EMPTY IS A REAL STATE, which is why "Clear" exists. Unset means this section
 * inherits — including a site-wide change made later — and a colour input has
 * no way to express "none": it always reports something, defaulting to black.
 * Without an explicit clear, an editor who opened the picker to look could
 * never get back to inheriting.
 */
function ColorControl({
  label,
  hint,
  value,
  path,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  path: (string | number)[];
  onChange: FieldChange;
}) {
  // <input type="color"> accepts only #rrggbb. A stored #abc or an empty field
  // would make it silently show black, so the swatch falls back to the brand
  // indigo while the text box keeps showing what is actually stored.
  const swatch = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#4f46e5";

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-foreground">{label}</label>

      <div className="flex items-center gap-2">
        <input
          type="color"
          value={swatch}
          aria-label={`${label} — colour picker`}
          onChange={(event) => onChange(path, event.target.value)}
          className="size-10 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-1"
        />

        <input
          type="text"
          value={value}
          placeholder="Inherit"
          spellCheck={false}
          aria-label={`${label} — hex value`}
          onChange={(event) => onChange(path, event.target.value.trim() || undefined)}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {value && (
          <Button variant="outlined" size="sm" onClick={() => onChange(path, undefined)}>
            Clear
          </Button>
        )}
      </div>

      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// --- The recursive control --------------------------------------------------

/**
 * One field of any kind, resolved from its spec.
 *
 * Recursive: a `group` renders its own leaves, and a `list` renders a numbered
 * set of item panels each containing leaves, groups and — for the navigation
 * bar's dropdowns — further lists.
 */
export function FieldControl({
  field,
  path,
  value,
  onChange,
}: {
  field: BlockField;
  path: (string | number)[];
  value: unknown;
  onChange: FieldChange;
}) {
  if (field.kind === "group") {
    return (
      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {field.label}
          {field.optional && " (optional)"}
        </legend>
        <div className="space-y-3">
          {field.fields.map((sub) => (
            <FieldControl
              key={sub.name}
              field={sub}
              path={[...path, sub.name]}
              value={getAt(value, [sub.name])}
              onChange={onChange}
            />
          ))}
        </div>
      </fieldset>
    );
  }

  if (field.kind === "list") {
    const items = Array.isArray(value) ? value : [];

    return (
      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {field.label}
        </legend>

        <ul className="space-y-3">
          {items.map((item, index) => (
            <li key={index} className="rounded-lg bg-muted/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {field.itemNoun} {index + 1}
                </span>

                <div className="flex items-center gap-1">
                  <IconButton
                    label={`Move ${field.itemNoun} ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => onChange(path, swap(items, index, index - 1))}
                  >
                    <span aria-hidden="true" className="block text-xs leading-4">
                      ↑
                    </span>
                  </IconButton>
                  <IconButton
                    label={`Move ${field.itemNoun} ${index + 1} down`}
                    disabled={index === items.length - 1}
                    onClick={() => onChange(path, swap(items, index, index + 1))}
                  >
                    <span aria-hidden="true" className="block text-xs leading-4">
                      ↓
                    </span>
                  </IconButton>
                  <IconButton
                    label={`Remove ${field.itemNoun} ${index + 1}`}
                    destructive
                    // The schema's own minimum, enforced in the UI so the reader
                    // cannot reach a state the server would reject.
                    disabled={items.length <= field.min}
                    onClick={() => onChange(path, items.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </div>

              <div className="space-y-3">
                {field.fields.map((sub) => (
                  <FieldControl
                    key={sub.name}
                    field={sub}
                    path={[...path, index, sub.name]}
                    value={getAt(item, [sub.name])}
                    onChange={onChange}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>

        {items.length < field.max && (
          <Button
            variant="outlined"
            size="sm"
            className="mt-3"
            leftIcon={<Plus className="size-4" />}
            onClick={() => onChange(path, [...items, {}])}
          >
            Add {field.itemNoun}
          </Button>
        )}
      </fieldset>
    );
  }

  const label = field.optional ? `${field.label} (optional)` : field.label;
  const text = typeof value === "string" ? value : value == null ? "" : String(value);

  if (field.kind === "color") {
    return (
      <ColorControl
        label={label}
        hint={field.hint}
        value={text}
        path={path}
        onChange={onChange}
      />
    );
  }

  if (field.kind === "textarea") {
    return (
      <Textarea
        label={label}
        helperText={field.hint}
        value={text}
        rows={3}
        onChange={(event) => onChange(path, event.target.value || undefined)}
      />
    );
  }

  if (field.kind === "select") {
    return (
      <Select
        label={label}
        helperText={field.hint}
        value={text}
        // Select is controlled and hands back the VALUE, not an event.
        onChange={(next) => {
          // Numeric selects (a column count) must not be stored as strings —
          // the schema expects a literal number and would reject "3".
          // Boolean selects ("true"/"false") likewise must become real booleans.
          if (next === "true") {
            onChange(path, true);
            return;
          }
          if (next === "false") {
            onChange(path, false);
            return;
          }
          const parsed = /^\d+$/.test(next) ? Number(next) : next || undefined;
          onChange(path, parsed);
        }}
        options={(field.options ?? []).map((option) => ({
          value: option.value,
          label: option.label,
        }))}
      />
    );
  }

  return (
    <Input
      label={label}
      helperText={field.hint}
      type={field.kind === "number" ? "number" : "text"}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        if (field.kind === "number") {
          onChange(path, next === "" ? undefined : Number(next));
          return;
        }
        onChange(path, next || undefined);
      }}
    />
  );
}

/** Reorder within a list. Returns a new array; the original is untouched. */
function swap(items: readonly unknown[], from: number, to: number): unknown[] {
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
