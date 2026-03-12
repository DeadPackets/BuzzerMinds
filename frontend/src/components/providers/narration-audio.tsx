"use client";

import { useEffect, useRef } from "react";

import { useRoomLive } from "@/components/providers/room-live-provider";

export function NarrationAudio() {
  const { room } = useRoomLive();
  const lastPayload = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const audioBase64 = room.narration?.audio_base64 ?? null;
  const mimeType = room.narration?.mime_type ?? "audio/mpeg";

  useEffect(() => {
    if (!audioBase64 || audioBase64 === lastPayload.current) {
      return;
    }

    // Stop any previously playing narration
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
    audioRef.current = audio;
    audio.play().catch(() => undefined);
    lastPayload.current = audioBase64;

    return () => {
      audio.pause();
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
    };
  }, [audioBase64, mimeType]);

  return null;
}
