"use client";

import type { ReactNode } from "react";
import { useRef } from "react";

export function MobileNavigation({ children }: { children: ReactNode }) {
  const disclosureRef = useRef<HTMLDetailsElement>(null);

  return (
    <details
      ref={disclosureRef}
      className="mobile-menu"
      onClick={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("a[href]")) {
          if (disclosureRef.current) disclosureRef.current.open = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && disclosureRef.current?.open) {
          disclosureRef.current.open = false;
          disclosureRef.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label="Open navigation menu">Menu</summary>
      <nav aria-label="Mobile navigation" className="mobile-menu-panel">{children}</nav>
    </details>
  );
}
