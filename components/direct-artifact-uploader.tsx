"use client";

export function uploadArtifact(versionId: string, file: File, report?: (message: string) => void) {
  void versionId;
  void file;
  report?.("Software artifact upload is retired; publish through GitHub Releases.");
  return Promise.reject(new Error("ARTIFACT_INGESTION_RETIRED"));
}

export function DirectArtifactUploader({ versionId }: { versionId: string }) {
  return (
    <div className="mt-5 grid gap-2 rounded border border-blue-200 bg-blue-50 p-4">
      <p className="text-sm font-bold">Software distribution is managed in GitHub Releases</p>
      <p className="text-xs text-slate-700">
        Version <code>{versionId}</code> binaries are built, verified, and published by GitHub. Digital Solutions keeps the commercial access gate but no longer accepts or commissions software artifact uploads.
      </p>
    </div>
  );
}
