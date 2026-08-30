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

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
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
import { useToast } from "@/providers/ToastProvider";
import { cn } from "@/lib/utils";
// The recursive form machinery, shared with the site-chrome editor. See
// fieldControls.tsx on why it is not defined here any more.
import { FieldControl, IconButton, getAt, setAt } from "./fieldControls";

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
  /**
   * Opened in a new tab by the preview button.
   *
   * NULL is meaningful and different from omitted: omitted means this surface
   * has no preview at all (the platform template), null means this institution
   * has no published website to look at yet. The second gets a disabled button
   * and an explanation, because an enabled button that opens a sign-in form is
   * worse than no button.
   */
  previewUrl?: string | null;
  /** Why the preview is unavailable, shown when previewUrl is null. */
  previewUnavailable?: string;
  /** What that button says. The template previews a template, not a "site". */
  previewLabel?: string;
  /** Shown above the editor, e.g. "Editing: Demo University". */
  contextLabel?: string;
}

export function BlockEditor({
  initialBlocks,
  onSave,
  onPublish,
  previewUrl,
  previewUnavailable = "Publish your website to open it.",
  previewLabel = "View site",
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

  /**
   * Warn before a navigation that would discard edits.
   *
   * The browser's own dialog rather than a custom one: this fires for a tab
   * close and a back button, neither of which any in-page confirmation can
   * intercept. The text is the browser's — nothing may customise it — so the
   * screen ALSO shows "unsaved changes" beside the section count, which is
   * where an editor actually looks.
   */
  useEffect(() => {
    if (!isDirty) return;

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Assigning returnValue is what older browsers still key off.
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

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

  /**
   * Copy a section, inserted directly below the original.
   *
   * A NEW ID, DEEP-CLONED PROPS
   *   Ids identify a block within the array and React keys off them, so a
   *   duplicate that reused the id would make two sections that cannot be moved
   *   or deleted independently. structuredClone rather than a spread because
   *   props nest — a shallow copy would leave the two sections sharing one
   *   items array, and editing either would edit both.
   */
  const duplicate = useCallback((index: number) => {
    setBlocks((current) => {
      const source = current[index];
      if (!source) return current;

      const copy: DraftBlock = {
        ...structuredClone(source),
        id: crypto.randomUUID(),
      };

      const next = [...current];
      next.splice(index + 1, 0, copy);
      return next;
    });
    setDirty(true);
  }, []);

  const remove = useCallback((index: number) => {
    setBlocks((current) => current.filter((_, i) => i !== index));
    setDirty(true);
  }, []);

  /**
   * Persist the draft.
   *
   * RETURNS whether it succeeded, so publish can save first and stop if that
   * save failed rather than publishing the older copy behind the editor's back.
   *
   * A failed save leaves `blocks` exactly as they are. Nothing here clears or
   * refetches state on the error path: the edits are still on screen and the
   * administrator can fix the problem and press Save again.
   */
  async function persist(): Promise<boolean> {
    if (!validation.success) {
      toast({
        variant: "error",
        title: "Fix the highlighted fields",
        description: "Some sections are incomplete, so nothing was saved.",
      });
      return false;
    }

    const error = await onSave(validation.data);

    if (error) {
      toast({
        variant: "error",
        title: "Couldn't save your draft",
        description: `${error} Your changes are still on this page.`,
      });
      return false;
    }

    setDirty(false);
    return true;
  }

  async function handleSave() {
    // Re-entrancy guard. The button shows a spinner, but a double click can
    // land two events before React has re-rendered it, and two concurrent PUTs
    // of the same page is a write nobody asked for.
    if (isSaving || isPublishing) return;

    setSaving(true);
    const saved = await persist();
    setSaving(false);

    if (saved) toast({ variant: "success", title: "Draft saved" });
  }

  async function handlePublish() {
    if (!onPublish) return;
    if (isSaving || isPublishing) return;

    setPublishing(true);

    // Publishing ships what is SAVED, so unsaved edits are saved first. The
    // alternative — refusing until the admin presses Save — makes the two
    // buttons a sequence they have to know about, and publishing an older page
    // while the editor shows a newer one is the single most confusing thing
    // this screen could do. If that save fails, publishing stops here: nothing
    // public changes, and the error already named the reason.
    if (isDirty && !(await persist())) {
      setPublishing(false);
      return;
    }

    const error = await onPublish();
    setPublishing(false);

    if (error) {
      toast({
        variant: "error",
        title: "Couldn't publish the website",
        description: `${error} Nothing was changed publicly.`,
      });
      return;
    }

    toast({
      variant: "success",
      title: "Published",
      description: "Your website is live at your public address.",
    });
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
              {isDirty && (
                <span className="ml-2 font-medium text-warning">· Unsaved changes</span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {previewUrl !== undefined && (
              <Button
                variant="outlined"
                size="sm"
                // Disabled rather than hidden when there is nothing to open: a
                // button that disappears reads as a bug, and the title says why.
                disabled={!previewUrl}
                title={previewUrl ? previewUrl : previewUnavailable}
                onClick={() => {
                  if (!previewUrl) return;
                  // noopener so the opened tab cannot reach back through
                  // window.opener into an authenticated admin session.
                  window.open(previewUrl, "_blank", "noopener,noreferrer");
                }}
                leftIcon={<ExternalLink className="size-4" />}
              >
                {previewLabel}
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
                      <IconButton
                        label="Duplicate section"
                        onClick={() => duplicate(index)}
                      >
                        <Copy className="size-4" />
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
