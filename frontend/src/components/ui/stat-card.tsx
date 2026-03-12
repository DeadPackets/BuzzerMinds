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
  accent?: "sky" | "teal" | "coral" | "violet" | "gold";
}) {
  const accentBorder: Record<string, string> = {
    sky: "border-[var(--sky)]/30",
    teal: "border-[var(--teal)]/30",
    coral: "border-[var(--coral)]/30",
    violet: "border-[var(--violet)]/30",
    gold: "border-[var(--gold)]/30",
  };

  return (
    <div className={cn(
      "bm-card rounded-[var(--radius)] p-5",
      accent && accentBorder[accent],
      className,
    )}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-dim)]">
          {label}
        </p>
        {badge ? <Badge variant="outline">{badge}</Badge> : null}
      </div>
      <p className="bm-score mt-3 text-3xl leading-none text-[var(--text-bright)] sm:text-4xl">
        {value}
      </p>
      <p className="bm-body mt-3 text-sm">{description}</p>
    </div>
  );
}
