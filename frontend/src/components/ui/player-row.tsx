import { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn, formatRole } from "@/lib/utils";

export function PlayerRow({
  name,
  color,
  role,
  ready,
  score,
  connected = true,
  active = false,
  trailing,
}: {
  name: string;
  color: string;
  role: string;
  ready: boolean;
  score?: number;
  connected?: boolean;
  active?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div className={cn(
      "flex min-w-0 items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-all duration-200",
      active
        ? "border-[var(--bm-neon-pink)]/40 bg-[var(--bm-neon-pink)]/8 shadow-[0_0_20px_rgba(255,61,154,0.1)]"
        : "border-[var(--bm-border-glow)] bg-[var(--bm-bg-elevated)]",
      !connected && "opacity-50",
    )}>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="bm-swatch"
            style={{ backgroundColor: color }}
          />
          <div className="min-w-0">
            <p className="truncate font-semibold text-[var(--bm-text-bright)]">{name}</p>
            <p className="truncate text-sm text-[var(--bm-text-dim)]">
              {formatRole(role)}
              {score !== undefined ? ` · ${score} pts` : ""}
              {!connected ? " · offline" : ""}
              {active ? " · answering" : ""}
            </p>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={ready ? "secondary" : "outline"}>{ready ? "Ready" : "Waiting"}</Badge>
        {trailing}
      </div>
    </div>
  );
}
