import { requireSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  let session;
  try {
    session = await requireSession();
  } catch {
    redirect("/login");
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome back</h1>
      <p className="text-gray-500 text-sm mb-8">
        Signed in as <span className="font-medium">{session.email}</span>
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: "Total Students", value: "—" },
          { label: "Active Faculty", value: "—" },
          { label: "Courses Running", value: "—" },
          { label: "Fee Collection", value: "—" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-lg border border-gray-200 p-6">
            <p className="text-sm text-gray-500">{stat.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
