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
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 rounded-xl px-4 py-3 transition-all duration-200",
        !connected && "opacity-50",
      )}
      style={{
        background: active ? "rgba(245, 158, 11, 0.08)" : "rgba(30, 30, 30, 0.5)",
        border: active ? "1px solid rgba(245, 158, 11, 0.25)" : "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="bm-swatch"
            style={{ backgroundColor: color }}
          />
          <div className="min-w-0">
            <p className="truncate font-semibold text-[var(--text-bright)]">{name}</p>
            <p className="truncate text-sm text-[var(--text-dim)]">
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
