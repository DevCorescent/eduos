"use client";

// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Chrome Editor (W4c, PRD §7.1, §7.3)
// LAYER  : Presentation (client)
// PURPOSE: Edit the navigation bar, the footer, the contact block and the
//          site-wide typography — everything that wraps a page rather than
//          sitting in it.
//
// ONE COMPONENT, TWO SURFACES, SAME REASON AS BlockEditor
//   A university edits its own CmsSite; a platform operator edits the template
//   every new university starts from. Those are two authorization decisions and
//   one data operation, so the difference lives in the `fields`, the `schema`
//   and the `onSave` passed in — never in here.
//
// THE FORM IS THE FIELD SPEC, NOT MARKUP
//   Every control below is rendered by FieldControl from a spec in
//   lib/domain/cms/fields.ts. Adding a menu field is one entry there; this file
//   does not change. That is also what gets nav dropdowns for free: a list
//   inside a list is something FieldControl already knows how to do.
//
// VALIDATED HERE AND AGAIN ON THE SERVER
//   The same Zod schema the route uses, so "valid here" and "accepted there"
//   cannot disagree. The client check is a convenience; the route's is the
//   control.
// ============================================================================

import { useCallback, useMemo, useState } from "react";
import { Save } from "lucide-react";
import type { z } from "zod";
import type { BlockField } from "@/lib/domain/cms/fields";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/providers/ToastProvider";
import { FieldControl, getAt, setAt } from "./fieldControls";

export interface ChromeEditorProps<T> {
  /** Which controls to render, and in what order. */
  fields: readonly BlockField[];
  /** Starting values. Already parsed by the page that read them. */
  initialValue: Record<string, unknown>;
  /** The route's own schema, so both sides agree on what is acceptable. */
  schema: z.ZodType<T>;
  /** Persist. Returns an error message, or null on success. */
  onSave: (value: T) => Promise<string | null>;
  title: string;
  /** One sentence on what saving here actually changes. */
  description: string;
  /** Shown above the form, e.g. a warning that this is a live site. */
  notice?: React.ReactNode;
}

export function ChromeEditor<T>({
  fields,
  initialValue,
  schema,
  onSave,
  title,
  description,
  notice,
}: ChromeEditorProps<T>) {
  const { toast } = useToast();

  const [value, setValue] = useState<Record<string, unknown>>(initialValue);
  const [isSaving, setSaving] = useState(false);
  const [isDirty, setDirty] = useState(false);

  const validation = useMemo(() => schema.safeParse(value), [schema, value]);

  const update = useCallback<(path: (string | number)[], next: unknown) => void>(
    (path, next) => {
      setValue((current) => setAt(current, path, next));
      setDirty(true);
    },
    []
  );

  async function handleSave() {
    if (!validation.success) {
      toast({
        variant: "error",
        title: "Fix the highlighted fields",
        description: "Some entries are incomplete, so nothing was saved.",
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
    toast({ variant: "success", title: "Saved" });
  }

  return (
    <Card
      header={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-heading">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
              {isDirty && <span className="ml-2 text-warning">· unsaved changes</span>}
            </p>
          </div>

          <Button
            size="sm"
            onClick={handleSave}
            isLoading={isSaving}
            leftIcon={<Save className="size-4" />}
          >
            Save
          </Button>
        </div>
      }
    >
      {notice}

      {!validation.success && (
        <Alert variant="warning" title="Some entries are incomplete" className="mb-4">
          Every link needs a label and an address. A dropdown link follows the
          same rule as the menu item above it.
        </Alert>
      )}

      <div className="space-y-4">
        {fields.map((field) => (
          <FieldControl
            key={field.name}
            field={field}
            path={[field.name]}
            value={getAt(value, [field.name])}
            onChange={update}
          />
        ))}
      </div>
    </Card>
  );
}
