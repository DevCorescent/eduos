import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Award,
  BadgeCheck,
  FileText,
  GraduationCap,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getPortalSession } from "@/services/session";
import { getMyProfile } from "@/services/studentProfile";
import type {
  AddressDto,
  CertificateDto,
  ParentDto,
  StudentProfileDto,
} from "@/lib/dto/studentProfile.dto";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "My Profile" };

/**
 * The student's own profile.
 *
 * Reads GET /api/student/profile — the self-scoped endpoint — and NOT
 * /api/students/[id] and its sub-resources, every one of which is
 * requireRole("UNIVERSITY_ADMIN") and answers a student with 403. The whole
 * page is one request because that endpoint assembles identity, personal
 * details, placement, parents, documents, certificates and achievements
 * server-side.
 *
 * Every field in the response is nullable, and none is filled in here. A blank
 * date of birth renders as "—" rather than as a plausible-looking placeholder:
 * the student is the one person who would notice the difference, and the one
 * person the error would matter to.
 */
export default async function StudentProfilePage() {
  const session = await getPortalSession();
  if (!session) redirect("/login");

  const result = await getMyProfile();

  const header = (
    <PageHeader title="My Profile" subtitle="Your record as the university holds it." />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load your profile" description={result.error} />
      </>
    );
  }

  const profile = result.data;

  return (
    <>
      {header}
      <IdentityCard profile={profile} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <PersonalCard profile={profile} />
        <AcademicCard profile={profile} />
        <ParentsCard parents={profile.parents} />
        <DocumentsCard documents={profile.documents} />
        <CertificatesCard certificates={profile.certificates} />
        <AchievementsCard achievements={profile.achievements} />
      </div>
    </>
  );
}

/** Label-and-value row. Renders an em dash for anything the record does not hold. */
function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-foreground">
        {value === null || value === undefined || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

/** Flatten an address for display, dropping the parts that were never filled in. */
function formatAddress(address: AddressDto | null): string | null {
  if (!address) return null;

  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : null;
}

function IdentityCard({ profile }: { profile: StudentProfileDto }) {
  const { identity, academic } = profile;
  const name = identity.displayName ?? `${identity.firstName} ${identity.lastName}`.trim();

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar
          src={identity.photo.url ?? undefined}
          name={name}
          size="lg"
          className="shrink-0 self-start sm:self-center"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-heading">{name}</h2>
            <Badge variant={identity.status === "ACTIVE" ? "success" : "neutral"} size="sm">
              {identity.status}
            </Badge>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">{identity.email}</p>
        </div>
        <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
          <Field label="Enrollment No" value={identity.enrollmentNo} />
          <Field label="Semester" value={academic.currentSemester} />
          <Field label="Section" value={academic.sectionName} />
        </dl>
      </div>
    </Card>
  );
}

function PersonalCard({ profile }: { profile: StudentProfileDto }) {
  const personal = profile.personal;

  return (
    <Card
      header={
        <div className="flex items-center gap-2">
          <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-heading">Personal</h2>
        </div>
      }
    >
      {!personal ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No personal details have been recorded yet.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Field
              label="Date of birth"
              value={personal.dateOfBirth ? formatDate(personal.dateOfBirth) : null}
            />
            <Field label="Gender" value={personal.gender} />
            <Field label="Blood group" value={personal.bloodGroup} />
            <Field label="Nationality" value={personal.nationality} />
            <Field label="Religion" value={personal.religion} />
            <Field label="Category" value={personal.category} />
          </dl>

          <dl className="mt-4 grid gap-4 border-t border-border pt-4">
            <Field
              label="Permanent address"
              value={formatAddress(personal.permanentAddress)}
            />
            <Field label="Local address" value={formatAddress(personal.localAddress)} />
          </dl>

          {/* `hasContact` is the API's own answer to "is there anything usable
              here", so the card is not rendered from five separate null tests. */}
          {personal.emergencyContact?.hasContact && (
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-3">
              <Field label="Emergency contact" value={personal.emergencyContact.name} />
              <Field label="Relation" value={personal.emergencyContact.relation} />
              <Field label="Phone" value={personal.emergencyContact.phone} />
            </dl>
          )}
        </>
      )}
    </Card>
  );
}

