import { notFound } from "next/navigation";

import { PlayerRoomView } from "@/components/player/player-room-view";
import { API_BASE } from "@/lib/api";

export default async function PlayerRoomPage({ params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = await params;

  try {
    const [roomResponse, configResponse] = await Promise.all([
      fetch(`${API_BASE}/api/rooms/${roomCode}`, { cache: "no-store" }),
      fetch(`${API_BASE}/api/config`, { cache: "no-store" }),
    ]);

    if (!roomResponse.ok || !configResponse.ok) {
      throw new Error("Unable to load room");
    }

    const [room, config] = await Promise.all([roomResponse.json(), configResponse.json()]);
    return <PlayerRoomView config={config} initialRoom={room} roomCode={roomCode.toUpperCase()} />;
  } catch {
    notFound();
  }
}
