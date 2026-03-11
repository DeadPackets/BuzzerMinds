"use client";

import { Badge } from "@/components/ui/badge";
import { useTurnstile } from "@/components/providers/turnstile-provider";

export function TurnstilePlaceholder({ enabled }: { enabled: boolean }) {
  const { siteKey } = useTurnstile();

  if (!enabled) {
    return null;
  }

  return <Badge variant="outline">Turnstile ready{siteKey ? "" : " (site key missing)"}</Badge>;
}
