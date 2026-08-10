"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileUp, Upload } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { useToast } from "@/providers/ToastProvider";
import {
  runTenantImport,
  type ImportEntityInfo,
  type ImportReport,
  type ImportRowError,
} from "@/services/tenants";

export interface ImportWizardProps {
  tenantId: string;
  tenantName: string;
  entities: ImportEntityInfo[] | null;
  error: string | null;
}

/** Where the operator is in the flow. Linear, and never skipped. */
type Step = "choose" | "previewed" | "imported";

/**
 * PRD §5.1 #14 "Import initial university data", over §55 Stage 3's steps:
 * data template → validation → test import → final migration.
 *
 * THE PREVIEW IS MANDATORY
 *   "Confirm import" only appears after a preview has come back clean. The
 *   operator cannot commit a file they have not seen validated, which is what
 *   §55's "Test imports" step means and what stops a bad file being discovered
 *   after it has been written.
 *
 * NOTHING IS PARSED HERE
 *   The browser reads the file as text and posts it. Every check — headers,
 *   rows, enums, foreign keys, duplicates — happens server-side, so the numbers
 *   on this screen are the server's answers and not a second implementation
 *   that could disagree with it.
 *
 * THE TENANT IS NOT A FIELD
 *   It comes from the route this page is mounted on. There is no university
 *   picker inside the form, so a file can never be aimed at a different one.
 */
