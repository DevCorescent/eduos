"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Show an issued certificate, and print it.
 *
 * PRINTING IS THE DOWNLOAD
 *   "Download PDF" here is the browser's own print-to-PDF. This project has no
 *   PDF library and no object storage, and adding either would be introducing
 *   infrastructure rather than using what exists. Every browser can save this
 *   dialog's output as a PDF, the page box is declared @page A4 by the
 *   renderer, so the file that comes out is the A4 document — and there is no
 *   generated file to store, secure, back up or leak.
 *
 *   The button says "Print / Save as PDF" rather than "Download PDF", because
 *   it opens a dialog rather than dropping a file in Downloads, and a control
 *   should say what it does.
 *
 * THE IFRAME IS THE DOCUMENT
 *   Rendered in a sandboxed iframe: same isolation as the builder's preview,
 *   and printing that frame prints exactly the certificate rather than the
 *   admin console around it. `allow-modals` is granted for one reason — the
 *   print dialog — and scripts are still not allowed.
 */
export function CertificateViewer({ document: doc }: { document: string }) {
  const frame = useRef<HTMLIFrameElement>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => {
            const win = frame.current?.contentWindow;
            if (!win) return;
            win.focus();
            win.print();
          }}
        >
          Print / Save as PDF
        </Button>
      </div>

      {/* A4 proportions on screen, so what is shown is the shape of the paper. */}
      <div className="mx-auto w-full max-w-3xl" style={{ aspectRatio: "1 / 1.414" }}>
        <iframe
          ref={frame}
          title="Certificate"
          srcDoc={doc}
          sandbox="allow-modals"
          className="h-full w-full rounded-md border border-border bg-white shadow-soft"
        />
      </div>
    </div>
  );
}
