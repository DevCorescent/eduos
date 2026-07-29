import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function UniversityLayout({ children }: { children: ReactNode }) {
  try {
    await requireSession();
  } catch {
    redirect("/login");
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200">
          <span className="text-lg font-bold text-blue-600">eduOS</span>
        </div>
        <nav className="flex-1 px-4 py-4 space-y-1">
          <a href="/dashboard" className="block px-3 py-2 rounded text-sm text-gray-700 hover:bg-gray-100">Dashboard</a>
          <a href="/students" className="block px-3 py-2 rounded text-sm text-gray-700 hover:bg-gray-100">Students</a>
          <a href="/faculty" className="block px-3 py-2 rounded text-sm text-gray-700 hover:bg-gray-100">Faculty</a>
          <a href="/courses" className="block px-3 py-2 rounded text-sm text-gray-700 hover:bg-gray-100">Courses</a>
          <a href="/finance" className="block px-3 py-2 rounded text-sm text-gray-700 hover:bg-gray-100">Finance</a>
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
