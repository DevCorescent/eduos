import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import {
  getComponentTree,
  getPassingCriteria,
  getScheme,
  getSchemeRules,
} from "@/services/evaluation";
import type { EvaluationComponentNodeDTO } from "@/lib/dto/evaluationComponent.dto";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Evaluation Scheme" };

/** params is a Promise in Next.js 16 — await before destructuring. */
type Params = Promise<{ id: string }>;

/**
 * One regulation in full: its settings, component tree, rules and passing
 * criteria.
 *
 * The four reads are issued together — none depends on another, and running
 * them in sequence would stack four round trips onto a page that is read, not
 * navigated through.
 *
 * The scheme read is the only one that can fail the page. A regulation whose
 * component tree could not be loaded is still worth showing: the settings and
 * the criteria are what most readers came for, and blanking all of it because
 * one section failed helps nobody.
 */
export default async function EvaluationSchemePage({ params }: { params: Params }) {
  const { id } = await params;

  const [schemeResult, treeResult, rulesResult, criteriaResult] = await Promise.all([
    getScheme(id),
    getComponentTree(id),
    getSchemeRules(id),
    getPassingCriteria(id),
  ]);

  const back = (
    <Link
      href="/evaluation/schemes"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to schemes
    </Link>
  );

  if (!schemeResult.success) {
    return (
      <>
        {back}
        <ErrorState title="Couldn't load the scheme" description={schemeResult.error} />
      </>
    );
  }

  const scheme = schemeResult.data;

  return (
    <>
      {back}
      <PageHeader
        title={scheme.name}
        subtitle={`${scheme.code} · version ${scheme.version}`}
        action={
          <Badge
            variant={
              scheme.status === "ACTIVE"
                ? "success"
                : scheme.status === "DRAFT"
                  ? "warning"
                  : "neutral"
            }
          >
            {scheme.status}
          </Badge>
        }
      />

      {/* Violations are surfaced above everything else: they are the reason an
          administrator cannot activate the regulation, and burying them under
          the tree they refer to would hide the only actionable thing here. */}
      {treeResult.success && !treeResult.data.validation.isValid && (
        <Alert variant="warning" className="mb-6">
          <p className="font-medium">This scheme cannot be activated yet.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {treeResult.data.validation.violations.map((violation) => (
              <li key={`${violation.code}-${violation.field}`}>
                {violation.message} <span className="text-xs">({violation.field})</span>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          header={<h2 className="text-sm font-semibold text-heading">Settings</h2>}
          className="lg:col-span-1"
        >
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Field label="Grade scale" value={scheme.gradeScale.name} />
            <Field
              label="Max grade point"
              value={scheme.gradeScale.maxGradePoint}
            />
            <Field label="Attempt policy" value={scheme.attemptPolicy} />
            <Field label="Grading method" value={scheme.gradeScale.method} />
            <Field
              label="Marks rounding"
              value={`${scheme.marksRounding} (${scheme.marksPrecision} dp)`}
            />
            <Field
              label="GPA rounding"
              value={`${scheme.gpaRounding} (${scheme.gpaPrecision} dp)`}
            />
            <Field
              label="Activated"
              value={scheme.activatedAt ? formatDate(scheme.activatedAt) : null}
            />
            <Field
              label="Archived"
              value={scheme.archivedAt ? formatDate(scheme.archivedAt) : null}
            />
          </dl>
          {scheme.description && (
            <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
              {scheme.description}
            </p>
          )}
        </Card>

        <Card
          header={
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-heading">Components</h2>
              {treeResult.success && (
                <span className="text-xs text-muted-foreground">
                  {treeResult.data.componentCount} in total
                </span>
              )}
            </div>
          }
          className="lg:col-span-2"
          noPadding
        >
          {!treeResult.success ? (
            <SectionError message={treeResult.error} />
          ) : treeResult.data.tree.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No component has been defined for this scheme.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {treeResult.data.tree.map((node) => (
                <ComponentNode key={node.id} node={node} depth={0} />
              ))}
            </ul>
          )}
        </Card>

        <Card
          header={
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-heading">Rules</h2>
              {rulesResult.success && rulesResult.data.requiresCohortComputation && (
                <Badge variant="info" size="sm">
                  Cohort-wide
                </Badge>
              )}
            </div>
          }
          className="lg:col-span-2"
          noPadding
        >
          {!rulesResult.success ? (
            <SectionError message={rulesResult.error} />
          ) : rulesResult.data.rules.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No rule transforms marks under this scheme.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {/* Listed in execution order — by phase, then sequence — because
                  rules compose, and a different order would misdescribe what
                  the regulation actually does. */}
              {rulesResult.data.rules.map((rule) => (
                <li key={rule.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{rule.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {rule.code} · {rule.operation}
                      {rule.componentId ? "" : " · applies to the course total"}
                    </p>
                  </div>
                  <Badge variant="neutral" size="sm">
                    {rule.phase}
                  </Badge>
                  {rule.isCohortScoped && (
                    <Badge variant="info" size="sm">
                      Cohort
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          header={<h2 className="text-sm font-semibold text-heading">Passing criteria</h2>}
          className="lg:col-span-1"
          noPadding
        >
          {!criteriaResult.success ? (
            <SectionError message={criteriaResult.error} />
          ) : criteriaResult.data.criteria.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No passing criterion is defined.
            </p>
          ) : (
            <>
              {/* Criteria form a conjunction — every one must hold — so the
                  counts are shown together to make the whole requirement
                  visible at a glance. */}
              <p className="border-b border-border px-5 py-2 text-xs text-muted-foreground">
                {criteriaResult.data.courseScopedCount} per course ·{" "}
                {criteriaResult.data.semesterScopedCount} per semester · all must be met
              </p>
              <ul className="divide-y divide-border">
                {criteriaResult.data.criteria.map((criterion) => (
                  <li key={criterion.id} className="px-5 py-3">
                    <p className="truncate text-sm text-foreground">{criterion.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {criterion.metric} ≥ {criterion.threshold}
                      {criterion.unit === "PERCENT" ? "%" : ` ${criterion.unit.toLowerCase()}`} ·
                      fails as {criterion.failureOutcome}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}

/** A section that failed, stated inline so the rest of the page still renders. */
function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 px-5 py-6 text-sm text-warning">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

/**
 * One component and its children, indented by depth.
 *
 * Rendered recursively rather than flattened, because the nesting IS the
 * meaning: a child's weightage is a share of its parent, not of the course, and
 * a flat list would present the two as comparable numbers.
 */
function ComponentNode({ node, depth }: { node: EvaluationComponentNodeDTO; depth: number }) {
  return (
    <>
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
        <div className="min-w-0 flex-1" style={{ paddingLeft: `${depth * 1.25}rem` }}>
          <p className="truncate text-sm text-foreground">{node.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {node.code} · {node.type}
            {node.isMandatory ? " · mandatory" : ""}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">max {node.maxMarks}</span>
        <span className="shrink-0 text-sm font-medium text-foreground">{node.weightage}%</span>
      </li>
      {node.children.map((child) => (
        <ComponentNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}
