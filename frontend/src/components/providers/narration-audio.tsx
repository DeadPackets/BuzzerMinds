"use client";

import { useEffect, useRef } from "react";

import { useRoomLive } from "@/components/providers/room-live-provider";

export function NarrationAudio() {
  const { room } = useRoomLive();
  const lastPayload = useRef<string | null>(null);

  useEffect(() => {
    const narration = room.narration;
    if (!narration?.audio_base64 || narration.audio_base64 === lastPayload.current) {
      return;
    }

    const mimeType = narration.mime_type ?? "audio/mpeg";
    const audio = new Audio(`data:${mimeType};base64,${narration.audio_base64}`);
    audio.play().catch(() => undefined);
    lastPayload.current = narration.audio_base64;

    return () => {
      audio.pause();
    };
  }, [room.narration]);

  return null;
}