export function ImportWizard({
  tenantId,
  tenantName,
  entities,
  error,
}: ImportWizardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [entityKey, setEntityKey] = useState(entities?.[0]?.key ?? "");
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("choose");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  // One flag for both calls: it is what prevents a double submit, which on the
  // commit path would be a second import attempt.
  const [isBusy, setIsBusy] = useState(false);
  // Whether the one-time credentials have been saved. Drives the warning, which
  // must stay loud until the operator has actually taken them.
  const [credentialsSaved, setCredentialsSaved] = useState(false);

  const entity = useMemo(
    () => entities?.find((e) => e.key === entityKey) ?? null,
    [entities, entityKey]
  );

  if (error || !entities) {
    return (
      <StateView state="error" subject="import options" message={error ?? undefined} />
    );
  }

  if (entities.length === 0) {
    return (
      <EmptyState
        icon={<FileUp />}
        title="No importable data types"
        description="Nothing is available to import for this university yet."
      />
    );
  }

  /** Reset everything downstream of the file — a new file invalidates a preview. */
  function resetToChoose() {
    setStep("choose");
    setReport(null);
    setRequestError(null);
  }

  async function readFile(file: File) {
    resetToChoose();
    setFileName(file.name);
    setCsv(await file.text());
  }

  async function send(mode: "preview" | "commit") {
    if (!csv || !entity) return;

    setRequestError(null);
    setIsBusy(true);
    const result = await runTenantImport(tenantId, { entity: entity.key, csv, mode });
    setIsBusy(false);

    if (!result.success) {
      // A file-level refusal — unparseable text, wrong columns, too many rows.
      // Shown as a banner rather than a row list, because it is about the file
      // and not about any particular line.
      setRequestError(result.error);
      setReport(null);
      setStep("choose");
      return;
    }

    setReport(result.data);

    if (mode === "preview") {
      setStep("previewed");
      return;
    }

    setStep("imported");
    setCredentialsSaved(false);
    toast({
      variant: "success",
      title: `${result.data.importedRows} ${entity.label.toLowerCase()} imported`,
    });
    // The tenant page's readiness checklist reads the same data this just wrote.
    router.refresh();
  }

  /** §55 Stage 3 "Data templates" — built from the server's column definitions. */
  function downloadTemplate() {
    if (!entity) return;
    download(`${entity.key}-template.csv`, `${entity.templateHeaders.join(",")}\r\n`);
  }

  /**
   * The one-time credentials, as a file.
   *
   * Built from the response held in component state and nothing else — the
   * plaintext is never re-requested, because the server cannot produce it again.
   */
  function downloadCredentials() {
    if (!report?.credentials?.length) return;
    const rows = report.credentials.map((c) => [
      c.identifier,
      c.name,
      c.email,
      c.temporaryPassword,
    ]);
    download(
      `${report.entity}-credentials.csv`,
      toCsvText(["identifier", "name", "email", "temporaryPassword"], rows)
    );
    setCredentialsSaved(true);
  }

  /** The row-level errors, as a file the operator can work through offline. */
  function downloadErrors() {
    if (!report || report.errors.length === 0) return;
    const rows = report.errors.map((e) => [String(e.line), e.column ?? "", e.message]);
    download(
      `${report.entity}-import-errors.csv`,
      toCsvText(["row", "column", "error"], rows)
    );
  }

  const canPreview = Boolean(csv && entity) && !isBusy;
  const canCommit =
    step === "previewed" && report !== null && report.invalidRows === 0 && !isBusy;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="text-sm font-semibold text-heading">1 · Choose what to import</h2>

        <div className="mt-4 flex max-w-lg flex-col gap-4">
          <Select
            label="Data type"
            value={entityKey}
            onChange={(value) => {
              setEntityKey(value);
              resetToChoose();
            }}
            options={entities.map((e) => ({ value: e.key, label: e.label }))}
            helperText={entity ? `Writes the ${entity.model} records of ${tenantName}.` : undefined}
          />

          {entity?.createsUser && (
            <Alert variant="warning">
              Importing {entity.label.toLowerCase()} creates sign-in accounts. A temporary password
              is generated for each and shown to you <strong>once</strong>, immediately after the
              import — there is no email delivery and no way to retrieve them later. A{" "}
              <span className="font-mono">password</span> column in the file is rejected.
              {entity.roleName ? (
                <>
                  {" "}
                  Each is granted the existing{" "}
                  <span className="font-mono">{entity.roleName}</span> role, which must already
                  exist in this university.
                </>
              ) : (
                <>
                  {" "}
                  No role is granted — this product defines no employee role or employee portal,
                  so an imported employee is a managed record rather than a portal user.
                </>
              )}
            </Alert>
          )}

          {entity && entity.dependsOn.length > 0 && (
            <Alert variant="info">
              {entity.label} reference {entity.dependsOn.join(" and ")}, so those must exist in
              this university first. Rows naming one that does not exist are reported as errors
              rather than imported.
            </Alert>
          )}

          <Button
            variant="secondary"
            onClick={downloadTemplate}
            leftIcon={<Download className="size-4" />}
          >
            Download template
          </Button>
        </div>

        {entity && (
          <div className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Accepted columns
            </h3>
            <ul className="mt-2 divide-y divide-border">
              {entity.columns.map((column) => (
                <li key={column.name} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                  <span className="font-mono text-sm text-foreground">{column.name}</span>
                  {column.required ? (
                    <Badge variant="warning" size="sm" withDot={false}>
                      Required
                    </Badge>
                  ) : (
                    <Badge variant="neutral" size="sm" withDot={false}>
                      Optional
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">{column.description}</span>
                  {column.enumValues && (
                    <span className="font-mono text-xs text-muted-foreground">
                      ({column.enumValues.join(" · ")})
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Any other column is rejected. At most {entity.maxRows.toLocaleString()} rows per
              file. A row whose {entity.duplicateKey} already exists here is skipped, not
              duplicated.
            </p>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-heading">2 · Upload and validate</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Validation writes nothing. You will see the result before anything is imported.
        </p>

        {requestError && (
          <Alert variant="error" className="mt-3">
            {requestError}
          </Alert>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
              // Cleared so re-picking the SAME file fires change again.
              e.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            onClick={() => fileInput.current?.click()}
            leftIcon={<FileUp className="size-4" />}
            disabled={isBusy}
          >
            {fileName ? "Choose a different file" : "Choose CSV file"}
          </Button>

          {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}

          <Button
            onClick={() => send("preview")}
            disabled={!canPreview}
            isLoading={isBusy && step === "choose"}
            leftIcon={<Upload className="size-4" />}
          >
            Validate
          </Button>
        </div>
      </Card>

      {report && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-sm font-semibold text-heading">
              {step === "imported" ? "4 · Result" : "3 · Preview"}
            </h2>
            {report.errors.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={downloadErrors}
                leftIcon={<Download className="size-4" />}
              >
                Download error report
              </Button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="Rows" value={String(report.totalRows)} />
            <StatCard label="Valid" value={String(report.validRows)} />
            <StatCard label="Invalid" value={String(report.invalidRows)} />
            <StatCard label="Skipped" value={String(report.skippedRows)} />
            <StatCard label="Imported" value={String(report.importedRows)} />
          </div>

          {step === "imported" ? (
            <Alert variant="success" className="mt-4">
              {report.importedRows === 0
                ? "Nothing new to import — every row already existed in this university."
                : `${report.importedRows} record${report.importedRows === 1 ? "" : "s"} imported.`}
              {report.skippedRows > 0 &&
                ` ${report.skippedRows} row${report.skippedRows === 1 ? " was" : "s were"} skipped as already present.`}
            </Alert>
          ) : report.invalidRows > 0 ? (
            <Alert variant="error" className="mt-4">
              {report.invalidRows} row{report.invalidRows === 1 ? "" : "s"} cannot be imported.
              Nothing will be written until every row is valid — fix the file and validate again.
            </Alert>
          ) : report.validRows === 0 ? (
            <Alert variant="info" className="mt-4">
              Every row already exists in this university. Importing would write nothing.
            </Alert>
          ) : (
            <Alert variant="success" className="mt-4">
              {report.validRows} row{report.validRows === 1 ? "" : "s"} ready to import
              {report.skippedRows > 0 && `, ${report.skippedRows} already present and will be skipped`}.
            </Alert>
          )}

          {report.errors.length > 0 && (
            <div className="mt-4">
              <Table
                minWidthClassName="min-w-[36rem]"
                columns={errorColumns}
                data={report.errors}
                rowKey={(row) => `${row.line}-${row.column ?? ""}-${row.message}`}
              />
            </div>
          )}

          {/* The ONLY delivery mechanism for imported credentials. There is no
              mail transport, and nothing can regenerate these — so the warning
              stays until the file has been taken. */}
          {report.credentials && report.credentials.length > 0 && (
            <div className="mt-4 rounded-lg border border-warning-bg bg-warning-bg/40 p-4">
              <h3 className="text-sm font-semibold text-heading">
                {report.credentials.length} temporary password
                {report.credentials.length === 1 ? "" : "s"} issued
              </h3>
              <p className="mt-1 text-sm text-warning-bg-foreground">
                Download these credentials now. They cannot be retrieved again.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Each person must change their password before they can use the system. Only the
                hashes are stored — nothing here can be produced a second time.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  variant={credentialsSaved ? "secondary" : "primary"}
                  onClick={downloadCredentials}
                  leftIcon={<Download className="size-4" />}
                >
                  {credentialsSaved ? "Download again" : "Download credentials CSV"}
                </Button>
                {credentialsSaved && (
                  <span className="text-xs text-muted-foreground">
                    Saved. Leaving this page discards them.
                  </span>
                )}
              </div>
            </div>
          )}

          {step === "previewed" && (
            <div className="mt-4 flex items-center gap-3">
              <Button
                onClick={() => send("commit")}
                disabled={!canCommit}
                isLoading={isBusy}
              >
                Confirm import
              </Button>
              {report.invalidRows > 0 && (
                <p className="text-xs text-muted-foreground">
                  Resolve every error before importing.
                </p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

const errorColumns: TableColumn<ImportRowError>[] = [
  {
    key: "line",
    header: "Row",
    render: (row) => <span className="font-mono text-sm">{row.line}</span>,
  },
  {
    key: "column",
    header: "Column",
    render: (row) => (
      <span className="font-mono text-sm text-muted-foreground">{row.column ?? "—"}</span>
    ),
  },
  { key: "message", header: "Problem", render: (row) => row.message },
];

/** Minimal CSV writer for the client-side downloads. Mirrors lib/utils/csv.ts. */
function toCsvText(headers: string[], rows: string[][]): string {
  const escape = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}

/** Trigger a browser download without leaving the page. */
function download(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Released immediately — the click has already started the download, and an
  // un-revoked object URL holds the blob in memory for the life of the document.
  URL.revokeObjectURL(url);
}
