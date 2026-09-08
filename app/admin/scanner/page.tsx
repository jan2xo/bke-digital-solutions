import { requireAdmin } from "@/lib/auth";

export default async function ScannerPage() {
  await requireAdmin();
  return (
    <main className="shell py-10">
      <h1 className="text-4xl font-black">Malware scanning</h1>
      <div className="card mt-8 p-6">
        <h2 className="text-2xl font-black">Managed in GitHub Actions</h2>
        <p className="mt-2 text-slate-600">
          Digital Solutions no longer runs or monitors the software-release malware scanner. Scan execution and release gating belong to each software repository&apos;s GitHub workflow.
        </p>
      </div>
    </main>
  );
}
