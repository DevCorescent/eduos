"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/providers/ToastProvider";
import {
  createCertificateTemplate,
  updateCertificateTemplate,
} from "@/services/certificateTemplates";
import {
  CERTIFICATE_VARIABLES,
  CERTIFICATE_VARIABLE_CATEGORIES,
  applySampleValues,
  unknownVariables,
  variableToken,
} from "@/lib/domain/certificate/variables";
import {
  sanitiseCertificateCss,
  sanitiseCertificateHtml,
} from "@/lib/domain/certificate/sanitise";
import { CERTIFICATE_TYPE_VALUES } from "@/types";

export interface TemplateEditorProps {
  /** Absent when creating. */
  templateId?: string;
  initial: {
    name: string;
    type: string;
    htmlTemplate: string;
    cssStyles: string;
    isActive: boolean;
  };
}

/**
 * Author a certificate template.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *   The builder PRD §F13 describes: an HTML body, a stylesheet, a variable
 *   picker that inserts {{tokens}}, and a live preview at paper proportions.
 *   It is NOT a drag-and-drop canvas — that needs structured layout storage and
 *   a rendering pipeline, neither of which exists yet, and inventing them here
 *   would leave two ways to describe the same certificate.
 *
 * THE PREVIEW IS DEFENDED TWICE
 *   The markup is sanitised (executable elements, event handlers and
 *   javascript:/data: URLs removed) AND rendered into an iframe whose sandbox
 *   grants nothing — no allow-scripts, no allow-same-origin. Either defence
 *   alone would do; a template is authored HTML that renders back into a
 *   University Admin's browser, which is exactly where stored XSS would land,
 *   so it gets both.
 *
 * SAMPLE DATA, VISIBLY SAMPLE
 *   The preview substitutes "Sample Student" and "CERT-YYYY-0000". Nothing is
 *   read from a real student and nothing is written: previewing a template
 *   creates no certificate, consumes no number from the identifier engine and
 *   touches no record.
 */
