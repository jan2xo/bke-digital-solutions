import type { ReactNode } from "react";

type AdminTableProps = {
  headers: string[];
  rows: ReactNode[][];
  caption?: string;
  className?: string;
};

/** Shared presentation-only table. Data loading and row actions remain owned by callers. */
export function AdminTable({ headers, rows, caption, className = "" }: AdminTableProps) {
  return (
    <div className={`admin-table-wrap ${className}`.trim()}>
      <table className="admin-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead><tr>{headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
          )) : <tr><td className="admin-table-empty" colSpan={headers.length}>No records found.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
