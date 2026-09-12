import { requireAdmin } from "@/v2/apps/web/auth/session";

export default async function SupplyChainPage() {
  await requireAdmin();
  return (
    <main className="shell py-10">
      <h1 className="text-4xl font-black">Software supply chain</h1>
      <div className="card mt-8 p-6">
        <h2 className="text-2xl font-black">Managed in GitHub</h2>
        <p className="mt-2 text-slate-600">
          Build, malware scanning, signing or checksum checks, and release publication now belong to GitHub Actions and GitHub Releases.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Digital Solutions no longer certifies release evidence or executes software release-security workflows.
        </p>
      </div>
    </main>
  );
}
