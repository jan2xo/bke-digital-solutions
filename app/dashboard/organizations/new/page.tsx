import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { requireLegalClearance } from "@/lib/legal/guard";
import { OrganizationCreateForm } from "@/components/organization-create-form";

export default async function NewOrganizationPage() {
  const user = await requireUser().catch(() => redirect("/login"));
  await requireLegalClearance(user.id, "/dashboard/organizations/new");
  return <section className="shell py-14"><p className="font-bold text-[#0b7197]">Customer portal</p><h1 className="mt-2 text-4xl font-black">Create an organization</h1><p className="mt-3 max-w-2xl text-slate-600">Create a repository-controlled organization boundary for shared licenses, billing visibility, invitations, and lifecycle controls.</p><OrganizationCreateForm/></section>;
}
