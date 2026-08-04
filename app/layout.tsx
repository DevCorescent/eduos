import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/providers/ToastProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // The template makes every page title read "… | eduOS" without each one
  // restating the suffix.
  title: {
    default: "eduOS",
    template: "%s | eduOS",
  },
  description: "Multi-University Digital Education Operating System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* ToastProvider is the one client boundary in the root layout. It wraps
          `children` rather than replacing the tree, so every page below stays a
          Server Component — only the toast viewport itself ships JS. */}
      <body className="min-h-full flex flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
