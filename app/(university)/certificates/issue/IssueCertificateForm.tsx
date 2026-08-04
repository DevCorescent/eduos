"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Award, ExternalLink } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/providers/ToastProvider";
import { issueCertificateAction } from "@/actions/finance";
import type { Certificate } from "@/types";

interface Option {
  value: string;
  label: string;
}

export interface IssueCertificateFormProps {
  templates: Option[];
  students: Option[];
}

export function IssueCertificateForm({ templates, students }: IssueCertificateFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [studentId, setStudentId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [isIssuing, setIsIssuing] = useState(false);
  const [issued, setIssued] = useState<Certificate | null>(null);

  async function handleIssue() {
    setIsIssuing(true);
    setIssued(null);

    const response = await issueCertificateAction(studentId, templateId);
    setIsIssuing(false);

    if (!response.success) {
      toast({ variant: "error", title: "Couldn't issue", description: response.error });
      return;
    }

    const certificate = response.data as Certificate;
    setIssued(certificate);
    toast({ variant: "success", title: "Certificate issued" });
    router.refresh();
  }

  if (templates.length === 0) {
    return (
      <Alert variant="warning" title="No active templates">
        Add an active certificate template before issuing.
      </Alert>
    );
  }

  return (
    <div className="max-w-2xl">
      <Card header={<h2 className="text-sm font-semibold text-heading">Details</h2>}>
        <div className="flex flex-col gap-4">
          <Select
            label="Student"
            required
            value={studentId}
            onChange={setStudentId}
            placeholder="Select a student"
            options={students}
            helperText="Only active students are listed."
          />

          <Select
            label="Template"
            required
            value={templateId}
            onChange={setTemplateId}
            placeholder="Select a template"
            options={templates}
          />
        </div>

        <Alert variant="info" className="mt-6">
          The student&apos;s details are copied onto the certificate at the moment it is
          issued. Later edits to their record will not change a document already issued.
        </Alert>

        <div className="mt-6 flex justify-end">
          <Button
            onClick={handleIssue}
            disabled={!studentId || !templateId}
            isLoading={isIssuing}
            leftIcon={<Award className="size-4" />}
          >
            Issue certificate
          </Button>
        </div>
      </Card>

      {issued && (
        <Card
          className="mt-6"
          header={<h2 className="text-sm font-semibold text-heading">Issued</h2>}
        >
          <dl className="flex flex-col">
            <div className="flex flex-col gap-0.5 border-b border-border py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm text-muted-foreground sm:w-44">
                Certificate number
              </dt>
              <dd className="font-mono text-sm text-foreground">{issued.certificateNo}</dd>
            </div>
            <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm text-muted-foreground sm:w-44">
                Public verification
              </dt>
              <dd className="min-w-0 text-sm">
                <Link
                  href={`/verify/${issued.certificateNo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 break-all text-primary hover:underline"
                >
                  /verify/{issued.certificateNo}
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                </Link>
              </dd>
            </div>
          </dl>
        </Card>
      )}
    </div>
  );
}
