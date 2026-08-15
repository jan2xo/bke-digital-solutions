import Link from "next/link";
import { db } from "@/lib/db";
import { resolvePurchasePlan } from "@/lib/pricing";

export const metadata = { title: "Products" };

export default async function ProductsPage() {
  const products = await db.product.findMany({
    where: { active: true },
    include: { editions: { where: { active: true }, include: { purchasePlans: { where: { active: true }, include: { monthlySource: true } } } } },
  });
  return <section className="shell py-16 motion-fade-up">
    <p className="font-bold text-[#ffe08a]">Product catalog</p>
    <h1 className="mt-2 text-5xl font-black">Software for work that matters.</h1>
    <div className="mt-12 grid gap-6 md:grid-cols-2 motion-stagger">{products.map((product) => {
      const plans = product.editions.flatMap((edition) => edition.purchasePlans);
      const starting = plans.map((plan) => resolvePurchasePlan(plan).amountMinor).sort((a, b) => a - b)[0];
      return <article className="card p-8" key={product.id}>
        <p className="text-xs font-bold tracking-widest text-[#ffe08a]">{product.type}</p>
        <h2 className="mt-3 text-3xl font-black">{product.name}</h2>
        <p className="mt-3 text-[#a8b5c4]">{product.summary}</p>
        <p className="mt-6 font-semibold">{product.editions.length} edition(s) · {plans.length} purchase option(s)</p>
        {starting !== undefined && <p className="mt-2 text-xl font-black">From {money(starting)}</p>}
        <Link className="button mt-8" href={`/products/${product.slug}`}>Choose edition and plan</Link>
      </article>;
    })}</div>
  </section>;
}

function money(minor: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100);
}
