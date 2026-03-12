"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import {
  Trophy, Clock, Users, Loader2, Hash, ScanLine, Radio,
  Repeat, Timer, Eye, MessageSquare, Shield, Pause, Zap,
  Crown, Volume2,
} from "lucide-react";

import { NarrationAudio } from "@/components/providers/narration-audio";
import { RoomLiveProvider, useRoomLive } from "@/components/providers/room-live-provider";
import { ShowAudio } from "@/components/providers/show-audio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WireframeBackground } from "@/components/ui/wireframe-background";
import { saveDisplaySession } from "@/lib/storage";
import type {
  RoomStateResponse,
  RoomSettingsState,
  RoomPhase,
  PlayerState,
} from "@/lib/types";
import { formatCountdown, formatPhase } from "@/lib/utils";

interface DisplayRoomViewProps {
  initialRoom: RoomStateResponse;
  displayToken?: string;
}

function getJoinUrl(roomCode: string) {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/player/${roomCode}`;
  }
  return `/player/${roomCode}`;
}

function getJoinHost() {
  if (typeof window !== "undefined") {
    return window.location.host;
  }
  return "quiz.deadpackets.pw";
}

/* ── Pop-in animation variants ── */
const popIn = {
  hidden: { opacity: 0, y: 30, scale: 0.92 },
  show: (delay: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.7,
      ease: [0.34, 1.56, 0.64, 1] as const,
      delay,
    },
  }),
};

const slideUp = {
  hidden: { opacity: 0, y: 30 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.34, 1.56, 0.64, 1] as const,
      delay: 0.75,
    },
  },
};

/* ═══════════════════════════════════════════════════════
   FULL FOCUS — Helpers, Hooks, Animation Primitives
   ═══════════════════════════════════════════════════════ */

/* ── Animation primitives ── */
const slamSpring = { type: "spring" as const, stiffness: 400, damping: 25 };
const bounceSpring = { type: "spring" as const, stiffness: 300, damping: 15 };
const snapTween = { type: "tween" as const, duration: 0.25, ease: [0.25, 1, 0.5, 1] as const };
const STAGGER_MS = 0.06; // 60ms stagger

/* ── useCountdown: live seconds remaining ── */
function useCountdown(deadline: string | null) {
  const [remaining, setRemaining] = useState<number>(() => {
    if (!deadline) return 0;
    return Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000));
  });

  useEffect(() => {
    if (!deadline) { setRemaining(0); return; }
    function tick() {
      const diff = Math.max(0, Math.ceil((new Date(deadline!).getTime() - Date.now()) / 1000));
      setRemaining(diff);
    }
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);

  return remaining;
}

/* ── Player pill state derivation ── */
type PillState =
  | "normal" | "eligible" | "buzzing" | "answering"
  | "evaluating" | "correct" | "wrong" | "locked"
  | "bonus" | "disconnected";

function getPlayerPillState(player: PlayerState, room: RoomStateResponse): PillState {
  if (!player.connected) return "disconnected";

  // Grading: the answerer is "evaluating"
  if (room.phase === "grading" && room.current_question?.answering_player_id === player.id) {
    return "evaluating";
  }
  // Score reveal: answerer was correct or wrong
  if (room.phase === "score_reveal" && room.score_reveal) {
    const resolved = room.score_reveal.resolved_question;
    if (resolved && resolved.answering_player_id === player.id) {
      return resolved.result === "correct" || resolved.result === "adjudicated"
        ? "correct" : "wrong";
    }
  }
  if (player.bonus_active) return "bonus";
  if (player.is_answering) return "answering";
  if (room.buzz_state?.winner_player_id === player.id && room.phase === "buzz_open") return "buzzing";
  if (room.buzz_state?.locked_out_player_ids?.includes(player.id)) return "locked";
  if (room.phase === "buzz_open" && room.buzz_state?.eligible_player_ids?.includes(player.id)) return "eligible";
  return "normal";
}

function pillStatusLabel(state: PillState): string | null {
  switch (state) {
    case "buzzing": return "BUZZED";
    case "answering": return "ANSWERING";
    case "evaluating": return "GRADING";
    case "correct": return "CORRECT";
    case "wrong": return "WRONG";
    case "locked": return "LOCKED";
    case "bonus": return "BONUS";
    default: return null;
  }
}

/* ── Bottom Banner Setting Item ── */

function BannerSetting({ icon: Icon, value, label, color }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  value: string;
  label: string;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-12">
      <div className="flex items-center gap-2.5">
        <Icon className="h-7 w-7" style={{ color }} />
        <span
          className="text-[1.3rem] font-bold text-[var(--text-bright)]"
          style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}
        >
          {value}
        </span>
      </div>
      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)]">
        {label}
      </span>
    </div>
  );
}

function BannerDivider() {
  return (
    <div
      className="h-12 w-px shrink-0"
      style={{ background: "rgba(245, 158, 11, 0.12)" }}
    />
  );
}

/* ── Bottom Banner with real settings ── */

function SettingsBanner({ settings }: { settings: RoomSettingsState }) {
  const modeValue = settings.end_mode === "rounds"
    ? `${settings.rounds_count} Rounds`
    : `${settings.timer_minutes} Min`;
  const modeIcon = settings.end_mode === "rounds" ? Repeat : Timer;

  const revealValue = settings.reveal_mode === "progressive" ? "Progressive" : "Full Reveal";

  const answerValue = `${settings.main_answer_seconds}s`;

  const modLabel: Record<string, string> = {
    off: "Off",
    light: "Light",
    family_safe: "Family Safe",
  };
  const moderationValue = modLabel[settings.moderation_mode] ?? "Off";

  return (
    <motion.div
      className="flex items-center justify-center"
      style={{
        padding: "22px 64px",
        borderTop: "1px solid rgba(245, 158, 11, 0.15)",
        background: "rgba(20, 20, 20, 0.6)",
        backdropFilter: "blur(12px)",
      }}
      variants={slideUp}
      initial="hidden"
      animate="show"
    >
      <BannerSetting icon={modeIcon} value={modeValue} label="Game Mode" color="var(--amber)" />
      <BannerDivider />
      <BannerSetting icon={Eye} value={revealValue} label="Reveal" color="var(--sage)" />
      <BannerDivider />
      <BannerSetting icon={MessageSquare} value={answerValue} label="Answer Time" color="var(--rose)" />
      <BannerDivider />
      <BannerSetting icon={Shield} value={moderationValue} label="Moderation" color="var(--sky)" />
    </motion.div>
  );
}

/* ── Display Lobby (Split Towers layout) ── */

function DisplayLobby() {
  const { room } = useRoomLive();
  const vip = room.players.find((p) => p.id === room.vip_player_id) ?? null;

  // Palette of colors for player dots when backend doesn't provide one
  const fallbackColors = ["var(--amber)", "var(--sage)", "var(--rose)", "var(--sky)", "var(--cream)"];

  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      {/* Main content: Split Towers */}
      <div
        className="flex flex-1 items-center"
        style={{ padding: "40px 64px 24px", gap: "80px" }}
      >
        {/* ── Left Tower ── */}
        <div className="flex flex-1 flex-col items-start gap-9">
          {/* Logo */}
          <motion.div
            className="bm-title text-[4.2rem] leading-none"
            style={{ letterSpacing: "-0.02em" }}
            variants={popIn}
            custom={0.1}
            initial="hidden"
            animate="show"
          >
            <span style={{ color: "var(--amber)" }}>Buzzer</span>
            <span style={{ color: "var(--sage)" }}>Minds</span>
          </motion.div>

          {/* Room Code */}
          <motion.div
            variants={popIn}
            custom={0.25}
            initial="hidden"
            animate="show"
          >
            <div className="mb-3 flex items-center gap-2 text-[0.85rem] font-semibold uppercase tracking-[0.1em] text-[var(--text-dim)]">
              <Hash className="h-4 w-4 text-[var(--amber)]" />
              Room Code
            </div>
            <div className="mb-4 flex gap-1.5">
              {room.code.split("").map((char, i) => (
                <span
                  key={i}
                  className="inline-block text-[var(--amber)]"
                  style={{
                    fontFamily: "var(--font-display), system-ui, sans-serif",
                    fontSize: "7.5rem",
                    fontWeight: 900,
                    lineHeight: 1,
                    letterSpacing: "-0.02em",
                    fontVariantNumeric: "tabular-nums",
                    animation: `bm-char-wave 2s ease-in-out ${i * 0.12}s infinite`,
                  }}
                >
                  {char}
                </span>
              ))}
            </div>
            <p className="text-[1.1rem] text-[var(--text-dim)]">
              Enter at{" "}
              <strong className="font-bold text-[var(--sage)]">{getJoinHost()}</strong>
            </p>
          </motion.div>
        </div>

        {/* ── Right Tower ── */}
        <div className="flex flex-1 flex-col items-end gap-9">
          {/* QR Card */}
          <motion.div
            className="rounded-[14px] p-6 text-center"
            style={{
              background: "var(--surface)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(74, 222, 128, 0.25)",
            }}
            variants={popIn}
            custom={0.35}
            initial="hidden"
            animate="show"
          >
            <div className="mx-auto mb-4 flex h-[220px] w-[220px] items-center justify-center overflow-hidden rounded-[10px] bg-white">
              <QRCodeSVG value={getJoinUrl(room.code)} size={200} level="M" />
            </div>
            <div className="flex items-center justify-center gap-2 text-[0.9rem] font-semibold text-[var(--sage)]">
              <ScanLine className="h-[18px] w-[18px]" />
              Scan to join
            </div>
          </motion.div>

          {/* Players Card */}
          <motion.div
            className="min-w-[280px] rounded-[14px] p-6"
            style={{
              background: "var(--surface)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(251, 113, 133, 0.25)",
            }}
            variants={popIn}
            custom={0.5}
            initial="hidden"
            animate="show"
          >
            <div className="mb-4 flex items-center gap-2 text-[1rem] font-bold text-[var(--text-bright)]" style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}>
              <Users className="h-[18px] w-[18px] text-[var(--rose)]" />
              Players <span className="font-medium text-[var(--text-dim)]">({room.players.length} joined)</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {room.players.map((player, i) => (
                <div key={player.id} className="flex items-center gap-2.5 text-[1.15rem] font-medium">
                  <div
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: player.color || fallbackColors[i % fallbackColors.length] }}
                  />
                  <span className="text-[var(--text-bright)]">{player.name}</span>
                  {player.id === room.vip_player_id ? (
                    <span
                      className="ml-auto rounded px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.1em]"
                      style={{
                        fontFamily: "var(--font-display), system-ui, sans-serif",
                        background: "var(--amber)",
                        color: "var(--bg)",
                      }}
                    >
                      VIP
                    </span>
                  ) : null}
                </div>
              ))}
              {room.players.length === 0 ? (
                <p className="py-2 text-center text-sm text-[var(--text-dim)]">No players yet. Share the room code!</p>
              ) : null}
            </div>
          </motion.div>

          {/* Status Card */}
          <motion.div
            className="rounded-[14px] p-6"
            style={{
              background: "var(--surface)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(255, 255, 255, 0.04)",
            }}
            variants={popIn}
            custom={0.6}
            initial="hidden"
            animate="show"
          >
            <div className="flex items-center gap-2.5 text-[0.95rem] font-medium text-[var(--text-dim)]">
              <div className="bm-live-dot" />
              <Radio className="h-[18px] w-[18px] text-[var(--sky)]" />
              {vip
                ? "Waiting for host to start the game..."
                : "Waiting for the first player to become VIP..."}
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── Bottom Banner ── */}
      <SettingsBanner settings={room.settings} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   FULL FOCUS — Component Architecture
   ═══════════════════════════════════════════════════════ */

/* ── FFTimer: Circular SVG timer (top-right) ── */

function FFTimer({
  deadline,
  totalSeconds,
  label,
}: {
  deadline: string | null;
  totalSeconds: number;
  label: string;
}) {
  const remaining = useCountdown(deadline);
  const progress = totalSeconds > 0 ? remaining / totalSeconds : 0;
  const isWarning = remaining > 0 && remaining <= 5;

  // SVG ring geometry
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const dashoffset = circumference * (1 - progress);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const display = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  if (!deadline) return null;

  return (
    <motion.div
      className={`bm-ff-timer ${isWarning ? "bm-ff-timer--warning" : ""}`}
             initial={{ y: -60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -40, opacity: 0, scale: 0.8, transition: { duration: 0.25, ease: "easeIn" } }}
              transition={slamSpring}
    >
      <div className="bm-ff-timer-ring">
        {/* SVG ring */}
        <svg className="bm-ff-timer-svg" viewBox="0 0 100 100">
          <circle className="bm-ff-timer-bg" cx="50" cy="50" r={r} />
          <circle
            className="bm-ff-timer-fg"
            cx="50" cy="50" r={r}
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
          />
        </svg>
        {/* Invert layer for exclusion blend */}
        <div className="bm-ff-timer-invert">
          <svg className="bm-ff-timer-svg" viewBox="0 0 100 100">
            <circle
              className="bm-ff-timer-invert-fill"
              cx="50" cy="50" r={r}
              strokeDasharray={circumference}
              strokeDashoffset={dashoffset}
            />
          </svg>
        </div>
        {/* Time value */}
        <span className="bm-ff-timer-value">{display}</span>
      </div>
      <span className="bm-ff-timer-label">{label}</span>
    </motion.div>
  );
}

/* ── FFPlayerPill: Single player pill with state ── */

function FFPlayerPill({
  player,
  state,
  isVip,
  index,
}: {
  player: PlayerState;
  state: PillState;
  isVip: boolean;
  index: number;
}) {
  const statusLabel = pillStatusLabel(state);

  return (
    <motion.div
      className={`bm-ff-pill bm-ff-pill--${state}`}
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 30, opacity: 0 }}
      transition={{ ...bounceSpring, delay: index * STAGGER_MS }}
      layout
    >
      <div
        className="bm-ff-pill-swatch"
        style={{ background: player.color || "var(--text-dim)" }}
      />
      <span className="bm-ff-pill-name">{player.name}</span>
      <span className="bm-ff-pill-score">{player.score}</span>
      {isVip ? <span className="bm-ff-pill-vip">VIP</span> : null}
      {statusLabel ? (
        <span className="bm-ff-pill-status">{statusLabel}</span>
      ) : null}
    </motion.div>
  );
}

/* ── FFPlayers: Bottom row of player pills ── */

function FFPlayers() {
  const { room } = useRoomLive();

  return (
    <div className="bm-ff-pills">
      <AnimatePresence mode="popLayout">
        {room.players.map((player, i) => (
          <FFPlayerPill
            key={player.id}
            player={player}
            state={getPlayerPillState(player, room)}
            isVip={player.id === room.vip_player_id}
            index={i}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ── FFLogo: Top-left logo + phase badge + progress ── */

function FFLogo() {
  const { room } = useRoomLive();
  const progress = room.progress;
  const phaseBadgeColor = (() => {
    switch (room.phase) {
      case "buzz_open": return "amber";
      case "answering": case "grading": return "sage";
      case "score_reveal": case "finished": return "rose";
      case "bonus_loading": case "bonus_answering": return "sky";
      default: return "dim";
    }
  })();

  return (
    <motion.div
      className="bm-ff-logo"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={bounceSpring}
    >
      <motion.span className="bm-ff-logo-text" layoutId="bm-logo">
        <span style={{ color: "var(--amber)" }}>Buzzer</span>
        <span style={{ color: "var(--sage)" }}>Minds</span>
      </motion.span>
      <span className={`bm-ff-badge bm-ff-badge--${phaseBadgeColor}`}>
        {formatPhase(room.phase)}
      </span>
      {progress ? (
        <span className="bm-ff-progress">
          R{(progress.completed_rounds ?? 0) + 1}
          {progress.current_topic_label ? ` · ${progress.current_topic_label}` : ""}
        </span>
      ) : null}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════
   FULL FOCUS — Phase Center Components
   ═══════════════════════════════════════════════════════ */

/* ── FFTopicVoting ── */
function FFTopicVoting() {
  const { room } = useRoomLive();
  const tv = room.topic_voting;
  if (!tv) return null;

  const isLocked = tv.status === "locked";
  const topics = isLocked ? tv.selected_topics : tv.options;

  return (
    <motion.div
      key="ff-topic-voting"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85, y: -30 }}
      transition={bounceSpring}
      style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <div className="bm-ff-topic">
        <span className={`bm-ff-badge ${isLocked ? "bm-ff-badge--sage" : "bm-ff-badge--rose"}`}>
          {isLocked ? "Winning Topics" : "Vote for Topics"}
        </span>
      </div>
      {!isLocked && (
        <p className="bm-ff-question--smaller" style={{ color: "var(--text-dim)", marginBottom: 12 }}>
          Approve up to {tv.max_approvals_per_player} topics each
        </p>
      )}
      <div className="bm-ff-topic-grid" style={isLocked ? { gridTemplateColumns: `repeat(${Math.min(topics.length, 4)}, 1fr)` } : undefined}>
        {topics.map((topic, i) => (
          <motion.div
            key={topic.id}
            className={`bm-ff-topic-card ${isLocked ? "bm-ff-topic-card--winner" : topic.approval_count > 0 ? "bm-ff-topic-card--voted" : ""}`}
            initial={{ opacity: 0, y: 20, scale: isLocked ? 0.8 : 1 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8, y: -20 }}
            transition={{ ...bounceSpring, delay: i * (isLocked ? 0.15 : STAGGER_MS) }}
          >
            {isLocked && <Trophy size={20} style={{ color: "var(--sage)", marginBottom: 4 }} />}
            <div className="bm-ff-topic-name">{topic.label}</div>
            <div className="bm-ff-topic-votes">{topic.approval_count} votes</div>
            <div className="bm-ff-topic-source">{topic.source}</div>
          </motion.div>
        ))}
      </div>
      {isLocked && (
        <motion.div
          className="bm-ff-loading"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...bounceSpring, delay: topics.length * 0.15 + 0.3 }}
          style={{ marginTop: 32 }}
        >
          <div className="bm-ff-spinner" />
          <div className="bm-ff-loading-text">Generating first question...</div>
        </motion.div>
      )}
    </motion.div>
  );
}

/* ── FFQuestionLoading ── */
function FFQuestionLoading() {
  const { room } = useRoomLive();
  return (
    <motion.div
      key="ff-question-loading"
      className="bm-ff-loading"
      initial={{ opacity: 0, y: 30, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={bounceSpring}
    >
      <div className="bm-ff-spinner" />
      <div className="bm-ff-loading-text">Preparing your question...</div>
      {room.progress?.current_topic_label ? (
        <div className="bm-ff-loading-topic">{room.progress.current_topic_label}</div>
      ) : null}
    </motion.div>
  );
}

/* ── FFQuestionReveal (progressive + full) ── */
function FFQuestionReveal() {
  const { room } = useRoomLive();
  const q = room.current_question;
  if (!q) return null;

  const isProgressive = room.phase === "question_reveal_progressive";
  const chunks = q.question.prompt_chunks;
  const revealIndex = q.question.reveal_index;
  const isLong = q.question.prompt.length > 140;

  return (
    <motion.div
      key="ff-question-reveal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={snapTween}
      style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <div className="bm-ff-topic">
        <span className="bm-ff-badge bm-ff-badge--rose">{q.question.topic_label}</span>
      </div>
      <p className={`bm-ff-question ${isLong ? "bm-ff-question--smaller" : ""}`}>
        {isProgressive
          ? chunks.map((chunk, i) => {
              const isVisible = i < revealIndex;
              const isLatest = i === revealIndex - 1;
              return (
                <motion.span
                  key={i}
                  className={
                    isVisible
                      ? isLatest
                        ? "bm-ff-chunk--latest"
                        : "bm-ff-chunk--visible"
                      : "bm-ff-chunk--hidden"
                  }
                  initial={isLatest ? { opacity: 0, x: 20 } : undefined}
                  animate={isLatest ? { opacity: 1, x: 0 } : undefined}
                  transition={isLatest ? bounceSpring : undefined}
                >
                  {chunk}{" "}
                </motion.span>
              );
            })
          : q.question.prompt}
      </p>
    </motion.div>
  );
}

/* ── FFBuzzOpen: Question shown with "BUZZ NOW!" or "buzzed in" celebration ── */
function FFBuzzOpen() {
  const { room } = useRoomLive();
  const q = room.current_question;
  if (!q) return null;
  const isLong = q.question.prompt.length > 140;
  const bs = room.buzz_state;
  const winner = bs?.winner_player_id
    ? room.players.find((p) => p.id === bs.winner_player_id)
    : null;

  return (
    <motion.div
      key="ff-buzz-open"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={snapTween}
      style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <div className="bm-ff-topic">
        <span className={`bm-ff-badge ${winner ? "bm-ff-badge--sage" : "bm-ff-badge--amber"}`}>
          {winner ? (
            <><Zap style={{ width: 12, height: 12 }} /> Buzzed In!</>
          ) : (
            <><Zap style={{ width: 12, height: 12 }} /> Buzz Now!</>
          )}
        </span>
      </div>
      <p className={`bm-ff-question ${isLong ? "bm-ff-question--smaller" : ""}`}>
        {q.question.prompt}
      </p>
      {winner ? (
        <motion.div
          className="bm-ff-answerer"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={bounceSpring}
        >
          <div className="bm-ff-answerer-dot" />
          {winner.name} buzzed in!
        </motion.div>
      ) : null}
    </motion.div>
  );
}

/* ── FFAnswering: Question + answerer badge ── */
function FFAnswering() {
  const { room } = useRoomLive();
  const q = room.current_question;
  if (!q) return null;
  const answerer = room.players.find((p) => p.id === q.answering_player_id);
  const isLong = q.question.prompt.length > 140;

  return (
    <motion.div
      key="ff-answering"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={snapTween}
      style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <div className="bm-ff-topic">
        <span className="bm-ff-badge bm-ff-badge--sage">Answering</span>
      </div>
      <p className={`bm-ff-question ${isLong ? "bm-ff-question--smaller" : ""}`}>
        {q.question.prompt}
      </p>
      {answerer ? (
        <motion.div
          className="bm-ff-answerer"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={bounceSpring}
        >
          <div className="bm-ff-answerer-dot" />
          <span>{answerer.name} is answering...</span>
        </motion.div>
      ) : null}
    </motion.div>
  );
}

/* ── FFGrading: Question + submitted answer + spinner ── */
function FFGrading() {
  const { room } = useRoomLive();
  const q = room.current_question;
  if (!q) return null;
  const answerer = room.players.find((p) => p.id === q.answering_player_id);
  const isLong = q.question.prompt.length > 140;

  return (
    <motion.div
      key="ff-grading"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={bounceSpring}
      style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <div className="bm-ff-topic">
        <span className="bm-ff-badge bm-ff-badge--amber">Grading</span>
      </div>
      <p className={`bm-ff-question ${isLong ? "bm-ff-question--smaller" : ""}`}>
        {q.question.prompt}
      </p>
      <motion.div
        className="bm-ff-grading"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...bounceSpring, delay: 0.15 }}
      >
        <div className="bm-ff-grading-spinner" />
        <div className="bm-ff-grading-answer">
          <div className="bm-ff-grading-label">
            {answerer?.name ?? "Player"}&apos;s answer
          </div>
          <div className="bm-ff-grading-value">
            {q.submitted_answer ?? "No answer submitted"}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── FFScoreReveal: Headline + wrong answer + correct answer + standings ── */
function FFScoreReveal() {
  const { room } = useRoomLive();
  const sr = room.score_reveal;
  if (!sr) return null;

  const resolved = sr.resolved_question;
  const isCorrect = resolved?.result === "correct" || resolved?.result === "adjudicated";
  const isTimeout = !resolved?.answering_player_id;
  const answerer = resolved?.answering_player_id
    ? room.players.find((p) => p.id === resolved.answering_player_id)
    : null;

  return (
    <motion.div
      key="ff-score-reveal"
      className="bm-ff-score-reveal"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, x: -40 }}
      transition={bounceSpring}
    >
      <motion.div
        className="bm-ff-score-headline"
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={slamSpring}
      >
        {sr.headline}
      </motion.div>

      {/* Timeout: nobody buzzed */}
      {resolved && isTimeout ? (
        <motion.div
          className="bm-ff-timeout"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...bounceSpring, delay: 0.1 }}
        >
          <Clock style={{ width: 36, height: 36, color: "var(--rose)" }} />
          <div className="bm-ff-timeout-text">Nobody buzzed in</div>
          <div className="bm-ff-timeout-sub">
            The clock ran out before anyone pressed the buzzer.
          </div>
        </motion.div>
      ) : null}

      {/* Wrong answer rose card */}
      {resolved && !isCorrect && !isTimeout ? (
        <motion.div
          className="bm-ff-wrong-answer-card"
          initial={{ opacity: 0, rotateY: 90 }}
          animate={{ opacity: 1, rotateY: 0 }}
          transition={{ ...bounceSpring, delay: 0.1 }}
          style={{ perspective: 600 }}
        >
          <div style={{ fontWeight: 700, color: "var(--rose)", fontSize: "0.95rem" }}>
            {answerer?.name ?? "Player"} answered: &ldquo;{resolved.submitted_answer}&rdquo;
          </div>
          {resolved.grading_reason ? (
            <div style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginTop: 4 }}>
              {resolved.grading_reason}
            </div>
          ) : null}
        </motion.div>
      ) : null}

      {/* Correct answer card (always shown when resolved) */}
      {resolved ? (
        <motion.div
          className="bm-ff-correct-answer"
          initial={{ opacity: 0, rotateY: 90 }}
          animate={{ opacity: 1, rotateY: 0 }}
          transition={{ ...bounceSpring, delay: isCorrect ? 0.15 : 0.25 }}
          style={{ perspective: 600 }}
        >
          <div className="bm-ff-correct-answer-label">
            Correct: {resolved.correct_answer}
          </div>
          <div className="bm-ff-correct-answer-detail">
            {resolved.fact_card.detail}
          </div>
        </motion.div>
      ) : null}

      <div className="bm-ff-standings">
        {sr.standings.map((entry, i) => {
          const player = room.players.find((p) => p.id === entry.player_id);
          const event = sr.events.find((e) => e.player_id === entry.player_id);
          return (
            <motion.div
              key={entry.player_id}
              className={`bm-ff-standing-row ${entry.rank === 1 ? "bm-ff-standing-row--winner" : ""}`}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...bounceSpring, delay: 0.25 + i * STAGGER_MS }}
            >
              <div className="bm-ff-standing-rank">
                {entry.rank <= 3 ? (
                  <Trophy
                    style={{
                      width: 18, height: 18,
                      color: entry.rank === 1 ? "var(--amber)" : entry.rank === 2 ? "#9ca3af" : "#b45309",
                    }}
                  />
                ) : (
                  <span style={{ color: "var(--text-dim)" }}>#{entry.rank}</span>
                )}
              </div>
              <div className="bm-ff-standing-name">
                <div
                  className="bm-ff-swatch"
                  style={{ background: player?.color || "var(--text-dim)" }}
                />
                {player?.name ?? entry.player_id}
              </div>
              <span className="bm-ff-standing-score">{entry.score} pts</span>
              {event && event.delta !== 0 ? (
                <span className={`bm-ff-standing-delta ${event.delta > 0 ? "bm-ff-standing-delta--plus" : "bm-ff-standing-delta--minus"}`}>
                  {event.delta > 0 ? "+" : ""}{event.delta}
                </span>
              ) : null}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ── FFBonusLoading ── */
function FFBonusLoading() {
  const { room } = useRoomLive();
  const bc = room.bonus_chain;
  if (!bc) return null;
  const bonusPlayer = room.players.find((p) => p.id === bc.awarded_player_id);

  return (
    <motion.div
      key="ff-bonus-loading"
      className="bm-ff-loading"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={bounceSpring}
    >
      <div className="bm-ff-spinner bm-ff-spinner--sky" />
      <div className="bm-ff-loading-text">Bonus Round!</div>
      <div className="bm-ff-loading-topic" style={{ color: "var(--sky)" }}>
        {bonusPlayer?.name ?? "Player"} earned a bonus chain
      </div>
    </motion.div>
  );
}

/* ── FFBonusAnswering: Bonus question + progress dots with result feedback ── */
function FFBonusAnswering() {
  const { room } = useRoomLive();
  const bc = room.bonus_chain;
  if (!bc) return null;

  const bonusPlayer = room.players.find((p) => p.id === bc.awarded_player_id);
  const currentQ = bc.questions[bc.current_index] ?? null;
  const prevQ = bc.current_index > 0 ? bc.questions[bc.current_index - 1] : null;

  return (
    <motion.div
      key={`ff-bonus-answering-${bc.current_index}`}
      initial={{ opacity: 0, rotateY: 90 }}
      animate={{ opacity: 1, rotateY: 0 }}
      exit={{ opacity: 0, rotateY: -90 }}
      transition={bounceSpring}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", perspective: 800 }}
    >
      <div className="bm-ff-topic">
        <span className="bm-ff-badge bm-ff-badge--sky">
          Bonus {bc.current_index + 1} of {bc.total_questions}
        </span>
      </div>
      <p className="bm-ff-question bm-ff-question--smaller">
        {currentQ?.prompt ?? "Loading..."}
      </p>
      <motion.div
        className="bm-ff-answerer bm-ff-answerer--bonus"
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...bounceSpring, delay: 0.1 }}
      >
        <div className="bm-ff-answerer-dot" />
        <span>{bonusPlayer?.name ?? "Player"} is answering...</span>
      </motion.div>
      {/* Progress dots with correct/incorrect coloring */}
      <div className="bm-ff-bonus-progress">
        {Array.from({ length: bc.total_questions }).map((_, i) => {
          const q = bc.questions[i];
          const dotClass = i < bc.current_index
            ? q?.result === "correct"
              ? "bm-ff-bonus-dot--correct"
              : "bm-ff-bonus-dot--incorrect"
            : i === bc.current_index
              ? "bm-ff-bonus-dot--current"
              : "bm-ff-bonus-dot--upcoming";
          return (
            <div key={i} className={`bm-ff-bonus-dot ${dotClass}`} />
          );
        })}
      </div>
      {/* Previous question result feedback */}
      {prevQ && prevQ.result !== "unanswered" && (
        <motion.div
          className={`bm-ff-bonus-result ${prevQ.result === "correct" ? "bm-ff-bonus-result--correct" : "bm-ff-bonus-result--incorrect"}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...bounceSpring, delay: 0.15 }}
        >
          {prevQ.result === "correct" ? (
            <><Zap size={14} /> Correct! +5</>
          ) : (
            <><Clock size={14} /> {prevQ.grading_reason ?? "Incorrect"}</>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

/* ── FFPaused ── */
function FFPaused() {
  const { room } = useRoomLive();
  const ps = room.pause_state;
  if (!ps) return null;

  return (
    <motion.div
      key="ff-paused"
      className="bm-ff-paused"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={bounceSpring}
    >
      <div className="bm-ff-paused-icon">
        <Pause style={{ width: 28, height: 28, color: "var(--amber)" }} />
      </div>
      <div className="bm-ff-paused-title">Game Paused</div>
      <div className="bm-ff-paused-reason">{ps.reason}</div>
      <div className="bm-ff-timeout">
        <div className="bm-ff-timeout-text">{formatCountdown(ps.deadline_at)}</div>
        <div className="bm-ff-timeout-sub">until auto-end</div>
      </div>
    </motion.div>
  );
}

/* ── FFFinished: Final standings ── */
function FFFinished() {
  const { room } = useRoomLive();
  const fin = room.finished;
  if (!fin) return null;

  const winner = fin.winners[0]
    ? room.players.find((p) => p.id === fin.winners[0])
    : null;

  return (
    <motion.div
      key="ff-finished"
      className="bm-ff-finished"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={bounceSpring}
    >
      <motion.div
        className="bm-ff-finished-title"
        initial={{ y: -40, opacity: 0, scale: 1.3 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={slamSpring}
      >
        Game Over!
      </motion.div>
      {winner ? (
        <motion.div
          className="bm-ff-finished-sub"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <Crown style={{ display: "inline", width: 18, height: 18, color: "var(--amber)", verticalAlign: "text-bottom" }} />{" "}
          <span style={{ color: "var(--amber)", fontWeight: 700 }}>{winner.name}</span> wins!
        </motion.div>
      ) : (
        <div className="bm-ff-finished-sub">
          {fin.reason.replace(/_/g, " ")}
        </div>
      )}

      <div className="bm-ff-standings" style={{ maxWidth: 500, margin: "0 auto" }}>
        {fin.standings.map((entry, i) => {
          const player = room.players.find((p) => p.id === entry.player_id);
          const isWinner = fin.winners.includes(entry.player_id);
          return (
            <motion.div
              key={entry.player_id}
              className={`bm-ff-standing-row ${isWinner ? "bm-ff-standing-row--winner" : ""}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...bounceSpring, delay: 0.4 + i * STAGGER_MS }}
            >
              <div className="bm-ff-standing-rank">
                {entry.rank <= 3 ? (
                  <Trophy
                    style={{
                      width: 18, height: 18,
                      color: entry.rank === 1 ? "var(--amber)" : entry.rank === 2 ? "#9ca3af" : "#b45309",
                    }}
                  />
                ) : (
                  <span style={{ color: "var(--text-dim)" }}>#{entry.rank}</span>
                )}
              </div>
              <div className="bm-ff-standing-name">
                <div
                  className="bm-ff-swatch"
                  style={{ background: player?.color || "var(--text-dim)" }}
                />
                {player?.name ?? entry.player_id}
              </div>
              <span className={`bm-ff-standing-score ${isWinner ? "" : ""}`}
                    style={isWinner ? { color: "var(--sage)" } : undefined}>
                {entry.score} pts
              </span>
            </motion.div>
          );
        })}
      </div>

      {fin.summary_id ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          style={{ marginTop: 20 }}
        >
          <Button asChild className="rounded-xl" variant="outline">
            <Link href={`/summary/${fin.summary_id}`}>View Full Summary</Link>
          </Button>
        </motion.div>
      ) : null}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════
   FULL FOCUS — Center Router + Overlay + Splash
   ═══════════════════════════════════════════════════════ */

/* ── FFCenter: AnimatePresence switching center content by phase ── */
function FFCenter() {
  const { room } = useRoomLive();

  const centerContent = useMemo(() => {
    switch (room.phase) {
      case "intro":
        return null;
      case "topic_voting":
        return <FFTopicVoting />;
      case "question_loading":
        return <FFQuestionLoading />;
      case "question_reveal_progressive":
      case "question_reveal_full":
        return <FFQuestionReveal />;
      case "buzz_open":
        return <FFBuzzOpen />;
      case "answering":
        return <FFAnswering />;
      case "grading":
        return <FFGrading />;
      case "score_reveal":
        return <FFScoreReveal />;
      case "bonus_loading":
        return <FFBonusLoading />;
      case "bonus_answering":
        return <FFBonusAnswering />;
      case "paused_waiting_for_vip":
        return <FFPaused />;
      case "finished":
        return <FFFinished />;
      default:
        return (
          <motion.div
            key="ff-standby"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={snapTween}
            className="bm-ff-loading"
          >
            <div className="bm-ff-spinner" />
            <div className="bm-ff-loading-text">Stand by...</div>
          </motion.div>
        );
    }
  }, [room.phase, room]);

  return (
    <AnimatePresence mode="wait">
      {centerContent}
    </AnimatePresence>
  );
}

/* ── FFOverlay: Flash effects triggered by phase changes ── */
function FFOverlay() {
  const { room } = useRoomLive();
  const [flash, setFlash] = useState<string | null>(null);
  const prevPhaseRef = useRef<RoomPhase>(room.phase);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    const next = room.phase;
    prevPhaseRef.current = next;

    if (prev === next) return;

    // Determine flash color based on transition
    let color: string | null = null;
    if (next === "buzz_open") color = "amber";
    else if (next === "score_reveal") {
      const result = room.score_reveal?.resolved_question?.result;
      color = result === "correct" || result === "adjudicated" ? "sage" : "rose";
    } else if (next === "bonus_loading" || next === "bonus_answering") color = "sky";
    else if (next === "grading") color = "amber";

    if (color) {
      setFlash(color);
      const timer = setTimeout(() => setFlash(null), 200);
      return () => clearTimeout(timer);
    }
  }, [room.phase, room.score_reveal]);

  return (
    <AnimatePresence>
      {flash ? (
        <motion.div
          key={`flash-${flash}`}
          className={`bm-ff-overlay bm-ff-overlay--${flash}`}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        />
      ) : null}
    </AnimatePresence>
  );
}

/* ── FFIntro: Narrated introduction demo sequence ── */

const DEMO_PLAYERS = [
  { name: "Alex", color: "#f59e0b", score: 0 },
  { name: "Jordan", color: "#4ade80", score: 0 },
  { name: "Sam", color: "#fb7185", score: 0 },
  { name: "Riley", color: "#38bdf8", score: 0 },
];

const DEMO_TOPICS = [
  { label: "World History", votes: 3 },
  { label: "Pop Culture", votes: 2 },
  { label: "Space & Science", votes: 4 },
  { label: "Geography", votes: 1 },
  { label: "Sports Legends", votes: 2 },
  { label: "Music Trivia", votes: 3 },
];

const DEMO_QUESTION_CHUNKS = [
  "This ancient",
  "wonder of the world",
  "located in Egypt,",
  "is the only one",
  "still standing today.",
];

const DEMO_BONUS_PROMPTS = [
  "What is the capital of France?",
  "Which planet is known as the Red Planet?",
  "What year did the Titanic sink?",
];

type IntroStage =
  | "welcome"
  | "howtoplay"
  | "topics"
  | "reveal"
  | "buzzer"
  | "answering"
  | "grading"
  | "bonus"
  | "standings"
  | "letsgo";

const INTRO_TIMELINE: { stage: IntroStage; at: number }[] = [
  { stage: "welcome", at: 0 },
  { stage: "howtoplay", at: 4000 },
  { stage: "topics", at: 7000 },
  { stage: "reveal", at: 16000 },
  { stage: "buzzer", at: 28000 },
  { stage: "answering", at: 36000 },
  { stage: "grading", at: 42000 },
  { stage: "bonus", at: 52000 },
  { stage: "standings", at: 62000 },
  { stage: "letsgo", at: 74000 },
];

function FFIntro({
  onComplete,
  speedRef,
}: {
  onComplete: () => void;
  speedRef: React.MutableRefObject<number>;
}) {
  const [stage, setStage] = useState<IntroStage>("welcome");
  const [revealIndex, setRevealIndex] = useState(0);
  const [topicVotes, setTopicVotes] = useState(() => DEMO_TOPICS.map((t) => ({ ...t, votes: 0 })));
  const [bonusIndex, setBonusIndex] = useState(0);
  const [gradingResult, setGradingResult] = useState<"pending" | "correct" | "incorrect">("pending");
  const [demoPillStates, setDemoPillStates] = useState<Record<string, string>>({});
  const [demoTimer, setDemoTimer] = useState<number | null>(null);
  const demoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const completedRef = useRef(false);

  // Play narration audio on mount
  useEffect(() => {
    const audio = new Audio("/audio/intro-narration.mp3");
    audio.volume = 0.85;
    audioRef.current = audio;

    const onEnded = () => {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete();
      }
    };
    audio.addEventListener("ended", onEnded);
    audio.play().catch(() => {
      // Autoplay blocked — still run the demo visually, complete on timeline
    });

    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      audioRef.current = null;
    };
  }, [onComplete]);

  // Stage timeline
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const entry of INTRO_TIMELINE) {
      timers.push(
        setTimeout(() => setStage(entry.stage), entry.at)
      );
    }
    // Fallback auto-complete at 80s if audio hasn't ended
    timers.push(
      setTimeout(() => {
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete();
        }
      }, 85000)
    );
    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  // Progressive reveal animation (during "reveal" stage)
  useEffect(() => {
    if (stage !== "reveal") return;
    setRevealIndex(0);
    const interval = setInterval(() => {
      setRevealIndex((prev) => {
        if (prev >= DEMO_QUESTION_CHUNKS.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [stage]);

  // Topic vote animation (during "topics" stage)
  useEffect(() => {
    if (stage !== "topics") return;
    setTopicVotes(DEMO_TOPICS.map((t) => ({ ...t, votes: 0 })));
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Staggered vote animations
    const voteSchedule = [
      { topicIdx: 2, delay: 800 },
      { topicIdx: 0, delay: 1400 },
      { topicIdx: 5, delay: 2000 },
      { topicIdx: 2, delay: 2600 },
      { topicIdx: 1, delay: 3200 },
      { topicIdx: 0, delay: 3800 },
      { topicIdx: 2, delay: 4400 },
      { topicIdx: 5, delay: 5000 },
      { topicIdx: 4, delay: 5600 },
      { topicIdx: 3, delay: 6200 },
      { topicIdx: 0, delay: 6800 },
      { topicIdx: 2, delay: 7400 },
    ];
    for (const { topicIdx, delay } of voteSchedule) {
      timers.push(
        setTimeout(() => {
          setTopicVotes((prev) =>
            prev.map((t, i) => (i === topicIdx ? { ...t, votes: t.votes + 1 } : t))
          );
        }, delay)
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [stage]);

  // Grading animation (during "grading" stage)
  // Shows: pending → correct (+10) → pending → incorrect (-5 early buzz)
  useEffect(() => {
    if (stage !== "grading") return;
    setGradingResult("pending");
    const timers = [
      setTimeout(() => setGradingResult("correct"), 2000),
      setTimeout(() => setGradingResult("pending"), 5000),
      setTimeout(() => setGradingResult("incorrect"), 6500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [stage]);

  // Bonus index animation
  useEffect(() => {
    if (stage !== "bonus") return;
    setBonusIndex(0);
    const timers = [
      setTimeout(() => setBonusIndex(1), 3000),
      setTimeout(() => setBonusIndex(2), 6000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [stage]);

  // Speed up wireframe during intro
  useEffect(() => {
    speedRef.current = 1.5;
    return () => {
      speedRef.current = 1;
    };
  }, [speedRef]);

  // Demo pill state transitions (buzzing → answering → correct)
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (stage === "buzzer") {
      // Jordan buzzes in after 1.5s
      setDemoPillStates({});
      timers.push(setTimeout(() => setDemoPillStates({ Jordan: "buzzing" }), 1500));
    } else if (stage === "answering") {
      setDemoPillStates({ Jordan: "answering" });
    } else if (stage === "grading") {
      setDemoPillStates({ Jordan: "evaluating" });
      timers.push(setTimeout(() => setDemoPillStates({ Jordan: "correct" }), 2000));
      timers.push(setTimeout(() => setDemoPillStates({ Jordan: "evaluating" }), 5000));
      timers.push(setTimeout(() => setDemoPillStates({ Jordan: "incorrect" }), 6500));
    } else if (stage === "bonus") {
      setDemoPillStates({ Jordan: "answering" });
    } else {
      setDemoPillStates({});
    }
    return () => timers.forEach(clearTimeout);
  }, [stage]);

  // Demo timer countdown (during reveal, buzzer, answering, grading stages)
  useEffect(() => {
    if (demoTimerRef.current) {
      clearInterval(demoTimerRef.current);
      demoTimerRef.current = null;
    }
    if (stage === "reveal") {
      setDemoTimer(30);
      demoTimerRef.current = setInterval(() => {
        setDemoTimer((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
      }, 1000);
    } else if (stage === "buzzer") {
      setDemoTimer(15);
      demoTimerRef.current = setInterval(() => {
        setDemoTimer((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
      }, 1000);
    } else if (stage === "answering") {
      setDemoTimer(20);
      demoTimerRef.current = setInterval(() => {
        setDemoTimer((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
      }, 1000);
    } else {
      setDemoTimer(null);
    }
    return () => {
      if (demoTimerRef.current) {
        clearInterval(demoTimerRef.current);
        demoTimerRef.current = null;
      }
    };
  }, [stage]);

  return (
    <motion.div
      className="bm-intro-display"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.6 }}
    >
      {/* Top-left logo (static, not using room data) */}
      <div className="bm-intro-logo">
        <span className="bm-ff-logo-text">
          <span style={{ color: "var(--amber)" }}>Buzzer</span>
          <span style={{ color: "var(--sage)" }}>Minds</span>
        </span>
      </div>

      {/* Demo timer (top-right, during reveal/buzzer/answering) */}
      <AnimatePresence>
        {demoTimer !== null && (
          <motion.div
            className={`bm-ff-timer ${demoTimer <= 5 ? "bm-ff-timer--warning" : ""}`}
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0, scale: 0.8 }}
            transition={slamSpring}
          >
            <div className="bm-ff-timer-ring">
              <svg className="bm-ff-timer-svg" viewBox="0 0 100 100">
                <circle className="bm-ff-timer-bg" cx="50" cy="50" r={42} />
                <circle
                  className="bm-ff-timer-fg"
                  cx="50" cy="50" r={42}
                  strokeDasharray={2 * Math.PI * 42}
                  strokeDashoffset={2 * Math.PI * 42 * (1 - demoTimer / 30)}
                />
              </svg>
              <span className="bm-ff-timer-value">
                {`${Math.floor(demoTimer / 60)}:${(demoTimer % 60).toString().padStart(2, "0")}`}
              </span>
            </div>
            <span className="bm-ff-timer-label">
              {stage === "reveal" ? "Question" : stage === "buzzer" ? "Buzz" : "Answer"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Center content — switches per stage */}
      <div className="bm-intro-center">
        <AnimatePresence mode="wait">
          {stage === "welcome" && (
            <motion.div
              key="intro-welcome"
              className="bm-intro-stage"
              initial={{ scale: 2.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0, y: -40, transition: { duration: 0.3, ease: "easeIn" } }}
              transition={slamSpring}
            >
              <div className="bm-intro-welcome-title">
                <span style={{ color: "var(--amber)" }}>Buzzer</span>
                <span style={{ color: "var(--sage)" }}>Minds</span>
              </div>
              <motion.div
                className="bm-intro-welcome-sub"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.5 }}
              >
                The Live Trivia Game Show
              </motion.div>
            </motion.div>
          )}

          {stage === "howtoplay" && (
            <motion.div
              key="intro-howtoplay"
              className="bm-intro-stage"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, y: -30, transition: { duration: 0.25, ease: "easeIn" } }}
              transition={bounceSpring}
            >
              <span className="bm-ff-badge bm-ff-badge--amber" style={{ fontSize: "1.6rem", padding: "10px 28px" }}>
                How To Play
              </span>
            </motion.div>
          )}

          {stage === "topics" && (
            <motion.div
              key="intro-topics"
              className="bm-intro-stage"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85, y: -30, transition: { duration: 0.25, ease: "easeIn" } }}
              transition={bounceSpring}
            >
              <div className="bm-ff-topic">
                <span className="bm-ff-badge bm-ff-badge--rose">Topic Voting</span>
              </div>
              <p className="bm-intro-explain">
                Everyone picks their favorite categories
              </p>
              <div className="bm-ff-topic-grid">
                {topicVotes.map((topic, i) => (
                  <motion.div
                    key={topic.label}
                    className={`bm-ff-topic-card ${topic.votes > 0 ? "bm-ff-topic-card--voted" : ""}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...bounceSpring, delay: i * STAGGER_MS }}
                  >
                    <div className="bm-ff-topic-name">{topic.label}</div>
                    <motion.div
                      className="bm-ff-topic-votes"
                      key={topic.votes}
                      initial={topic.votes > 0 ? { scale: 1.3 } : undefined}
                      animate={{ scale: 1 }}
                    >
                      {topic.votes} vote{topic.votes !== 1 ? "s" : ""}
                    </motion.div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {stage === "reveal" && (
            <motion.div
              key="intro-reveal"
              className="bm-intro-stage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={snapTween}
            >
              <div className="bm-ff-topic">
                <span className="bm-ff-badge bm-ff-badge--rose">Space & Science</span>
              </div>
              <p className="bm-ff-question">
                {DEMO_QUESTION_CHUNKS.map((chunk, i) => {
                  const isVisible = i < revealIndex;
                  const isLatest = i === revealIndex - 1;
                  return (
                    <motion.span
                      key={i}
                      className={
                        isVisible
                          ? isLatest
                            ? "bm-ff-chunk--latest"
                            : "bm-ff-chunk--visible"
                          : "bm-ff-chunk--hidden"
                      }
                      initial={isLatest ? { opacity: 0, x: 20 } : undefined}
                      animate={isLatest ? { opacity: 1, x: 0 } : undefined}
                      transition={isLatest ? bounceSpring : undefined}
                    >
                      {chunk}{" "}
                    </motion.span>
                  );
                })}
              </p>
              <motion.p
                className="bm-intro-hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1 }}
              >
                Questions are revealed piece by piece...
              </motion.p>
            </motion.div>
          )}

          {stage === "buzzer" && (
            <motion.div
              key="intro-buzzer"
              className="bm-intro-stage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={snapTween}
            >
              <div className="bm-ff-topic">
                <span className="bm-ff-badge bm-ff-badge--amber">
                  <Zap style={{ width: 12, height: 12 }} /> Buzz Now!
                </span>
              </div>
              <p className="bm-ff-question">
                {DEMO_QUESTION_CHUNKS.join(" ")}
              </p>
              <motion.div
                className="bm-intro-buzz-demo"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ ...bounceSpring, delay: 1.5 }}
              >
                <div className="bm-ff-answerer">
                  <div className="bm-ff-answerer-dot" style={{ background: "#4ade80" }} />
                  <span>Jordan buzzed in!</span>
                </div>
              </motion.div>
            </motion.div>
          )}

          {stage === "answering" && (
            <motion.div
              key="intro-answering"
              className="bm-intro-stage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={snapTween}
            >
              <div className="bm-ff-topic">
                <span className="bm-ff-badge bm-ff-badge--sage">Answering</span>
              </div>
              <p className="bm-ff-question bm-ff-question--smaller">
                {DEMO_QUESTION_CHUNKS.join(" ")}
              </p>
              <motion.div
                className="bm-ff-answerer"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={bounceSpring}
              >
                <div className="bm-ff-answerer-dot" style={{ background: "#4ade80" }} />
                <span>Jordan is answering...</span>
              </motion.div>
              <motion.div
                className="bm-intro-answer-box"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.5 }}
              >
                <span className="bm-intro-answer-label">Answer:</span>
                <motion.span
                  className="bm-intro-answer-text"
                  initial={{ width: 0 }}
                  animate={{ width: "auto" }}
                  transition={{ delay: 2, duration: 1.5 }}
                >
                  The Great Pyramid of Giza
                </motion.span>
              </motion.div>
            </motion.div>
          )}

          {stage === "grading" && (
            <motion.div
              key="intro-grading"
              className="bm-intro-stage"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.25, ease: "easeIn" } }}
              transition={bounceSpring}
            >
              <AnimatePresence mode="wait">
                {gradingResult === "pending" ? (
                  <motion.div
                    key="grading-pending"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={snapTween}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
                  >
                    <div className="bm-ff-spinner bm-ff-spinner--sage" />
                    <p className="bm-intro-grading-text">
                      AI Judge is grading...
                    </p>
                  </motion.div>
                ) : gradingResult === "correct" ? (
                  <motion.div
                    key="correct-result"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={slamSpring}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
                  >
                    <motion.div
                      className="bm-intro-result bm-intro-result--correct"
                      initial={{ rotateY: 90 }}
                      animate={{ rotateY: 0 }}
                      transition={bounceSpring}
                      style={{ perspective: 600 }}
                    >
                      <span className="bm-intro-result-icon">+10</span>
                      <span>Correct!</span>
                    </motion.div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="incorrect-result"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={slamSpring}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
                  >
                    <motion.div
                      className="bm-intro-result bm-intro-result--incorrect"
                      initial={{ rotateY: 90 }}
                      animate={{ rotateY: 0 }}
                      transition={bounceSpring}
                      style={{ perspective: 600 }}
                    >
                      <span className="bm-intro-result-icon">−5</span>
                      <span>Wrong — early buzz!</span>
                    </motion.div>
                    <p className="bm-intro-scoring-note">
                      Buzzed in before the full question? Wrong answers cost 5 points.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {stage === "bonus" && (
            <motion.div
              key="intro-bonus"
              className="bm-intro-stage"
              initial={{ opacity: 0, rotateY: 90 }}
              animate={{ opacity: 1, rotateY: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.25, ease: "easeIn" } }}
              transition={bounceSpring}
              style={{ perspective: 800 }}
            >
              <div className="bm-ff-topic">
                <span className="bm-ff-badge bm-ff-badge--sky">
                  Bonus {bonusIndex + 1} of 3
                </span>
              </div>
              <p className="bm-ff-question bm-ff-question--smaller">
                {DEMO_BONUS_PROMPTS[bonusIndex]}
              </p>
              <motion.div
                className="bm-ff-answerer bm-ff-answerer--bonus"
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ ...bounceSpring, delay: 0.1 }}
              >
                <div className="bm-ff-answerer-dot" style={{ background: "#4ade80" }} />
                <span>Jordan is answering...</span>
              </motion.div>
              <div className="bm-ff-bonus-progress">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className={`bm-ff-bonus-dot ${
                      i < bonusIndex
                        ? "bm-ff-bonus-dot--completed"
                        : i === bonusIndex
                          ? "bm-ff-bonus-dot--current"
                          : "bm-ff-bonus-dot--upcoming"
                    }`}
                  />
                ))}
              </div>
              <p className="bm-intro-bonus-note">
                +5 points each · Rapid-fire solo questions
              </p>
            </motion.div>
          )}

          {stage === "standings" && (
            <motion.div
              key="intro-standings"
              className="bm-intro-stage bm-ff-score-reveal"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.25, ease: "easeIn" } }}
              transition={bounceSpring}
            >
              <motion.div
                className="bm-ff-score-headline"
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={slamSpring}
              >
                Round Standings
              </motion.div>
              <div className="bm-ff-standings">
                {[
                  { name: "Jordan", color: "#4ade80", score: 25, rank: 1, delta: 15 },
                  { name: "Alex", color: "#f59e0b", score: 20, rank: 2, delta: 10 },
                  { name: "Sam", color: "#fb7185", score: 10, rank: 3, delta: 0 },
                  { name: "Riley", color: "#38bdf8", score: 5, rank: 4, delta: 5 },
                ].map((entry, i) => (
                  <motion.div
                    key={entry.name}
                    className={`bm-ff-standing-row ${entry.rank === 1 ? "bm-ff-standing-row--winner" : ""}`}
                    initial={{ opacity: 0, x: 30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ ...bounceSpring, delay: 0.25 + i * STAGGER_MS }}
                  >
                    <div className="bm-ff-standing-rank">
                      {entry.rank <= 3 ? (
                        <Trophy
                          style={{
                            width: 18, height: 18,
                            color: entry.rank === 1 ? "var(--amber)" : entry.rank === 2 ? "#9ca3af" : "#b45309",
                          }}
                        />
                      ) : (
                        <span style={{ color: "var(--text-dim)" }}>#{entry.rank}</span>
                      )}
                    </div>
                    <div className="bm-ff-standing-name">
                      <div className="bm-ff-swatch" style={{ background: entry.color }} />
                      {entry.name}
                    </div>
                    <span className="bm-ff-standing-score">{entry.score} pts</span>
                    {entry.delta !== 0 ? (
                      <span className="bm-ff-standing-delta bm-ff-standing-delta--plus">
                        +{entry.delta}
                      </span>
                    ) : null}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {stage === "letsgo" && (
            <motion.div
              key="intro-letsgo"
              className="bm-intro-stage"
              initial={{ scale: 2.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.25, ease: "easeIn" } }}
              transition={slamSpring}
            >
              <div className="bm-intro-letsgo">LET&apos;S GO!</div>
              <motion.div
                className="bm-intro-welcome-sub"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                May the fastest mind win
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom: fake player pills */}
      <div className="bm-intro-players">
        {DEMO_PLAYERS.map((p, i) => {
          const pillState = demoPillStates[p.name] || "idle";
          return (
            <motion.div
              key={p.name}
              className={`bm-ff-pill bm-ff-pill--${pillState}`}
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ ...bounceSpring, delay: 0.5 + i * STAGGER_MS }}
              layout
            >
              <div className="bm-ff-pill-swatch" style={{ background: p.color }} />
              <span className="bm-ff-pill-name">{p.name}</span>
              <span className="bm-ff-pill-score">
                {stage === "standings" || stage === "letsgo"
                  ? [20, 25, 10, 5][i]
                  : (stage === "grading" && gradingResult === "correct" && p.name === "Jordan")
                    ? 10
                    : (stage === "grading" && gradingResult === "incorrect" && p.name === "Jordan")
                      ? -5
                      : stage === "bonus"
                        ? 10
                        : p.score}
              </span>
              {i === 0 ? <span className="bm-ff-pill-vip">VIP</span> : null}
              {pillState === "buzzing" && <span className="bm-ff-pill-status">BUZZED</span>}
              {pillState === "answering" && <span className="bm-ff-pill-status">TYPING</span>}
              {pillState === "evaluating" && <span className="bm-ff-pill-status">GRADING</span>}
              {pillState === "correct" && <span className="bm-ff-pill-status">+10</span>}
              {pillState === "incorrect" && <span className="bm-ff-pill-status bm-ff-pill-status--penalty">−5</span>}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ── FFOpeningSplash: "IT'S SHOWTIME!" 3-phase transition ── */
function FFOpeningSplash({
  playerCount,
  onComplete,
  speedRef,
}: {
  playerCount: number;
  onComplete: () => void;
  speedRef: React.MutableRefObject<number>;
}) {
  useEffect(() => {
    // Speed up wireframe background during splash
    speedRef.current = 3;
    const timer = setTimeout(() => {
      speedRef.current = 1;
      onComplete();
    }, 2400); // 1.2s splash + 1.2s buffer
    return () => {
      clearTimeout(timer);
      speedRef.current = 1;
    };
  }, [onComplete, speedRef]);

  const ringColors = ["amber", "sage", "rose"] as const;

  return (
    <motion.div
      className="bm-ff-splash"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.15 }}
      transition={{ duration: 0.6, ease: "easeIn" }}
    >
      {/* Burst rings */}
      {ringColors.map((color, i) => (
        <motion.div
          key={color}
          className={`bm-ff-splash-ring bm-ff-splash-ring--${color}`}
          initial={{ width: 0, height: 0, opacity: 0.8 }}
          animate={{
            width: 600 + i * 200,
            height: 600 + i * 200,
            opacity: 0,
          }}
          transition={{
            duration: 1.2,
            delay: i * 0.15,
            ease: "easeOut",
          }}
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}

      {/* Main title */}
      <motion.div
        className="bm-ff-splash-title"
        initial={{ scale: 2.5, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={slamSpring}
      >
        IT&apos;S SHOWTIME!
      </motion.div>

      {/* Player count */}
      <motion.div
        className="bm-ff-splash-sub"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.4 }}
      >
        {playerCount} player{playerCount !== 1 ? "s" : ""} ready
      </motion.div>
    </motion.div>
  );
}

/* ── Active Timer Resolver: determines which timer to show ── */
function FFActiveTimer() {
  const { room } = useRoomLive();

  const timerConfig = useMemo(() => {
    if (room.phase === "buzz_open" && room.buzz_state?.deadline_at) {
      return {
        deadline: room.buzz_state.deadline_at,
        totalSeconds: room.settings.no_buzz_window_seconds,
        label: "Buzz",
      };
    }
    if (room.phase === "answering" && room.current_question?.answering_deadline_at) {
      return {
        deadline: room.current_question.answering_deadline_at,
        totalSeconds: room.settings.main_answer_seconds,
        label: "Answer",
      };
    }
    if (room.phase === "bonus_answering" && room.bonus_chain?.answer_deadline_at) {
      return {
        deadline: room.bonus_chain.answer_deadline_at,
        totalSeconds: room.settings.bonus_answer_seconds,
        label: "Bonus",
      };
    }
    return null;
  }, [room.phase, room.buzz_state, room.current_question, room.bonus_chain, room.settings]);

  return (
    <AnimatePresence>
      {timerConfig ? (
        <FFTimer
          key={timerConfig.label + timerConfig.deadline}
          deadline={timerConfig.deadline}
          totalSeconds={timerConfig.totalSeconds}
          label={timerConfig.label}
        />
      ) : null}
    </AnimatePresence>
  );
}

/* ═══════════════════════════════════════════════════════
   FULL FOCUS — Scene Orchestration
   ═══════════════════════════════════════════════════════ */

/* ── DisplayGameScene: Full Focus layout (replaces old sidebar layout) ── */
function DisplayGameScene() {
  return (
    <div className="bm-ff-layout">
      <FFLogo />
      <FFActiveTimer />
      <FFCenter />
      <FFPlayers />
      <FFOverlay />
    </div>
  );
}

/* ── DisplayRoomScene: 4-scene AnimatePresence (lobby/splash/intro/game) ── */
type DisplayScene = "lobby" | "splash" | "intro" | "game";

function DisplayRoomScene() {
  const { room } = useRoomLive();
  const wireframeSpeedRef = useRef(1);
  const [scene, setScene] = useState<DisplayScene>(() => {
    if (room.phase === "lobby") return "lobby";
    if (room.phase === "intro") return "intro";
    return "game";
  });
  const prevPhaseRef = useRef<RoomPhase>(room.phase);
  const playerCountAtStart = useRef(room.players.length);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    const next = room.phase;
    prevPhaseRef.current = next;

    // Transition from lobby to intro (or any non-lobby phase) -> trigger splash
    if (prev === "lobby" && next !== "lobby") {
      playerCountAtStart.current = room.players.length;
      setScene("splash");
    }
    // If we somehow go back to lobby
    else if (next === "lobby") {
      setScene("lobby");
    }
    // If backend skips intro (VIP skip) while we're still showing intro -> jump to game
    else if (scene === "intro" && next !== "intro") {
      setScene("game");
    }
    // If we reconnect mid-intro and scene is wrong, sync up
    else if (next === "intro" && scene !== "intro" && scene !== "splash") {
      setScene("intro");
    }
    // If we're already in game and phase changes, stay in game
    else if (scene === "game") {
      // do nothing, FFCenter handles it
    }
  }, [room.phase, room.players.length, scene]);

  const handleSplashComplete = useCallback(() => {
    setScene("intro");
  }, []);

  const handleIntroComplete = useCallback(() => {
    // Don't set scene to "game" here — let the backend phase transition
    // drive it via the useEffect above (scene === "intro" && next !== "intro").
    // This avoids a blank screen gap between audio ending and backend deadline.
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <WireframeBackground speedRef={wireframeSpeedRef} />

      <AnimatePresence mode="wait">
        {scene === "lobby" ? (
          <motion.div
            key="scene-lobby"
            exit={{
              opacity: 0,
              transition: { duration: 0.8, ease: "easeIn" },
            }}
          >
            <DisplayLobby />
          </motion.div>
        ) : scene === "splash" ? (
          <FFOpeningSplash
            key="scene-splash"
            playerCount={playerCountAtStart.current}
            onComplete={handleSplashComplete}
            speedRef={wireframeSpeedRef}
          />
        ) : scene === "intro" ? (
          <motion.div
            key="scene-intro"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.25 } }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <FFIntro onComplete={handleIntroComplete} speedRef={wireframeSpeedRef} />
          </motion.div>
        ) : (
          <motion.div
            key="scene-game"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <DisplayGameScene />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

/* ── AudioGate: ensures browser can play audio before mounting audio providers ── */
function AudioGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    // Test if audio is already allowed (user previously interacted)
    const ctx = new AudioContext();
    if (ctx.state === "running") {
      setUnlocked(true);
      ctx.close();
      return;
    }
    // If suspended, close it — we'll create a new one on click
    ctx.close();
  }, []);

  const handleUnlock = useCallback(() => {
    const ctx = new AudioContext();
    ctx.resume().then(() => {
      // Play a silent buffer to fully unlock HTMLAudioElement playback
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      setUnlocked(true);
      // Keep the context alive briefly, then clean up
      setTimeout(() => ctx.close(), 500);
    });
  }, []);

  if (unlocked) return <>{children}</>;

  return (
    <>
      <div className="bm-audio-gate" onClick={handleUnlock}>
        <motion.div
          className="bm-audio-gate-card"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Volume2 size={36} style={{ color: "var(--amber)" }} />
          <div className="bm-audio-gate-title">Click anywhere to enable audio</div>
          <div className="bm-audio-gate-sub">Sound effects, music &amp; narration</div>
        </motion.div>
      </div>
    </>
  );
}

/* ── Root export ── */

export function DisplayRoomView({ initialRoom, displayToken }: DisplayRoomViewProps) {
  useEffect(() => {
    if (displayToken) {
      saveDisplaySession(initialRoom.code, displayToken);
    }
  }, [initialRoom.code, displayToken]);

  return (
    <RoomLiveProvider initialRoom={initialRoom} query={{ client_type: "display" }} roomCode={initialRoom.code}>
      <AudioGate>
        <NarrationAudio />
        <ShowAudio />
      </AudioGate>
      <DisplayRoomScene />
    </RoomLiveProvider>
  );
}
