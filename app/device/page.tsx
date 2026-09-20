import { notFound, redirect } from "next/navigation";
import { AgentDeviceApprovalForm } from "@/components/agent-device-approval-form";
import { listAgentDeviceAuthorizationAccounts } from "@/apps/web/accounts/agent-device-account-list";
import { currentUser } from "@/apps/web/auth/session";
import { getRuntimeEnvironment } from "@/platform/host/env";

const userCodePattern = /^BKE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export default async function DeviceAuthorizationPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const runtime = getRuntimeEnvironment();
  if (!runtime.V3_AGENT_ACCOUNT_SESSION_ENABLED) notFound();

  const { code: rawCode } = await searchParams;
  const userCode = rawCode?.trim().toUpperCase() ?? "";
  if (!userCodePattern.test(userCode)) {
    return (
      <section className="mx-auto max-w-lg px-4 py-16">
        <div className="card p-8">
          <h1 className="text-3xl font-black">Connect BKE Licensing Agent</h1>
          <p className="mt-4 text-slate-600">
            This device code is missing or invalid. Start sign-in again from BKE Launcher or Licensing Agent.
          </p>
        </div>
      </section>
    );
  }

  const user = await currentUser();
  if (!user) {
    const returnTo = `/device?code=${encodeURIComponent(userCode)}`;
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  const accounts = user.emailVerified
    ? await listAgentDeviceAuthorizationAccounts(user.id)
    : [];

  return (
    <section className="mx-auto max-w-lg px-4 py-16">
      <h1 className="mb-3 text-4xl font-black">Connect BKE Licensing Agent</h1>
      <p className="mb-8 text-slate-600">
        Signed in as <strong>{user.email}</strong>. Choose which BKE account this device may use.
      </p>

      {!user.emailVerified ? (
        <div className="card p-8">
          <h2 className="text-xl font-black">Verify your email first</h2>
          <p className="mt-3 text-slate-600">
            Device authorization requires a verified BKE identity.
          </p>
        </div>
      ) : (
        <AgentDeviceApprovalForm userCode={userCode} accounts={accounts} />
      )}
    </section>
  );
}
