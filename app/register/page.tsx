import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
export default function RegisterPage() { return <section className="mx-auto max-w-md px-4 py-16"><h1 className="text-4xl font-black">Create your account.</h1><p className="mt-3 mb-8 text-slate-600">Start as an individual and add an organization anytime.</p><AuthForm mode="register"/><p className="mt-5 text-center text-sm">Already registered? <Link className="font-bold text-[#0b7197]" href="/login">Sign in</Link></p></section>; }
