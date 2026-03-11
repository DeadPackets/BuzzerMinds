"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";

import { PublicConfigResponse } from "@/lib/types";

declare global {
  interface Window {
    turnstile?: {
      ready: (callback: () => void) => void;
      render: (container: HTMLElement | string, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface TurnstileContextValue {
  enabled: boolean;
  siteKey: string | null;
  requestToken: (slot: string) => Promise<string | null>;
}

const TurnstileContext = createContext<TurnstileContextValue | null>(null);

export function TurnstileProvider({ children, config }: { children: ReactNode; config: PublicConfigResponse }) {
  const [ready, setReady] = useState(() => typeof window !== "undefined" && Boolean(document.querySelector('script[data-turnstile="true"]')));
  const widgetIds = useRef(new Map<string, string>());
  const containers = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!config.turnstile_enabled || !config.turnstile_site_key) {
      return;
    }

    const existing = document.querySelector('script[data-turnstile="true"]');
    if (existing) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = "true";
    script.onload = () => setReady(true);
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [config.turnstile_enabled, config.turnstile_site_key]);

  const value = useMemo<TurnstileContextValue>(() => ({
    enabled: config.turnstile_enabled,
    siteKey: config.turnstile_site_key,
    async requestToken(slot: string) {
      if (!config.turnstile_enabled || !config.turnstile_site_key) {
        return null;
      }
      if (!ready || !window.turnstile) {
        throw new Error("Turnstile is not ready yet.");
      }

      const existingContainer = containers.current.get(slot);
      const container = existingContainer ?? document.createElement("div");
      container.style.position = "fixed";
      container.style.left = "-9999px";
      container.style.top = "-9999px";
      if (!existingContainer) {
        document.body.appendChild(container);
        containers.current.set(slot, container);
      }

      const oldWidget = widgetIds.current.get(slot);
      if (oldWidget) {
        window.turnstile.remove(oldWidget);
        widgetIds.current.delete(slot);
      }

      return await new Promise<string | null>((resolve, reject) => {
        window.turnstile?.ready(() => {
          const widgetId = window.turnstile?.render(container, {
            sitekey: config.turnstile_site_key,
            callback: (token: string) => {
              resolve(token);
            },
            "error-callback": () => reject(new Error("Turnstile verification failed.")),
            "expired-callback": () => resolve(null),
          });

          if (!widgetId) {
            reject(new Error("Unable to render Turnstile."));
            return;
          }
          widgetIds.current.set(slot, widgetId);
        });
      });
    },
  }), [config.turnstile_enabled, config.turnstile_site_key, ready]);

  return <TurnstileContext.Provider value={value}>{children}</TurnstileContext.Provider>;
}

export function useTurnstile(): TurnstileContextValue {
  const context = useContext(TurnstileContext);
  if (!context) {
    throw new Error("useTurnstile must be used within TurnstileProvider");
  }
  return context;
}
