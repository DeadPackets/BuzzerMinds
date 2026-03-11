import {
  CreateRoomResponse,
  GameSummaryResponse,
  JoinRoomResponse,
  PublicConfigResponse,
  RoomStateResponse,
  SettingsPatch,
} from "@/lib/types";

function getApiBase(): string {
  // Server-side: use internal Docker URL for container-to-container calls
  if (typeof window === "undefined") {
    return process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  }
  // Client-side: use public URL, or empty string for same-origin
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
}

export const API_BASE = getApiBase();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

function authBody(playerToken: string, clientId: string, extra?: Record<string, unknown>) {
  return JSON.stringify({ player_token: playerToken, client_id: clientId, ...(extra ?? {}) });
}

export const api = {
  getConfig: () => request<PublicConfigResponse>("/api/config"),
  createRoom: (turnstileToken?: string | null) => request<CreateRoomResponse>("/api/rooms", { method: "POST", body: JSON.stringify({ turnstile_token: turnstileToken ?? null }) }),
  getRoom: (roomCode: string) => request<RoomStateResponse>(`/api/rooms/${roomCode}`),
  joinRoom: (roomCode: string, body: { client_id: string; name: string; color: string; expertise: string; turnstile_token?: string | null }) =>
    request<JoinRoomResponse>(`/api/rooms/${roomCode}/join`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getSummary: (summaryId: string) => request<GameSummaryResponse>(`/api/summaries/${summaryId}`),
  setReady: (roomCode: string, playerId: string, playerToken: string, clientId: string, ready: boolean) =>
    request<RoomStateResponse>(`/api/rooms/${roomCode}/players/${playerId}/ready`, {
      method: "POST",
      body: authBody(playerToken, clientId, { ready }),
    }),
  updateSettings: (
    roomCode: string,
    playerId: string,
    playerToken: string,
    clientId: string,
    settings: SettingsPatch,
  ) =>
    request<RoomStateResponse>(`/api/rooms/${roomCode}/vip/${playerId}/settings`, {
      method: "POST",
      body: authBody(playerToken, clientId, { settings }),
    }),
  startGame: (roomCode: string, playerId: string, playerToken: string, clientId: string) =>
    request<RoomStateResponse>(`/api/rooms/${roomCode}/vip/${playerId}/start`, {
      method: "POST",
      body: authBody(playerToken, clientId),
    }),
  kickPlayer: (roomCode: string, playerId: string, playerToken: string, clientId: string, targetPlayerId: string) =>
    request<RoomStateResponse>(`/api/rooms/${roomCode}/vip/${playerId}/kick`, {
      method: "POST",
      body: authBody(playerToken, clientId, { target_player_id: targetPlayerId }),
    }),
  submitTopicVotes: (roomCode: string, playerId: string, playerToken: string, clientId: string, topicIds: string[]) =>
    request<RoomStateResponse>(`/api/rooms/${roomCode}/players/${playerId}/topic-votes`, {
      method: "POST",
      body: authBody(playerToken, clientId, { topic_ids: topicIds }),
    }),
  rerollTopics: (roomCode: string, playerId: string, playerToken: string, clientId: string) =>
    request<RoomStateResponse>(`/api/rooms/${roomCode}/vip/${playerId}/topic-voting/reroll`, {
      method: "POST",
      body: authBody(playerToken, clientId),
    }),
  lockTopicVoting: (roomCode: string, playerId: string, playerToken: string, clientId: string) =>
    request<RoomStateResponse>(`/api/rooms/${roomCode}/vip/${playerId}/topic-voting/lock`, {
      method: "POST",
      body: authBody(playerToken, clientId),
    }),
  buzzIn: (roomCode: string, playerId: string, playerToken: string, clientId: string) =>
    request<RoomStateResponse>(`/api/rooms/${roomCode}/players/${playerId}/buzz`, {
      method: "POST",
      body: authBody(playerToken, clientId),
    }),
  submitAnswer: (roomCode: string, playerId: string, playerToken: string, clientId: string, answer: string) =>
    request<RoomStateResponse>(`/api/rooms/${roomCode}/players/${playerId}/answer`, {
      method: "POST",
      body: authBody(playerToken, clientId, { answer }),
    }),
  adjudicate: (
    roomCode: string,
    playerId: string,
    playerToken: string,
    clientId: string,
    decision: "accept" | "reject",
  ) =>
    request<RoomStateResponse>(`/api/rooms/${roomCode}/players/${playerId}/adjudication`, {
      method: "POST",
      body: authBody(playerToken, clientId, { decision }),
    }),
  resetRoom: (roomCode: string, playerId: string, playerToken: string, clientId: string) =>
    request<RoomStateResponse>(`/api/rooms/${roomCode}/vip/${playerId}/reset`, {
      method: "POST",
      body: authBody(playerToken, clientId),
    }),
  tickRoom: (roomCode: string) =>
    request<RoomStateResponse>(`/api/rooms/${roomCode}/tick`, {
      method: "POST",
    }),
};

export function getWebSocketUrl(roomCode: string, params: Record<string, string>): string {
  let base: string;
  if (API_BASE) {
    base = API_BASE.replace(/^http/, "ws");
  } else {
    // Same-origin: derive from window.location
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    base = `${protocol}//${window.location.host}`;
  }
  const query = new URLSearchParams(params).toString();
  return `${base}/ws/rooms/${roomCode}?${query}`;
}
