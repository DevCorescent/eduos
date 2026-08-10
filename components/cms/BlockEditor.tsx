"use client";

// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Block Editor (W4, PRD §7.3)
// LAYER  : Presentation (client)
// PURPOSE: Edit an ordered list of blocks, whoever is editing and whatever they
//          are editing.
//
// ONE COMPONENT, THREE SURFACES
//   A university admin editing their own site, a platform operator editing a
//   university's site, and the same operator editing the shared template all
//   manipulate the same array. The DIFFERENCE between them is authorization and
//   which endpoint receives the result — neither of which belongs in an editor.
//   So this takes an `onSave` and an optional `onPublish` and knows nothing
//   about who is calling it.
//
// NOT DRAG-AND-DROP, DELIBERATELY
//   §7.3 asks for a drag-and-drop builder. Move-up/move-down over the same
//   array is the same data operation with none of the pointer-sensor,
//   keyboard-fallback and drop-target work, and it is operable by keyboard and
//   screen reader from the first day. Adding dragging later changes this file
//   and nothing else — the array is the model either way.
//
// VALIDATION HAPPENS TWICE, ON PURPOSE
//   Once here, so a mistake is shown beside the field that caused it, and again
//   on the server, because a client check is a convenience and never a control.
// ============================================================================

import { useCallback, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import {
  BLOCK_CATALOGUE,
  blocksSchema,
  defaultBlock,
  type CmsBlockType,
  type CmsBlocks,
} from "@/lib/domain/cms/blocks";
import { BLOCK_FIELDS, type BlockField } from "@/lib/domain/cms/fields";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/providers/ToastProvider";
import { cn } from "@/lib/utils";

/** A block as the editor holds it: loosely typed while being edited. */
type DraftBlock = { id: string; type: CmsBlockType; props: Record<string, unknown> };

export interface BlockEditorProps {
  /** Starting content. Anything unparseable has already been dropped upstream. */
  initialBlocks: CmsBlocks;
  /** Persist the draft. Returns an error message, or null on success. */
  onSave: (blocks: CmsBlocks) => Promise<string | null>;
  /**
   * Make the draft live. Omitted for the platform TEMPLATE, which has no
   * published state — it is copied into pages rather than served to anyone.
   */
  onPublish?: () => Promise<string | null>;
  /** Opened in a new tab by "View site". Omitted where there is no live URL. */
  previewUrl?: string;
  /** Shown above the editor, e.g. "Editing: Demo University". */
  contextLabel?: string;
}

/** Immutably set `value` at `path` within an object. */
function setAt(
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
function getAt(source: unknown, path: readonly (string | number)[]): unknown {
  return path.reduce<unknown>(
    (acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key as string]),
    source
  );
}

export function BlockEditor({
  initialBlocks,
  onSave,
  onPublish,
  previewUrl,
  contextLabel,
}: BlockEditorProps) {
  const { toast } = useToast();

  const [blocks, setBlocks] = useState<DraftBlock[]>(
    () => initialBlocks as unknown as DraftBlock[]
  );
  const [openId, setOpenId] = useState<string | null>(initialBlocks[0]?.id ?? null);
  const [isSaving, setSaving] = useState(false);
  const [isPublishing, setPublishing] = useState(false);
  const [isDirty, setDirty] = useState(false);

  /**
   * Client-side validation of the whole page, recomputed as it is edited.
   *
   * The SAME schema the server uses, so "valid here" and "accepted there" can
   * never disagree — the alternative is an editor that says a page is fine and
   * a save that rejects it with a message nobody can act on.
   */
  const validation = useMemo(() => blocksSchema.safeParse(blocks), [blocks]);

  const update = useCallback((path: (string | number)[], value: unknown) => {
    setBlocks((current) => setAt({ list: current }, ["list", ...path], value).list as DraftBlock[]);
    setDirty(true);
  }, []);

  const addBlock = useCallback((type: CmsBlockType) => {
    // crypto.randomUUID rather than an index or a counter: an id must survive a
    // reorder, and an index-derived key remounts every block after a move.
    const block = defaultBlock(type, crypto.randomUUID()) as unknown as DraftBlock;
    setBlocks((current) => [...current, block]);
    setOpenId(block.id);
    setDirty(true);
  }, []);

  const move = useCallback((index: number, direction: -1 | 1) => {
    setBlocks((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  }, []);

  const remove = useCallback((index: number) => {
    setBlocks((current) => current.filter((_, i) => i !== index));
    setDirty(true);
  }, []);

  async function handleSave() {
    if (!validation.success) {
      toast({
        variant: "error",
        title: "Fix the highlighted fields",
        description: "Some sections are incomplete, so nothing was saved.",
      });
      return;
    }

    setSaving(true);
    const error = await onSave(validation.data);
    setSaving(false);

    if (error) {
      toast({ variant: "error", title: "Could not save", description: error });
      return;
    }

    setDirty(false);
    toast({ variant: "success", title: "Draft saved" });
  }

  async function handlePublish() {
    if (!onPublish) return;

    if (isDirty) {
      // Publishing takes what is SAVED, not what is on screen. Publishing over
      // unsaved edits would put an older page live while the editor showed a
      // newer one — the single most confusing thing this screen could do.
      toast({
        variant: "error",
        title: "Save before publishing",
        description: "Publishing makes the saved draft live, and you have unsaved changes.",
      });
      return;
    }

    setPublishing(true);
    const error = await onPublish();
    setPublishing(false);

    if (error) {
      toast({ variant: "error", title: "Could not publish", description: error });
      return;
    }

    toast({ variant: "success", title: "Your website is live" });
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {contextLabel && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {contextLabel}
              </p>
            )}
            <p className="text-sm text-foreground">
              {blocks.length} section{blocks.length === 1 ? "" : "s"}
              {isDirty && <span className="ml-2 text-warning">· unsaved changes</span>}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {previewUrl && (
              <Button
                variant="outlined"
                size="sm"
                onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}
                leftIcon={<ExternalLink className="size-4" />}
              >
                View site
              </Button>
            )}
            <Button
              variant="outlined"
              size="sm"
              onClick={handleSave}
              isLoading={isSaving}
              leftIcon={<Save className="size-4" />}
            >
              Save draft
            </Button>
            {onPublish && (
              <Button
                size="sm"
                onClick={handlePublish}
                isLoading={isPublishing}
                leftIcon={<Eye className="size-4" />}
              >
                Publish
              </Button>
            )}
          </div>
        </div>
      </Card>

      {!validation.success && (
        <Alert variant="warning" title="Some sections are incomplete">
          Fill in every required field before saving. Sections with a problem are
          marked below.
        </Alert>
      )}

      <ul className="space-y-3">
        {blocks.map((block, index) => {
          const definition = BLOCK_CATALOGUE.find((entry) => entry.type === block.type);
          const isOpen = openId === block.id;
          // Which blocks the schema rejected, by their index in the array.
          const hasError = !validation.success
            ? validation.error.issues.some((issue) => issue.path[0] === index)
            : false;

          return (
            <li key={block.id}>
              <Card
                noPadding
                className={cn(hasError && "ring-1 ring-danger")}
                header={
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setOpenId(isOpen ? null : block.id)}
                      aria-expanded={isOpen}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="text-sm font-semibold text-heading">
                        {definition?.label ?? block.type}
                      </span>
                      {hasError && (
                        <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs font-medium text-danger-bg-foreground">
                          Incomplete
                        </span>
                      )}
                    </button>

                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton
                        label="Move up"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ChevronUp className="size-4" />
                      </IconButton>
                      <IconButton
                        label="Move down"
                        disabled={index === blocks.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ChevronDown className="size-4" />
                      </IconButton>
                      <IconButton label="Remove section" destructive onClick={() => remove(index)}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                  </div>
                }
              >
                {isOpen && (
                  <div className="space-y-4 p-5">
                    {(BLOCK_FIELDS[block.type] as readonly BlockField[]).map((field) => (
                      <FieldControl
                        key={field.name}
                        field={field}
                        path={[index, "props", field.name]}
                        value={getAt(blocks, [index, "props", field.name])}
                        onChange={update}
                      />
                    ))}
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <Card header={<h2 className="text-sm font-semibold text-heading">Add a section</h2>}>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BLOCK_CATALOGUE.map((entry) => (
            <li key={entry.type}>
              <button
                type="button"
                onClick={() => addBlock(entry.type)}
                className="flex w-full items-start gap-2.5 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-heading">{entry.label}</span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    {entry.description}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// --- Field rendering --------------------------------------------------------

function IconButton({
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
 * One field of any kind, resolved from its spec.
 *
 * Recursive: a `group` renders its own leaves, and a `list` renders a numbered
 * set of item panels each containing leaves and groups. The path grows as it
 * descends, so every input knows exactly where in the block its value lives and
 * the editor needs no per-block change handlers.
 */
function FieldControl({
  field,
  path,
  value,
  onChange,
}: {
  field: BlockField;
  path: (string | number)[];
  value: unknown;
  onChange: (path: (string | number)[], value: unknown) => void;
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
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {field.itemNoun} {index + 1}
                </span>
                <IconButton
                  label={`Remove ${field.itemNoun} ${index + 1}`}
                  destructive
                  // The schema's own minimum, enforced in the UI so the reader
                  // cannot reach a state the server would reject.
                  disabled={items.length <= field.min}
                  onClick={() =>
                    onChange(path, items.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 className="size-4" />
                </IconButton>
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
