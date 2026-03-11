import { PlayerSessionResponse } from "@/lib/types";

const CLIENT_ID_KEY = "buzzerminds.client_id";
const DISPLAY_SESSION_KEY = "buzzerminds.display_session";

export function getOrCreateClientId(): string {
  if (typeof window === "undefined") {
    return "server-render-placeholder";
  }

  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }

  const generated = `client-${crypto.randomUUID()}`;
  window.localStorage.setItem(CLIENT_ID_KEY, generated);
  return generated;
}

export function roomSessionKey(roomCode: string): string {
  return `buzzerminds.room.${roomCode.toUpperCase()}.session`;
}

export function saveRoomSession(roomCode: string, session: PlayerSessionResponse): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(roomSessionKey(roomCode), JSON.stringify(session));
}

export function loadRoomSession(roomCode: string): PlayerSessionResponse | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(roomSessionKey(roomCode));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PlayerSessionResponse;
  } catch {
    return null;
  }
}

export function clearRoomSession(roomCode: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(roomSessionKey(roomCode));
}

export function currentClientId(): string {
  return getOrCreateClientId();
}

export function saveDisplaySession(roomCode: string, displayToken: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(DISPLAY_SESSION_KEY, JSON.stringify({ roomCode: roomCode.toUpperCase(), displayToken }));
}

export function loadDisplaySession(roomCode: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(DISPLAY_SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { roomCode: string; displayToken: string };
    return parsed.roomCode === roomCode.toUpperCase() ? parsed.displayToken : null;
  } catch {
    return null;
  }
}
