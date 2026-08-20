"use client";

import { AdminActionButton } from "@/components/admin-action-button";
import { AdminLicenseOperations } from "@/components/admin-license-operations";

export function AdminLicenseActionArea({ licenseId, status }: { licenseId: string; status: string }) {
  const suspended = status === "SUSPENDED";
  return (
    <div className="flex min-w-[11rem] flex-col items-start gap-2">
      <AdminActionButton
        url={`/api/admin/licenses/${licenseId}`}
        label={suspended ? "Activate" : "Suspend"}
        body={{ action: suspended ? "ACTIVATE" : "SUSPEND" }}
      />
      <details className="w-full rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-slate-100">
        <summary className="cursor-pointer text-xs font-bold text-[#dce8f4]">More actions</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <AdminActionButton url={`/api/admin/licenses/${licenseId}`} label="Renew" body={{ action: "RENEW", days: 365 }} />
          <AdminActionButton url={`/api/admin/licenses/${licenseId}`} label="Revoke" body={{ action: "REVOKE" }} danger confirmText="Revoke this license and deactivate its devices?" />
        </div>
      </details>
      <AdminLicenseOperations licenseId={licenseId} />
    </div>
  );
}
