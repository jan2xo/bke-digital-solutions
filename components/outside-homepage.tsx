"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function OutsideHomepage({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return pathname && pathname !== "/" ? children : null;
}
