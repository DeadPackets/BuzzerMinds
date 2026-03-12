"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { getWebSocketUrl } from "@/lib/api";
import { RoomStateResponse, WsMessage } from "@/lib/types";

interface RoomLiveContextValue {
  room: RoomStateResponse;
  connected: boolean;
  replaceRoom: (room: RoomStateResponse) => void;
  /**
   * Send a buzz-in via the already-open WebSocket for lowest latency.
   * Returns true if the message was sent, false if the socket isn't connected.
   * Errors from the server arrive asynchronously via `onBuzzError`.
   */
  buzzViaWs: (clientId: string) => boolean;
  /** Register a callback for buzz errors received over WebSocket. */
  onBuzzError: (cb: ((error: string) => void) | null) => void;
}

const RoomLiveContext = createContext<RoomLiveContextValue | null>(null);

interface RoomLiveProviderProps {
  initialRoom: RoomStateResponse;
  roomCode: string;
  query: Record<string, string>;
  children: ReactNode;
}

export function RoomLiveProvider({ initialRoom, roomCode, query, children }: RoomLiveProviderProps) {
  const [room, setRoom] = useState(initialRoom);
  const [connected, setConnected] = useState(false);
  const queryString = JSON.stringify(query);
  const socketRef = useRef<WebSocket | null>(null);
  const buzzErrorCbRef = useRef<((error: string) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | null = null;
    let consecutiveFailures = 0;
    const MAX_HANDSHAKE_FAILURES = 5;
    const cleanupRef: { current?: () => void } = {};

    function connect() {
      const parsedQuery = JSON.parse(queryString) as Record<string, string>;
      const socket = new WebSocket(getWebSocketUrl(roomCode, parsedQuery));
      let didOpen = false;

      socket.onopen = () => {
        didOpen = true;
        consecutiveFailures = 0;
        socketRef.current = socket;
        setConnected(true);
      };

      socket.onclose = (event) => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        setConnected(false);
        if (cancelled) return;

        // Non-recoverable server rejection (custom close codes)
        if (event.code >= 4400 && event.code < 4500) return;

        if (!didOpen) {
          consecutiveFailures++;
          // After MAX_HANDSHAKE_FAILURES consecutive failures without ever
          // connecting, stop retrying — the room likely no longer exists.
          if (consecutiveFailures >= MAX_HANDSHAKE_FAILURES) return;
        }

        const delay = didOpen ? 1500 : Math.min(1500 * 2 ** consecutiveFailures, 15000);
        reconnectTimer = window.setTimeout(connect, delay);
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as WsMessage;
        if (message.type === "room_state") {
          setRoom(message.payload);
        } else if (message.type === "buzz_error") {
          buzzErrorCbRef.current?.(message.error);
        }
      };

      const heartbeat = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send("ping");
        }
      }, 12000);

      return () => {
        window.clearInterval(heartbeat);
        socket.close();
      };
    }

    cleanupRef.current = connect();

    return () => {
      cancelled = true;
      socketRef.current = null;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      cleanupRef.current?.();
    };
  }, [queryString, roomCode]);

  const buzzViaWs = useCallback((clientId: string): boolean => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "buzz", client_id: clientId }));
    return true;
  }, []);

  const onBuzzError = useCallback((cb: ((error: string) => void) | null) => {
    buzzErrorCbRef.current = cb;
  }, []);

  const value = useMemo(
    () => ({ room, connected, replaceRoom: setRoom, buzzViaWs, onBuzzError }),
    [connected, room, buzzViaWs, onBuzzError],
  );

  return <RoomLiveContext.Provider value={value}>{children}</RoomLiveContext.Provider>;
}

export function useRoomLive(): RoomLiveContextValue {
  const context = useContext(RoomLiveContext);
  if (!context) {
    throw new Error("useRoomLive must be used within RoomLiveProvider");
  }
  return context;
}
