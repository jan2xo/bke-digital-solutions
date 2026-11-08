"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function AdminProductImageUpload({ productId }: { productId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const url = String(new FormData(form).get("url") ?? "").trim();
    const response = await fetch(`/api/admin/products/${productId}/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    setMessage(response.ok ? "Image reference saved" : "Use a public PNG, JPEG, or WebP image in the jan2xo GitHub repository");
    if (response.ok) { form.reset(); router.refresh(); }
  }
  return <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
    <label className="label">GitHub product image URL<input className="input" type="url" name="url" maxLength={500} placeholder="https://raw.githubusercontent.com/jan2xo/repository/main/path/image.png" required /></label>
    <button className="button">Save image reference</button>
    {message && <small role="status">{message}</small>}
  </form>;
}
