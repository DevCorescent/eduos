import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  let session;
  try {
    session = await requireSession();
  } catch {
    redirect("/login");
  }

  const isSuperAdmin = session.roles.includes("SUPER_ADMIN");
  if (!isSuperAdmin) redirect("/dashboard");

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="px-6 py-4 border-b border-gray-700">
          <span className="text-lg font-bold">eduOS Platform</span>
        </div>
        <nav className="flex-1 px-4 py-4 space-y-1">
          <a href="/platform/dashboard" className="block px-3 py-2 rounded text-sm hover:bg-gray-700">Dashboard</a>
          <a href="/platform/tenants" className="block px-3 py-2 rounded text-sm hover:bg-gray-700">Tenants</a>
          <a href="/platform/subscriptions" className="block px-3 py-2 rounded text-sm hover:bg-gray-700">Subscriptions</a>
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