export function TemplateEditor({ templateId, initial }: TemplateEditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState(initial);
  const htmlRef = useRef<HTMLTextAreaElement>(null);

  const isNew = !templateId;

  /** Placeholders the issuing flow cannot fill — surfaced, never auto-corrected. */
  const unknown = useMemo(() => unknownVariables(form.htmlTemplate), [form.htmlTemplate]);

  /**
   * The document handed to the iframe.
   *
   * Sanitise FIRST, then substitute: the sample values are plain text, so
   * substituting afterwards cannot reintroduce markup, and sanitising first
   * means a payload cannot hide inside a placeholder.
   */
  const previewDocument = useMemo(() => {
    const html = applySampleValues(sanitiseCertificateHtml(form.htmlTemplate));
    const css = sanitiseCertificateCss(form.cssStyles);

    return `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Georgia,'Times New Roman',serif}
      ${css}
    </style></head><body>${html}</body></html>`;
  }, [form.htmlTemplate, form.cssStyles]);

  /** Insert a token where the caret is, so the picker lands where the author is typing. */
  function insertVariable(key: string) {
    const token = variableToken(key);
    const field = htmlRef.current;

    if (!field) {
      setForm((f) => ({ ...f, htmlTemplate: f.htmlTemplate + token }));
      return;
    }

    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const next = field.value.slice(0, start) + token + field.value.slice(end);

    setForm((f) => ({ ...f, htmlTemplate: next }));

    // Put the caret after what was just inserted, so a second insert does not
    // land back at the start of the document.
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function save(publish: boolean) {
    setError(null);

    if (!form.name.trim()) {
      setError("Give the template a name.");
      return;
    }
    if (!form.htmlTemplate.trim()) {
      setError("A template needs a body.");
      return;
    }

    startTransition(async () => {
      const body = {
        name: form.name.trim(),
        type: form.type,
        htmlTemplate: form.htmlTemplate,
        // The column is optional and rejects an empty string, so an unstyled
        // template omits the key rather than sending "".
        ...(form.cssStyles.trim() ? { cssStyles: form.cssStyles } : {}),
        isActive: publish ? true : form.isActive,
      };

      const result = templateId
        ? await updateCertificateTemplate(templateId, body)
        : await createCertificateTemplate(body);

      if (!result.success) {
        setError(result.error);
        return;
      }

      toast({
        variant: "success",
        title: publish
          ? `${body.name} is published`
          : isNew
            ? `${body.name} saved as a draft`
            : "Template saved",
      });

      router.push("/certificates/templates");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
        {/* ---------------------------------------------------------------- */}
        {/* Left — template settings and the variable picker                  */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex flex-col gap-4">
          <Card header={<h2 className="text-sm font-semibold text-heading">Template</h2>}>
            <div className="flex flex-col gap-4">
              <Input
                label="Template name"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Bachelor Degree Certificate"
              />

              <Select
                label="Certificate type"
                value={form.type}
                onChange={(value) => setForm((f) => ({ ...f, type: value }))}
                options={CERTIFICATE_TYPE_VALUES.map((value) => ({ value, label: value }))}
              />

              <Select
                label="Status"
                value={form.isActive ? "ACTIVE" : "DRAFT"}
                onChange={(value) => setForm((f) => ({ ...f, isActive: value === "ACTIVE" }))}
                options={[
                  { value: "DRAFT", label: "Draft — not offered when issuing" },
                  { value: "ACTIVE", label: "Active — available to issue from" },
                ]}
              />
            </div>
          </Card>

          <Card
            header={
              <div>
                <h2 className="text-sm font-semibold text-heading">Variables</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Inserted where your cursor is. Replaced with each student&apos;s details when a
                  certificate is issued.
                </p>
              </div>
            }
          >
            <div className="flex flex-col gap-3">
              {CERTIFICATE_VARIABLE_CATEGORIES.map((category) => (
                <div key={category}>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">{category}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CERTIFICATE_VARIABLES.filter((v) => v.category === category).map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        onClick={() => insertVariable(v.key)}
                        title={variableToken(v.key)}
                        className="rounded-md border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Right — body, styles and the live preview                         */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex flex-col gap-4">
          {unknown.length > 0 && (
            <Alert variant="warning">
              {/* Reported, not corrected: guessing what the author meant is how a
                  wrong name reaches an official document. */}
              This template uses {unknown.length === 1 ? "a placeholder" : "placeholders"} nothing
              can fill: {unknown.map((k) => `{{${k}}}`).join(", ")}. They will print exactly as
              written.
            </Alert>
          )}

          <Card header={<h2 className="text-sm font-semibold text-heading">Certificate body</h2>}>
            <Textarea
              ref={htmlRef}
              label="HTML"
              rows={14}
              spellCheck={false}
              value={form.htmlTemplate}
              onChange={(e) => setForm((f) => ({ ...f, htmlTemplate: e.target.value }))}
              className="font-mono text-xs"
              helperText="Scripts, event handlers and embedded documents are removed before the certificate is rendered."
            />
          </Card>

          <Card header={<h2 className="text-sm font-semibold text-heading">Styles</h2>}>
            <Textarea
              label="CSS"
              rows={8}
              spellCheck={false}
              value={form.cssStyles}
              onChange={(e) => setForm((f) => ({ ...f, cssStyles: e.target.value }))}
              className="font-mono text-xs"
            />
          </Card>

          <Card
            header={
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-heading">Preview</h2>
                <span className="text-xs text-muted-foreground">Sample data — nothing is saved</span>
              </div>
            }
          >
            {/* A4 portrait proportions, so the preview is the shape of the paper
                rather than the shape of the browser window. */}
            <div className="mx-auto w-full max-w-2xl" style={{ aspectRatio: "1 / 1.414" }}>
              <iframe
                title="Certificate preview"
                srcDoc={previewDocument}
                // Grants NOTHING. No allow-scripts, so the document cannot
                // execute; no allow-same-origin, so it cannot reach this page's
                // cookies or storage even if it could.
                sandbox=""
                className="h-full w-full rounded-md border border-border bg-white"
              />
            </div>
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" isLoading={pending} onClick={() => save(false)}>
          {isNew ? "Save draft" : "Save"}
        </Button>

        <Button type="button" variant="secondary" disabled={pending} onClick={() => save(true)}>
          Publish
        </Button>

        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => router.push("/certificates/templates")}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
