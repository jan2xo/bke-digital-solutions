"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton(){
  const router=useRouter();
  const[busy,setBusy]=useState(false);
  async function logout(){
    setBusy(true);
    const response=await fetch("/api/auth/logout",{method:"POST"});
    if(!response.ok){setBusy(false);return}
    router.replace("/login");
    router.refresh();
  }
  return <button type="button" onClick={logout} disabled={busy} className="rounded-lg border border-[#2D5579] px-3 py-2 text-sm font-bold text-[#213A53] transition hover:bg-[#213A53] hover:text-white disabled:opacity-60">{busy?"Signing out…":"Log out"}</button>;
}
