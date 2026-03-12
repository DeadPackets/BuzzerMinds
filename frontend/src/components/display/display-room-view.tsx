"use client";

import Link from "next/link";
import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { motion } from "framer-motion";
import {
  Trophy, Clock, Users, Loader2, Hash, ScanLine, Radio,
  Repeat, Timer, Eye, MessageSquare, Shield,
} from "lucide-react";

import { NarrationAudio } from "@/components/providers/narration-audio";
import { RoomLiveProvider, useRoomLive } from "@/components/providers/room-live-provider";
import { ShowAudio } from "@/components/providers/show-audio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WireframeBackground } from "@/components/ui/wireframe-background";
import { saveDisplaySession } from "@/lib/storage";
import { RoomStateResponse, RoomSettingsState } from "@/lib/types";
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

/* ── Phase Card (for non-lobby phases) ── */

function PhaseCard({ badge, title, body, accent, children }: {
  badge: string;
  title: string;
  body?: string;
  accent?: "amber" | "sage" | "rose" | "sky";
  children?: React.ReactNode;
}) {
  const borderColors: Record<string, string> = {
    amber: "rgba(245, 158, 11, 0.25)",
    sage: "rgba(74, 222, 128, 0.25)",
    rose: "rgba(251, 113, 133, 0.25)",
    sky: "rgba(56, 189, 248, 0.25)",
  };

  return (
    <div
      className="rounded-[14px] p-6"
      style={{
        background: "var(--surface)",
        backdropFilter: "blur(16px)",
        border: `1px solid ${accent ? borderColors[accent] : "rgba(255,255,255,0.06)"}`,
      }}
    >
      <Badge variant="secondary">{badge}</Badge>
      <h2 className="bm-title mt-3 text-2xl text-[var(--text-bright)] sm:text-3xl">{title}</h2>
      {body ? <p className="bm-body mt-2 text-base">{body}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
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
                    animation: `bm-char-wave 3s ease-in-out ${i * 0.15}s infinite`,
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

/* ── Main Game Card (non-lobby phases) ── */

function DisplayMainCard() {
  const { room } = useRoomLive();
  const topicVoting = room.topic_voting;
  const question = room.current_question;
  const scoreReveal = room.score_reveal;
  const finished = room.finished;

  if (room.phase === "topic_voting" && topicVoting) {
    return (
      <PhaseCard
        badge={topicVoting.status === "locked" ? "Topics Locked" : "Topic Voting"}
        title={topicVoting.status === "locked" ? "Topic pool is set" : "Players are choosing topics"}
        body={`Approve up to ${topicVoting.max_approvals_per_player} topics each.`}
        accent="rose"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {(topicVoting.status === "locked" ? topicVoting.selected_topics : topicVoting.options).map((topic) => (
            <div
              key={topic.id}
              className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
              style={{
                background: "rgba(30, 30, 30, 0.5)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div className="min-w-0">
                <p className="font-semibold text-[var(--text-bright)]">{topic.label}</p>
                <p className="mt-0.5 text-xs text-[var(--text-dim)]">{topic.approval_count} votes</p>
              </div>
              <Badge variant={topic.source === "player" ? "secondary" : "outline"}>
                {topic.source === "player" ? "Player" : "Standard"}
              </Badge>
            </div>
          ))}
        </div>
      </PhaseCard>
    );
  }

  if (room.phase === "question_loading") {
    return (
      <PhaseCard badge="Loading" title="Preparing the next challenge" accent="amber">
        <div className="flex items-center gap-3 text-[var(--amber)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-medium">Topic: {room.progress?.current_topic_label ?? "Unknown"}</span>
        </div>
      </PhaseCard>
    );
  }

  if ((room.phase === "question_reveal_progressive" || room.phase === "question_reveal_full") && question) {
    const visibleChunks = room.phase === "question_reveal_full"
      ? question.question.prompt_chunks
      : question.question.prompt_chunks.slice(0, question.question.reveal_index);
    return (
      <PhaseCard badge={formatPhase(room.phase)} title={question.question.topic_label} accent="rose">
        <p className="text-xl font-medium leading-relaxed text-[var(--text-bright)]">
          {visibleChunks.join(" ")}
        </p>
      </PhaseCard>
    );
  }

  if (room.phase === "buzz_open" && question) {
    return (
      <PhaseCard badge="Buzz Open" title="Buzz now!" accent="amber">
        <p className="text-lg text-[var(--text-bright)]">{question.question.prompt}</p>
        <div className="mt-4 flex items-center gap-2 bm-countdown text-lg">
          <Clock className="h-5 w-5" />
          {formatCountdown(room.buzz_state?.deadline_at ?? null)}
        </div>
      </PhaseCard>
    );
  }

  if (room.phase === "answering" && question) {
    const answerer = room.players.find((p) => p.id === question.answering_player_id);
    return (
      <PhaseCard badge="Answering" title={`${answerer?.name ?? "A player"} has the floor`} accent="sage">
        <p className="text-lg text-[var(--text-bright)]">{question.question.prompt}</p>
        <div className="mt-4 flex items-center gap-2 bm-countdown text-lg">
          <Clock className="h-5 w-5" />
          {formatCountdown(question.answering_deadline_at)}
        </div>
      </PhaseCard>
    );
  }

  if (room.phase === "grading" && question) {
    return (
      <PhaseCard badge="Grading" title="Checking the answer" accent="amber">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--amber)]" />
          <p className="text-[var(--text-bright)]">Submitted: <span className="font-semibold">{question.submitted_answer ?? "-"}</span></p>
        </div>
      </PhaseCard>
    );
  }

  if ((room.phase === "bonus_loading" || room.phase === "bonus_answering") && room.bonus_chain) {
    const currentBonus = room.bonus_chain.questions[room.bonus_chain.current_index] ?? null;
    const bonusPlayer = room.players.find((p) => p.id === room.bonus_chain?.awarded_player_id);
    return (
      <PhaseCard badge="Bonus Chain" title={`${bonusPlayer?.name ?? "Player"} earned a bonus run`} accent="sage">
        <p className="text-lg text-[var(--text-bright)]">{currentBonus?.prompt ?? "Loading bonus..."}</p>
        <div className="mt-4 flex items-center justify-between text-sm text-[var(--text-dim)]">
          <span>Bonus {Math.min(room.bonus_chain.current_index + 1, room.bonus_chain.total_questions)} of {room.bonus_chain.total_questions}</span>
          {room.phase === "bonus_answering" ? (
            <span className="bm-countdown">{formatCountdown(room.bonus_chain.answer_deadline_at)}</span>
          ) : null}
        </div>
      </PhaseCard>
    );
  }

  if (room.phase === "score_reveal" && scoreReveal) {
    const resolved = scoreReveal.resolved_question;
    return (
      <PhaseCard badge="Score Reveal" title={scoreReveal.headline} accent="rose">
        {resolved ? (
          <div className="mb-4 rounded-xl px-4 py-3" style={{ background: "rgba(74, 222, 128, 0.08)", border: "1px solid rgba(74, 222, 128, 0.2)" }}>
            <p className="font-semibold text-[var(--sage)]">Correct answer: {resolved.correct_answer}</p>
            <p className="mt-1 text-sm text-[var(--text-dim)]">{resolved.fact_card.detail}</p>
          </div>
        ) : null}
        <div className="grid gap-2">
          {scoreReveal.standings.map((entry) => {
            const player = room.players.find((p) => p.id === entry.player_id);
            return (
              <div
                key={entry.player_id}
                className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                style={{ background: "rgba(30, 30, 30, 0.5)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex items-center gap-3">
                  {entry.rank <= 3 ? (
                    <Trophy className={`h-5 w-5 ${entry.rank === 1 ? "text-[var(--amber)]" : entry.rank === 2 ? "text-gray-400" : "text-amber-700"}`} />
                  ) : (
                    <span className="w-5 text-center text-sm font-bold text-[var(--text-dim)]">#{entry.rank}</span>
                  )}
                  <span className="font-semibold text-[var(--text-bright)]">{player?.name ?? entry.player_id}</span>
                </div>
                <span className="bm-score text-lg text-[var(--amber)]">{entry.score} pts</span>
              </div>
            );
          })}
        </div>
      </PhaseCard>
    );
  }

  if (room.phase === "paused_waiting_for_vip" && room.pause_state) {
    return (
      <PhaseCard badge="Paused" title="Waiting for VIP to return" body={room.pause_state.reason} accent="amber">
        <div className="flex items-center gap-2 bm-countdown text-lg">
          <Clock className="h-5 w-5" />
          Timeout: {formatCountdown(room.pause_state.deadline_at)}
        </div>
      </PhaseCard>
    );
  }

  if (room.phase === "finished" && finished) {
    return (
      <PhaseCard badge="Game Over" title="Match complete!" accent="sage">
        <p className="mb-4 text-[var(--text-dim)]">Reason: {finished.reason.replace(/_/g, " ")}</p>
        <div className="grid gap-2">
          {finished.standings.map((entry) => {
            const player = room.players.find((p) => p.id === entry.player_id);
            return (
              <div
                key={entry.player_id}
                className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                style={{ background: "rgba(30, 30, 30, 0.5)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex items-center gap-3">
                  {entry.rank <= 3 ? (
                    <Trophy className={`h-5 w-5 ${entry.rank === 1 ? "text-[var(--amber)]" : entry.rank === 2 ? "text-gray-400" : "text-amber-700"}`} />
                  ) : (
                    <span className="w-5 text-center text-sm font-bold text-[var(--text-dim)]">#{entry.rank}</span>
                  )}
                  <span className="font-semibold text-[var(--text-bright)]">{player?.name ?? entry.player_id}</span>
                </div>
                <span className={`bm-score text-lg ${finished.winners.includes(entry.player_id) ? "text-[var(--sage)]" : "text-[var(--amber)]"}`}>{entry.score} pts</span>
              </div>
            );
          })}
        </div>
        {finished.summary_id ? (
          <Button asChild className="mt-4 w-full rounded-xl" variant="outline">
            <Link href={`/summary/${finished.summary_id}`}>View Full Summary</Link>
          </Button>
        ) : null}
      </PhaseCard>
    );
  }

  return null;
}

/* ── Display Room Scene (non-lobby game phases) ── */

function DisplayGameScene() {
  const { room, connected } = useRoomLive();
  const vip = room.players.find((p) => p.id === room.vip_player_id) ?? null;

  return (
    <div className="relative z-10 mx-auto max-w-7xl p-6">
      {/* ── Top Bar ── */}
      <div className="flex items-center justify-between gap-4 pb-6">
        <div className="flex items-center gap-3">
          <span className="bm-title text-lg text-[var(--text-bright)]">
            <span style={{ color: "var(--amber)" }}>Buzzer</span>
            <span style={{ color: "var(--sage)" }}>Minds</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={connected ? "secondary" : "outline"}>
            {connected ? "Live" : "Reconnecting"}
          </Badge>
          <Badge variant="outline">{formatPhase(room.phase)}</Badge>
          <span className="bm-display-code text-xl text-[var(--amber)]">{room.code}</span>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="grid gap-5">
          {/* Stats row */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl p-4" style={{ background: "var(--surface)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2 text-[var(--text-dim)]">
                <Users className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-widest">Players</span>
              </div>
              <p className="bm-score mt-2 text-3xl text-[var(--text-bright)]">{room.active_player_count}</p>
              <p className="mt-1 text-xs text-[var(--text-dim)]">{room.spectator_count} spectators</p>
            </div>
            <div className="rounded-xl p-4" style={{ background: "var(--surface)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2 text-[var(--text-dim)]">
                <Users className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-widest">VIP</span>
              </div>
              <p className="bm-score mt-2 text-2xl text-[var(--text-bright)]">{vip?.name ?? "Waiting..."}</p>
              <p className="mt-1 text-xs text-[var(--text-dim)]">First player controls the game</p>
            </div>
            <div className="rounded-xl p-4" style={{ background: "var(--surface)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2 text-[var(--text-dim)]">
                <Clock className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-widest">Mode</span>
              </div>
              <p className="bm-score mt-2 text-2xl text-[var(--text-bright)]">
                {room.settings.end_mode === "rounds" ? `${room.settings.rounds_count} rounds` : `${room.settings.timer_minutes} min`}
              </p>
              <p className="mt-1 text-xs text-[var(--text-dim)]">
                {room.progress?.current_topic_label ?? "Pregame"}
              </p>
            </div>
          </div>

          {/* Main phase card */}
          <DisplayMainCard />
        </div>

        {/* Right sidebar */}
        <div className="grid gap-5">
          {/* Player roster */}
          <div className="rounded-[14px]" style={{ background: "var(--surface)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="p-5 pb-0">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-dim)]">Players</h2>
                <Badge variant="outline">{room.players.length} joined</Badge>
              </div>
            </div>
            <div className="grid gap-2 p-5">
              {room.players.map((player) => (
                <div
                  key={player.id}
                  className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                  style={{
                    background: player.is_answering || player.bonus_active || room.buzz_state?.winner_player_id === player.id
                      ? "rgba(245, 158, 11, 0.08)"
                      : "rgba(30, 30, 30, 0.5)",
                    border: player.is_answering || player.bonus_active || room.buzz_state?.winner_player_id === player.id
                      ? "1px solid rgba(245, 158, 11, 0.25)"
                      : "1px solid rgba(255,255,255,0.06)",
                    opacity: player.connected ? 1 : 0.5,
                  }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="bm-swatch" style={{ backgroundColor: player.color }} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--text-bright)]">{player.name}</p>
                      <p className="truncate text-sm text-[var(--text-dim)]">
                        {player.score} pts
                        {!player.connected ? " · offline" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {player.id === room.vip_player_id ? (
                      <span
                        className="rounded px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.1em]"
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
                </div>
              ))}
              {room.players.length === 0 ? (
                <p className="py-4 text-center text-sm text-[var(--text-dim)]">No players yet. Share the room code!</p>
              ) : null}
            </div>
          </div>

          {/* Narration */}
          {room.narration?.text ? (
            <div className="rounded-[14px] p-5" style={{ background: "var(--surface)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-dim)]">Narration</p>
              <p className="mt-2 text-sm italic text-[var(--text-bright)]">{room.narration.text}</p>
            </div>
          ) : null}

          {/* Quick links */}
          <div className="flex gap-3">
            <Button asChild className="flex-1 rounded-xl" size="sm">
              <Link href={`/player/${room.code}`}>Join as Player</Link>
            </Button>
            <Button asChild className="flex-1 rounded-xl" size="sm" variant="outline">
              <Link href="/">New Room</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Display Room Scene (router between lobby and game phases) ── */

function DisplayRoomScene() {
  const { room } = useRoomLive();

  return (
    <main className="relative min-h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <WireframeBackground />

      {room.phase === "lobby" ? (
        <DisplayLobby />
      ) : (
        <DisplayGameScene />
      )}
    </main>
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
      <NarrationAudio />
      <ShowAudio />
      <DisplayRoomScene />
    </RoomLiveProvider>
  );
}
