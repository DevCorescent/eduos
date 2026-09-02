"use client";

// ============================================================================
// MODULE : Hall ticket — print
// PURPOSE: Hand the sheet to the browser's own print dialog, which is also how
//          it becomes a PDF ("Save as PDF" is a destination in every major
//          browser's print dialog).
//
// WHY NOT A GENERATED FILE
//   This project has no PDF dependency and generates no documents server-side;
//   certificates, the nearest equivalent, link to a viewable page. Adding a
//   rendering pipeline for one document would be a larger change than the
//   feature, and the print stylesheet gives the same artefact.
// ============================================================================

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      Print / Save as PDF
    </Button>
  );
}
