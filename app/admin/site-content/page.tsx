import { SiteContentEditor } from "@/components/site-content-editor";
import { getSiteContent } from "@/lib/site-content";
export const dynamic = "force-dynamic";
export default async function SiteContentPage() { return <main className="shell py-10"><h1 className="text-4xl font-black">Site content</h1><p className="mt-2 text-slate-600">Edit approved content fields by group. Raw configuration keys are not exposed.</p><SiteContentEditor initial={await getSiteContent()} /></main>; }
