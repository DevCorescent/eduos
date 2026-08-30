import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { listCertificateTemplateVersions } from "@/services/certificateTemplates";
import { formatDate } from "@/utils/format";

/**
 * The version history of one certificate template.
 *
 * WHY IT IS SHOWN AT ALL
 *   Editing a template that has issued certificates does not change them — it
 *   writes a new version and leaves the old one alone. That is the right rule
 *   and an invisible one: without this panel an administrator edits a design,
 *   sees no change on the certificates already handed out, and reasonably
 *   concludes the save failed. The history makes the rule legible.
 *
 * The issued count is the important column. A version with issued certificates
 * is historical and cannot be edited in place; a version with none is still a
 * draft in practice, whatever its status says.
 */
export async function VersionHistory({ templateId }: { templateId: string }) {
  const result = await listCertificateTemplateVersions(templateId);

  // History is context, not the page. If it cannot be read the editor above is
  // still perfectly usable, so this renders nothing rather than an error that
  // would imply the template itself failed to load.
  if (!result.success || result.data.length < 2) return null;

  return (
    <Card
      header={
        <div>
          <h2 className="text-sm font-semibold text-heading">Version history</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Certificates keep the design they were issued with. Editing a version that has already
            issued certificates saves a new version instead of changing theirs.
          </p>
        </div>
      }
    >
      <ul className="flex flex-col divide-y divide-border">
        {result.data.map((version) => {
          const isCurrent = version.id === templateId;

          return (
            <li key={version.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="text-sm font-medium text-foreground">Version {version.version}</span>

              {version.isActive ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="neutral">Draft</Badge>
              )}

              {isCurrent && <span className="text-xs text-muted-foreground">Editing</span>}

              <span className="text-xs text-muted-foreground">
                {version._count.certificates === 0
                  ? "No certificates issued"
                  : version._count.certificates === 1
                    ? "1 certificate issued"
                    : `${version._count.certificates} certificates issued`}
              </span>

              <span className="ml-auto text-xs text-muted-foreground">
                {formatDate(version.createdAt)}
              </span>

              {!isCurrent && (
                <Link
                  href={`/certificates/templates/${version.id}`}
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  Open
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
