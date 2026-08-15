import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function AdminStatusBadge({ status, tone = "neutral" }: { status: ReactNode; tone?: "success" | "warning" | "danger" | "info" | "neutral" }) {
  return <span className={`admin-status admin-status-${tone}`}>{status}</span>;
}

export function AdminField({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="admin-field"><span className="admin-field-label">{label}</span>{children}{hint && <span className="admin-field-hint">{hint}</span>}</label>;
}

export function AdminInput(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`admin-input ${props.className ?? ""}`.trim()} />; }
export function AdminSelect(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`admin-input admin-select ${props.className ?? ""}`.trim()} />; }
