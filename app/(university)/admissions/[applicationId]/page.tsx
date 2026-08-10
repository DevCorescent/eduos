import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { unwrapResource } from "@/lib/require-resource";
import { getMyApplication } from "@/services/admissions";
import { listProgrammes } from "@/services/setup";
import { listBatches } from "@/services/calendar";
import {
  ADMISSION_STAGES,
  ADMISSION_STAGE_LABELS,
  type AdmissionStageName,
} from "@/lib/validations/admission";
import { formatDate, formatDateTime } from "@/utils/format";
import { TenantApplicationActions } from "./TenantApplicationActions";

type Params = Promise<{ applicationId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { applicationId } = await params;
  const result = await getMyApplication(applicationId);
  return { title: result.success ? result.data.applicationNo : "Application" };
}

/**
 * PRD §8.2 / §49.2 — one application in the signed-in university (TD-W3-6).
 *
 * Programmes and batches come from the tenant's own guarded endpoints. No
 * tenant id appears anywhere on this screen.
 */
export default async function AdmissionDetailPage({ params }: { params: Params }) {
  const { applicationId } = await params;

  const [applicationResult, programmes, batches] = await Promise.all([
    getMyApplication(applicationId),
    listProgrammes({ page: 1, limit: 100 }),
    listBatches({ page: 1, limit: 100 }),
  ]);

  const application = unwrapResource(applicationResult, "application");

  const stageIndex = ADMISSION_STAGES.indexOf(application.stage as AdmissionStageName);
  const next =
    stageIndex >= 0 && stageIndex < ADMISSION_STAGES.length - 1
      ? ADMISSION_STAGES[stageIndex + 1]
      : null;

  return (
    <>
      <Link
        href="/admissions"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to admissions
      </Link>

      <PageHeader
        title={`${application.firstName} ${application.lastName}`}
        subtitle={`${application.applicationNo} · applicant ${application.applicantNo}`}
        action={
          <Badge variant={application.convertedAt ? "success" : "info"} size="md">
            {ADMISSION_STAGE_LABELS[application.stage]}
          </Badge>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <TenantApplicationActions
            application={application}
            nextStage={next}
            nextStageLabel={next ? ADMISSION_STAGE_LABELS[next] : null}
            programmes={
              programmes.success
                ? programmes.data.items.map((p) => ({ id: p.id, code: p.code, name: p.name }))
                : []
            }
            batches={
              batches.success
                ? batches.data.items.map((b) => ({ id: b.id, code: b.code, name: b.name }))
                : []
            }
          />

          <Card>
            <h2 className="text-sm font-semibold text-heading">Applicant</h2>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Field label="Email" value={application.email} />
              <Field label="Phone" value={application.phone ?? "—"} />
              <Field
                label="Date of birth"
                value={application.dateOfBirth ? formatDate(application.dateOfBirth) : "—"}
              />
              <Field label="Created" value={formatDateTime(application.createdAt)} />
            </dl>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-heading">Guardian</h2>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Field label="Name" value={application.guardianName ?? "—"} />
              <Field label="Relation" value={application.guardianRelation ?? "—"} />
              <Field label="Phone" value={application.guardianPhone ?? "—"} />
              <Field label="Email" value={application.guardianEmail ?? "—"} />
            </dl>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-heading">Programme preferences</h2>
            {application.preferences.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">None recorded.</p>
            ) : (
              <ol className="mt-2 divide-y divide-border">
                {application.preferences.map((p) => (
                  <li key={p.programme.id} className="flex items-baseline gap-3 py-2">
                    <span className="text-xs text-muted-foreground">#{p.priority}</span>
                    <span className="text-sm text-foreground">
                      <span className="font-mono text-xs text-muted-foreground">{p.programme.code}</span>{" "}
                      {p.programme.name}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <Card>
          <h2 className="text-sm font-semibold text-heading">Admission workflow</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The twelve stages of the admission workflow, in order.
          </p>
          <ol className="mt-3 flex flex-col gap-1">
            {ADMISSION_STAGES.map((stage, index) => {
              const done = index < stageIndex;
              const current = index === stageIndex;
              return (
                <li key={stage} className="flex items-center gap-2 py-1">
                  <span
                    className={
                      done
                        ? "flex size-5 shrink-0 items-center justify-center rounded-full bg-success-bg text-success-bg-foreground"
                        : current
                          ? "flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white"
                          : "flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                    }
                  >
                    {done ? (
                      <Check className="size-3" aria-hidden="true" />
                    ) : (
                      <span className="text-[10px]">{index + 1}</span>
                    )}
                  </span>
                  <span className={current ? "text-sm font-medium text-foreground" : "text-sm text-muted-foreground"}>
                    {ADMISSION_STAGE_LABELS[stage]}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}
