"use client";

import type { ReactNode } from "react";

type MotionRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: 0 | 1 | 2 | 3;
};

/**
 * A deliberately content-agnostic reveal wrapper. Legal markdown stays a
 * server-rendered HTML string while motion remains a presentation concern.
 */
export function MotionReveal({ children, className = "", delay = 0 }: MotionRevealProps) {
  return (
    <div className={`motion-reveal motion-reveal-delay-${delay} ${className}`.trim()}>
      {children}
    </div>
  );
}
