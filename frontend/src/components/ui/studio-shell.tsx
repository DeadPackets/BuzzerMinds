import { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function GameShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className={cn("bm-shell bm-grid-pattern relative z-10", className)}>
      <div className="bm-particles" aria-hidden="true" />
      <div className="mx-auto max-w-7xl">{children}</div>
    </main>
  );
}

export function GameHeader({
  label,
  title,
  subtitle,
  aside,
  compact = false,
}: {
  label?: string;
  title: string;
  subtitle?: string;
  aside?: ReactNode;
  compact?: boolean;
}) {
  return (
    <header className={cn(
      "grid gap-6 pb-8",
      aside && "lg:grid-cols-[1.2fr_0.8fr] lg:items-end",
    )}>
      <div className="min-w-0">
        {label ? (
          <span className="bm-label">
            <span aria-hidden="true" className="bm-live-dot" />
            {label}
          </span>
        ) : null}
        <h1 className={cn(
          "bm-title mt-4 leading-[0.95] text-[var(--bm-text-bright)]",
          compact ? "text-3xl sm:text-4xl" : "text-4xl sm:text-5xl lg:text-6xl",
        )}>
          {title}
        </h1>
        {subtitle ? (
          <p className="bm-body mt-4 max-w-2xl text-base">{subtitle}</p>
        ) : null}
      </div>
      {aside ? <div className="min-w-0 lg:justify-self-end">{aside}</div> : null}
    </header>
  );
}

// Re-export old names for backward compatibility during migration
export const StudioShell = GameShell;
export const StudioHeader = GameHeader;
