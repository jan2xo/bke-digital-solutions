"use client";
import { useRouter } from "next/navigation";
export function AdminArtifactActions({id,active}:{id:string;active:boolean}){const router=useRouter();async function remove(){if(!confirm("Remove this artifact from customer downloads?"))return;const r=await fetch(`/api/admin/artifacts/${id}`,{method:"DELETE"});if(r.ok)router.refresh()}return <div>{active&&<button className="text-left text-xs font-bold text-red-700" onClick={remove}>Remove</button>}<p className="mt-1 text-xs text-slate-500">Replacement uses the release page direct verified upload flow.</p></div>}
