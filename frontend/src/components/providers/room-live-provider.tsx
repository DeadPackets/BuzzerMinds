"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { getWebSocketUrl } from "@/lib/api";
import { RoomEnvelope, RoomStateResponse } from "@/lib/types";

interface RoomLiveContextValue {
  room: RoomStateResponse;
  connected: boolean;
  replaceRoom: (room: RoomStateResponse) => void;
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

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | null = null;
    const cleanupRef: { current?: () => void } = {};

    function connect() {
      const parsedQuery = JSON.parse(queryString) as Record<string, string>;
      const socket = new WebSocket(getWebSocketUrl(roomCode, parsedQuery));

      socket.onopen = () => {
        setConnected(true);
      };

      socket.onclose = () => {
        setConnected(false);
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as RoomEnvelope;
        if (message.type === "room_state") {
          setRoom(message.payload);
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
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      cleanupRef.current?.();
    };
  }, [queryString, roomCode]);

  const value = useMemo(
    () => ({ room, connected, replaceRoom: setRoom }),
    [connected, room],
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
