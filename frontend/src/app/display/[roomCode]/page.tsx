import { notFound } from "next/navigation";

import { DisplayRoomView } from "@/components/display/display-room-view";
import { API_BASE } from "@/lib/api";

export default async function DisplayRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomCode: string }>;
  searchParams: Promise<{ dt?: string }>;
}) {
  const { roomCode } = await params;
  const { dt } = await searchParams;

  try {
    const response = await fetch(`${API_BASE}/api/rooms/${roomCode}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Room not found");
    }
    const room = await response.json();
    return <DisplayRoomView initialRoom={room} displayToken={dt} />;
  } catch {
    notFound();
  }
}
