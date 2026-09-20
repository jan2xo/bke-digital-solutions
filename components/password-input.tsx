"use client";

import { useState, type InputHTMLAttributes } from "react";

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return <span className="relative block">
    <input {...props} className={`${props.className ?? "input"} pr-12`} type={visible ? "text" : "password"}/>
    <button
      type="button"
      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-600 hover:text-slate-950"
      aria-label={visible ? "Hide password" : "Show password"}
      aria-pressed={visible}
      onClick={() => setVisible((current) => !current)}
    >
      {visible
        ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l18 18"/><path d="M10.6 10.7a2 2 0 002.7 2.7"/><path d="M9.9 4.2A10.8 10.8 0 0112 4c5 0 9 4.3 10 8a12.8 12.8 0 01-2.1 4.1M6.6 6.6A12.5 12.5 0 002 12c1 3.7 5 8 10 8a10 10 0 004.1-.9"/></svg>
        : <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>}
    </button>
  </span>;
}
