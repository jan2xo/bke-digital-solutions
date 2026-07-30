import Link from "next/link";
export default function Cancel(){return <section className="mx-auto max-w-xl px-4 py-24 text-center"><h1 className="text-4xl font-black">Checkout cancelled.</h1><p className="mt-4 text-slate-600">No license was issued. You can safely return to the catalog or try again later.</p><Link className="button mt-8" href="/products">Return to products</Link></section>}
