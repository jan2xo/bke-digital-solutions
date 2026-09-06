import { redirect, notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireLegalClearance } from "@/lib/legal/guard";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const { id } = await params;
  await requireLegalClearance(user.id, `/dashboard/invoices/${id}`);
  const invoice = await db.invoice.findFirst({
    where: { id, order: { account: { OR: [
      { ownerId: user.id },
      { memberships: { some: { userId: user.id, role: { in: ["OWNER", "BILLING"] } } } },
    ] } } },
    include: { lines: true, order: { include: { payments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } } },
  });
  if (!invoice) notFound();
  const customer = invoice.customerSnapshot;
  const email = customer && typeof customer === "object" && !Array.isArray(customer)
    && typeof customer.email === "string" ? customer.email : null;
  const items = invoice.lines.filter((line) => line.totalMinor >= 0);
  const discounts = invoice.lines.filter((line) => line.totalMinor < 0);

  return <section className="mx-auto max-w-3xl px-4 py-14">
    <p className="font-bold text-[#0b7197]">Commercial invoice</p>
    <h1 className="mt-2 text-4xl font-black">{invoice.number}</h1>
    <p className="mt-2 text-sm text-slate-600">Order {invoice.order.number} · {invoice.status}</p>
    <p className="mt-2 text-sm text-slate-600">Order date: {date(invoice.order.createdAt)}</p>
    {invoice.issuedAt && <p className="mt-2 text-sm text-slate-600">Invoice issued: {date(invoice.issuedAt)}</p>}
    <div className="mt-8 grid gap-6 text-sm sm:grid-cols-2">
      <div>
        <h2 className="font-bold">Billed to</h2>
        <p className="mt-2 break-all text-slate-600">{email || "Email not recorded"}</p>
      </div>
      <div>
        <h2 className="font-bold">Payment</h2>
        {invoice.order.payments.length === 0
          ? <p className="mt-2 text-slate-600">No payment recorded</p>
          : invoice.order.payments.map((payment) => <div key={payment.id} className="mt-2 text-slate-600">
            <p>{payment.provider === "internal" && payment.amountMinor === 0
              ? "Complimentary order"
              : `${payment.status === "PAID" ? "Paid via" : "Provider:"} ${payment.provider === "paymongo" ? "PayMongo" : payment.provider}`}</p>
            <p>Status: {payment.status}</p>
            <p>Amount: {money(payment.amountMinor, payment.currency)}</p>
            {payment.provider !== "internal" && <p className="break-all">Reference: {payment.externalId}</p>}
            {payment.paidAt && <p>Payment date: {date(payment.paidAt)}</p>}
          </div>)}
      </div>
    </div>
    <div className="card mt-8 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b text-slate-600">
          <th scope="col" className="p-4">Item / plan</th>
          <th scope="col" className="p-4 text-right">Unit price</th>
          <th scope="col" className="p-4 text-right">Qty</th>
          <th scope="col" className="p-4 text-right">Subtotal</th>
        </tr></thead>
        <tbody>{items.map((line) => <tr className="border-b" key={line.id}>
          <td className="p-4">{line.description}</td>
          <td className="p-4 text-right whitespace-nowrap">{money(line.unitAmountMinor, invoice.currency)}</td>
          <td className="p-4 text-right">{line.quantity}</td>
          <td className="p-4 text-right whitespace-nowrap">{money(line.totalMinor, invoice.currency)}</td>
        </tr>)}</tbody>
        <tfoot>
          <tr><th scope="row" className="p-4" colSpan={3}>Subtotal</th><td className="p-4 text-right whitespace-nowrap">{money(invoice.subtotalMinor, invoice.currency)}</td></tr>
          {discounts.map((line) => <tr key={line.id}>
            <th scope="row" className="px-4 py-2 font-normal" colSpan={3}>{line.description}</th>
            <td className="px-4 py-2 text-right whitespace-nowrap">{money(line.totalMinor, invoice.currency)}</td>
          </tr>)}
          <tr><th scope="row" className="p-4 font-normal" colSpan={3}>Tax</th><td className="p-4 text-right whitespace-nowrap">{money(invoice.taxMinor, invoice.currency)}</td></tr>
          <tr className="border-t font-black"><th scope="row" className="p-4" colSpan={3}>Total</th><td className="p-4 text-right whitespace-nowrap">{money(invoice.totalMinor, invoice.currency)}</td></tr>
        </tfoot>
      </table>
    </div>
    <p className="mt-5 text-xs text-slate-500">Commercial invoice only; not represented as a BIR-certified tax invoice.</p>
  </section>;
}
function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amount / 100);
}
function date(value: Date) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(value);
}
