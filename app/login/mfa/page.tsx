import { MfaChallengeForm } from "@/components/mfa-challenge-form";
export default function MfaLoginPage(){return <section className="mx-auto max-w-md px-4 py-16"><h1 className="text-4xl font-black">Administrator verification</h1><p className="my-4 text-slate-600">Enter the six-digit code from your authenticator app. A single-use recovery code also works.</p><MfaChallengeForm/></section>}