function AcademicCard({ profile }: { profile: StudentProfileDto }) {
  const { academic } = profile;

  return (
    <Card
      header={
        <div className="flex items-center gap-2">
          <GraduationCap className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-heading">Academic</h2>
        </div>
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Field label="Batch" value={academic.batchName} />
        <Field label="Section" value={academic.sectionName} />
        <Field label="Specialisation" value={academic.specialisationName} />
        <Field label="Current semester" value={academic.currentSemester} />
        <Field label="Admitted" value={formatDate(academic.admissionDate)} />
        <Field
          label="Graduated"
          value={academic.graduationDate ? formatDate(academic.graduationDate) : null}
        />
      </dl>
    </Card>
  );
}

function ParentsCard({ parents }: { parents: ParentDto[] }) {
  return (
    <Card
      header={
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-heading">Parents & Guardians</h2>
        </div>
      }
      noPadding
    >
      {parents.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          No parent or guardian is on record.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {parents.map((parent) => (
            <li key={parent.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {parent.firstName} {parent.lastName}
                  {parent.isPrimary && (
                    <Badge variant="info" size="sm" className="ml-2">
                      Primary
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {parent.relation}
                  {parent.occupation ? ` · ${parent.occupation}` : ""}
                </p>
              </div>
              <div className="min-w-0 text-right">
                <p className="truncate text-sm text-foreground">{parent.phone}</p>
                {parent.email && (
                  <p className="truncate text-xs text-muted-foreground">{parent.email}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DocumentsCard({ documents }: { documents: StudentProfileDto["documents"] }) {
  return (
    <Card
      header={
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-heading">Documents</h2>
        </div>
      }
      noPadding
    >
      {documents.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          No documents have been uploaded.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <a
                  href={document.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-sm text-foreground hover:underline"
                >
                  {document.fileName}
                </a>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {document.type} · uploaded {formatDate(document.uploadedAt)}
                </p>
              </div>
              {document.isVerified ? (
                <Badge variant="success" size="sm">
                  <BadgeCheck className="mr-1 size-3" aria-hidden="true" />
                  Verified
                </Badge>
              ) : (
                <Badge variant="warning" size="sm">
                  Pending
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CertificatesCard({ certificates }: { certificates: CertificateDto[] }) {
  return (
    <Card
      header={
        <div className="flex items-center gap-2">
          <Award className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-heading">Certificates</h2>
        </div>
      }
      noPadding
    >
      {certificates.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          No certificate has been issued to you.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {certificates.map((certificate) => (
            <li key={certificate.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{certificate.type}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {certificate.certificateNo} · issued {formatDate(certificate.issuedAt)}
                </p>
              </div>
              {/* A revoked certificate is still listed — a student must know one
                  they hold no longer stands. */}
              <Badge
                variant={
                  certificate.isRevoked ? "danger" : certificate.isActive ? "success" : "neutral"
                }
                size="sm"
              >
                {certificate.isRevoked ? "Revoked" : certificate.isActive ? "Valid" : "Expired"}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AchievementsCard({
  achievements,
}: {
  achievements: StudentProfileDto["achievements"];
}) {
  return (
    <Card
      header={
        <div className="flex items-center gap-2">
          <Trophy className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-heading">Achievements</h2>
        </div>
      }
      noPadding
    >
      {achievements.length === 0 ? (
        <div className="px-5 py-8">
          <EmptyState
            icon={<Trophy />}
            title="Nothing recorded yet"
            description="Achievements you add appear here alongside your academic record."
          />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {achievements.map((achievement) => (
            <li key={achievement.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {achievement.title}
                </p>
                <Badge variant="neutral" size="sm">
                  {achievement.category}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {achievement.issuer} · {formatDate(achievement.achievedOn)}
              </p>
              {achievement.description && (
                <p className="mt-2 text-sm text-muted-foreground">{achievement.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
