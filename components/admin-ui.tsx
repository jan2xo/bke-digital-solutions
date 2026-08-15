import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

type AdminInfoSurfaceProps = {
  children: ReactNode;
  title?: ReactNode;
  className?: string;
};

/**
 * A lighter operational-dashboard surface for explanatory or non-blocking
 * information. Keep content inside this primitive so its foreground and
 * background colors remain a tested, high-contrast pair.
 */
export function AdminInfoSurface({ children, title, className = "" }: AdminInfoSurfaceProps) {
  return (
    <aside className={`admin-info-surface ${className}`.trim()}>
      {title && <p className="admin-info-surface-title">{title}</p>}
      <div className="admin-info-surface-body">{children}</div>
    </aside>
  );
}

export function AdminStatusBadge({ status, tone = "neutral" }: { status: ReactNode; tone?: "success" | "warning" | "danger" | "info" | "neutral" }) {
  return <span className={`admin-status admin-status-${tone}`}>{status}</span>;
}

export function AdminField({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="admin-field"><span className="admin-field-label">{label}</span>{children}{hint && <span className="admin-field-hint">{hint}</span>}</label>;
}

export function AdminInput(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`admin-input ${props.className ?? ""}`.trim()} />; }
export function AdminSelect(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`admin-input admin-select ${props.className ?? ""}`.trim()} />; }
