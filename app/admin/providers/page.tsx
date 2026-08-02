import { AdminProviderManager } from "@/components/admin-provider-manager";
import { safeProviderStatuses } from "@/lib/provider-config/service";

export default async function ProvidersPage() {
  const statuses = await safeProviderStatuses();
  return <main className="shell py-10"><h1 className="text-4xl font-black">External providers</h1><p className="mt-2 text-slate-600">Configure encrypted PayMongo test and Resend credentials. Saved secrets are never shown again.</p><AdminProviderManager statuses={statuses.map((item) => ({ id: item.id, provider: item.provider, environment: item.environment, enabled: item.enabled, senderName: item.senderName, senderEmail: item.senderEmail, supportEmail: item.supportEmail, validationStatus: item.validationStatus, lastValidationCode: item.lastValidationCode, lastValidatedAt: item.lastValidatedAt?.toISOString() ?? null, credentials: item.credentials.map((credential) => ({ type: credential.credentialType, hint: credential.maskedHint, createdAt: credential.createdAt.toISOString() })) }))}/></main>;
}
