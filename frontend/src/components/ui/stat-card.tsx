import { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  description,
  badge,
  className,
  accent,
}: {
  label: string;
  value: ReactNode;
  description: string;
  badge?: string;
  className?: string;
  accent?: "purple" | "cyan" | "pink" | "lime" | "amber";
}) {
  const accentColors: Record<string, string> = {
    purple: "from-[var(--bm-neon-purple)]/20 to-transparent",
    cyan: "from-[var(--bm-neon-cyan)]/20 to-transparent",
    pink: "from-[var(--bm-neon-pink)]/20 to-transparent",
    lime: "from-[var(--bm-neon-lime)]/20 to-transparent",
    amber: "from-[var(--bm-neon-amber)]/20 to-transparent",
  };

  return (
    <div className={cn(
      "bm-card bm-card-accent relative overflow-hidden rounded-2xl p-5",
      className,
    )}>
      {accent ? (
        <div className={cn("absolute inset-0 bg-gradient-to-br pointer-events-none", accentColors[accent])} />
      ) : null}
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bm-text-dim)]">
            {label}
          </p>
          {badge ? <Badge variant="outline">{badge}</Badge> : null}
        </div>
        <p className="bm-score mt-3 text-3xl leading-none text-[var(--bm-text-bright)] sm:text-4xl">
          {value}
        </p>
        <p className="bm-body mt-3 text-sm">{description}</p>
      </div>
    </div>
  );
}
