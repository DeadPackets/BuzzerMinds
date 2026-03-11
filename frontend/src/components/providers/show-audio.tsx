"use client";

import { useEffect, useRef } from "react";

import { useRoomLive } from "@/components/providers/room-live-provider";

// ── Phase-triggered SFX (one-shots at 0.6 volume) ──────────────────────────
const SFX_BY_PHASE: Record<string, string> = {
  buzz_open: "/audio/sfx/buzz-open.mp3",
  score_reveal: "/audio/sfx/score-reveal.mp3",
  finished: "/audio/sfx/finish.mp3",
};

// ── Phase-triggered music (loops at 0.25 volume) ───────────────────────────
const MUSIC_BY_PHASE: Record<string, string> = {
  lobby: "/audio/music/lobby-music.mp3",
  question_reveal_progressive: "/audio/music/tension-bed.mp3",
  question_reveal_full: "/audio/music/tension-bed.mp3",
  bonus_answering: "/audio/music/tension-bed.mp3",
  finished: "/audio/music/end-music.mp3",
};

// ── Applause pool (randomly selected on score_reveal) ──────────────────────
const APPLAUSE_COUNT = 20;
const APPLAUSE_PATHS = Array.from(
  { length: APPLAUSE_COUNT },
  (_, i) =>
    `/audio/sfx/applause/applause_${String(i + 1).padStart(2, "0")}.mp3`,
);

export function ShowAudio() {
  const { room } = useRoomLive();
  const prevPhaseRef = useRef<string | null>(null);
  const prevResultRef = useRef<string | null>(null);
  const currentMusic = useRef<HTMLAudioElement | null>(null);

  const sfxEnabled = room.settings.audio.sound_effects_enabled;
  const musicEnabled = room.settings.audio.music_enabled;
  const phase = room.phase;
  const questionResult = room.current_question?.result ?? null;
  const gradingReason = room.current_question?.grading_reason ?? null;
  const adjudicationDecision = room.adjudication?.resolved_decision ?? null;

  // ── Phase-based SFX ──────────────────────────────────────────────────────
  // Fires on every phase *change*, tracking previous phase via ref so the
  // same SFX replays on re-entry (fixes rebuzz not replaying buzz-open).
  useEffect(() => {
    if (!sfxEnabled) return;
    if (phase === prevPhaseRef.current) return;
    prevPhaseRef.current = phase;

    const src = SFX_BY_PHASE[phase];
    if (!src) return;

    const audio = new Audio(src);
    audio.volume = 0.6;
    audio.play().catch(() => undefined);
  }, [phase, sfxEnabled]);

  // ── Result-based SFX (correct / incorrect / time-up) ─────────────────────
  // Watches `current_question.result` for transitions. Distinguishes timeout
  // from wrong answer via `grading_reason`. Handles adjudication outcomes.
  useEffect(() => {
    if (!sfxEnabled) return;
    const result = questionResult;
    const prev = prevResultRef.current;
    prevResultRef.current = result;

    // Only fire on transitions to a meaningful result
    if (result === prev || !result || result === "unanswered") return;

    let src: string | null = null;

    if (result === "correct") {
      src = "/audio/sfx/correct-answer.mp3";
    } else if (result === "incorrect") {
      const isTimeout =
        gradingReason?.includes("expired") ||
        gradingReason?.includes("No buzz received");
      src = isTimeout
        ? "/audio/sfx/time-up.mp3"
        : "/audio/sfx/incorrect-answer.mp3";
    } else if (result === "adjudicated") {
      src =
        adjudicationDecision === "accept"
          ? "/audio/sfx/correct-answer.mp3"
          : "/audio/sfx/incorrect-answer.mp3";
    }

    if (!src) return;

    const audio = new Audio(src);
    audio.volume = 0.6;
    audio.play().catch(() => undefined);
  }, [questionResult, gradingReason, adjudicationDecision, sfxEnabled]);

  // ── Random applause on score_reveal ──────────────────────────────────────
  // React's dependency array on `phase` already ensures this only fires on
  // phase changes — no manual prevPhaseRef guard needed here.
  useEffect(() => {
    if (!sfxEnabled) return;
    if (phase !== "score_reveal") return;

    const idx = Math.floor(Math.random() * APPLAUSE_PATHS.length);
    const audio = new Audio(APPLAUSE_PATHS[idx]);
    audio.volume = 0.4;
    audio.play().catch(() => undefined);
  }, [phase, sfxEnabled]);

  // ── Phase-based music (loops) ────────────────────────────────────────────
  useEffect(() => {
    if (currentMusic.current) {
      currentMusic.current.pause();
      currentMusic.current = null;
    }

    if (!musicEnabled) return;

    const src = MUSIC_BY_PHASE[phase];
    if (!src) return;

    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = 0.25;
    audio.play().catch(() => undefined);
    currentMusic.current = audio;

    return () => {
      audio.pause();
      if (currentMusic.current === audio) {
        currentMusic.current = null;
      }
    };
  }, [phase, musicEnabled]);

  return null;
}
