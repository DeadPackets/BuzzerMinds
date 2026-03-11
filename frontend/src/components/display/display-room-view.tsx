"use client";

import Link from "next/link";
import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Trophy, Clock, Users, Zap, Loader2 } from "lucide-react";

import { NarrationAudio } from "@/components/providers/narration-audio";
import { RoomLiveProvider, useRoomLive } from "@/components/providers/room-live-provider";
import { ShowAudio } from "@/components/providers/show-audio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayerRow } from "@/components/ui/player-row";
import { GameShell } from "@/components/ui/studio-shell";
import { saveDisplaySession } from "@/lib/storage";
import { RoomStateResponse } from "@/lib/types";
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

/* ── Phase Card ── */

function PhaseCard({ badge, title, body, accent, children }: {
  badge: string;
  title: string;
  body?: string;
  accent?: "purple" | "cyan" | "pink" | "lime" | "amber";
  children?: React.ReactNode;
}) {
  const accentBorder: Record<string, string> = {
    purple: "border-[var(--bm-neon-purple)]/30",
    cyan: "border-[var(--bm-neon-cyan)]/30",
    pink: "border-[var(--bm-neon-pink)]/30",
    lime: "border-[var(--bm-neon-lime)]/30",
    amber: "border-[var(--bm-neon-amber)]/30",
  };

  return (
    <div className={`bm-card bm-card-accent rounded-2xl ${accent ? accentBorder[accent] : ""}`}>
      <div className="p-6">
        <Badge variant="secondary">{badge}</Badge>
        <h2 className="bm-title mt-3 text-2xl text-[var(--bm-text-bright)] sm:text-3xl">{title}</h2>
        {body ? <p className="bm-body mt-2 text-base">{body}</p> : null}
      </div>
      {children ? <div className="px-6 pb-6">{children}</div> : null}
    </div>
  );
}

/* ── Main Game Card (display-specific, shows phase content) ── */

function DisplayMainCard() {
  const { room } = useRoomLive();
  const topicVoting = room.topic_voting;
  const question = room.current_question;
  const scoreReveal = room.score_reveal;
  const finished = room.finished;

  if (room.phase === "lobby") {
    return (
      <PhaseCard badge="Lobby" title="Waiting for players" body="Scan the QR code or enter the room code on your phone to join." accent="cyan">
        <div className="flex items-center justify-center gap-6 rounded-xl border border-[var(--bm-border-glow)] bg-[var(--bm-bg-elevated)] p-6">
          <div className="rounded-xl bg-white p-3">
            <QRCodeSVG value={getJoinUrl(room.code)} size={160} level="M" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-widest text-[var(--bm-text-dim)]">Room Code</p>
            <p className="bm-room-code mt-1">{room.code}</p>
            <p className="mt-2 text-sm text-[var(--bm-text-dim)]">
              Join at <span className="font-semibold text-[var(--bm-neon-cyan)]">{typeof window !== "undefined" ? window.location.host : "quiz.deadpackets.pw"}</span>
            </p>
          </div>
        </div>
      </PhaseCard>
    );
  }

  if (room.phase === "topic_voting" && topicVoting) {
    return (
      <PhaseCard
        badge={topicVoting.status === "locked" ? "Topics Locked" : "Topic Voting"}
        title={topicVoting.status === "locked" ? "Topic pool is set" : "Players are choosing topics"}
        body={`Approve up to ${topicVoting.max_approvals_per_player} topics each.`}
        accent="purple"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {(topicVoting.status === "locked" ? topicVoting.selected_topics : topicVoting.options).map((topic) => (
            <div key={topic.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--bm-border-glow)] bg-[var(--bm-bg-elevated)] px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-[var(--bm-text-bright)]">{topic.label}</p>
                <p className="mt-0.5 text-xs text-[var(--bm-text-dim)]">{topic.approval_count} votes</p>
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
        <div className="flex items-center gap-3 text-[var(--bm-neon-amber)]">
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
      <PhaseCard badge={formatPhase(room.phase)} title={question.question.topic_label} accent="purple">
        <p className="text-xl font-medium leading-relaxed text-[var(--bm-text-bright)]">
          {visibleChunks.join(" ")}
        </p>
      </PhaseCard>
    );
  }

  if (room.phase === "buzz_open" && question) {
    return (
      <PhaseCard badge="Buzz Open" title="Buzz now!" accent="pink">
        <p className="text-lg text-[var(--bm-text-bright)]">{question.question.prompt}</p>
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
      <PhaseCard badge="Answering" title={`${answerer?.name ?? "A player"} has the floor`} accent="cyan">
        <p className="text-lg text-[var(--bm-text-bright)]">{question.question.prompt}</p>
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
          <Loader2 className="h-5 w-5 animate-spin text-[var(--bm-neon-amber)]" />
          <p className="text-[var(--bm-text-bright)]">Submitted: <span className="font-semibold">{question.submitted_answer ?? "-"}</span></p>
        </div>
      </PhaseCard>
    );
  }

  if ((room.phase === "bonus_loading" || room.phase === "bonus_answering") && room.bonus_chain) {
    const currentBonus = room.bonus_chain.questions[room.bonus_chain.current_index] ?? null;
    const bonusPlayer = room.players.find((p) => p.id === room.bonus_chain?.awarded_player_id);
    return (
      <PhaseCard badge="Bonus Chain" title={`${bonusPlayer?.name ?? "Player"} earned a bonus run`} accent="lime">
        <p className="text-lg text-[var(--bm-text-bright)]">{currentBonus?.prompt ?? "Loading bonus..."}</p>
        <div className="mt-4 flex items-center justify-between text-sm text-[var(--bm-text-dim)]">
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
      <PhaseCard badge="Score Reveal" title={scoreReveal.headline} accent="purple">
        {resolved ? (
          <div className="mb-4 rounded-xl border border-[var(--bm-neon-lime)]/20 bg-[var(--bm-neon-lime)]/5 px-4 py-3">
            <p className="font-semibold text-[var(--bm-neon-lime)]">Correct answer: {resolved.correct_answer}</p>
            <p className="mt-1 text-sm text-[var(--bm-text-dim)]">{resolved.fact_card.detail}</p>
          </div>
        ) : null}
        <div className="grid gap-2">
          {scoreReveal.standings.map((entry) => {
            const player = room.players.find((p) => p.id === entry.player_id);
            return (
              <div key={entry.player_id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--bm-border-glow)] bg-[var(--bm-bg-elevated)] px-4 py-3">
                <div className="flex items-center gap-3">
                  {entry.rank <= 3 ? (
                    <Trophy className={`h-5 w-5 ${entry.rank === 1 ? "text-[var(--bm-neon-amber)]" : entry.rank === 2 ? "text-gray-400" : "text-amber-700"}`} />
                  ) : (
                    <span className="w-5 text-center text-sm font-bold text-[var(--bm-text-dim)]">#{entry.rank}</span>
                  )}
                  <span className="font-semibold text-[var(--bm-text-bright)]">{player?.name ?? entry.player_id}</span>
                </div>
                <span className="bm-score text-lg text-[var(--bm-neon-cyan)]">{entry.score} pts</span>
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
      <PhaseCard badge="Game Over" title="Match complete!" accent="lime">
        <p className="mb-4 text-[var(--bm-text-dim)]">Reason: {finished.reason.replace(/_/g, " ")}</p>
        <div className="grid gap-2">
          {finished.standings.map((entry) => {
            const player = room.players.find((p) => p.id === entry.player_id);
            return (
              <div key={entry.player_id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--bm-border-glow)] bg-[var(--bm-bg-elevated)] px-4 py-3">
                <div className="flex items-center gap-3">
                  {entry.rank <= 3 ? (
                    <Trophy className={`h-5 w-5 ${entry.rank === 1 ? "text-[var(--bm-neon-amber)]" : entry.rank === 2 ? "text-gray-400" : "text-amber-700"}`} />
                  ) : (
                    <span className="w-5 text-center text-sm font-bold text-[var(--bm-text-dim)]">#{entry.rank}</span>
                  )}
                  <span className="font-semibold text-[var(--bm-text-bright)]">{player?.name ?? entry.player_id}</span>
                </div>
                <span className={`bm-score text-lg ${finished.winners.includes(entry.player_id) ? "text-[var(--bm-neon-lime)]" : "text-[var(--bm-neon-cyan)]"}`}>{entry.score} pts</span>
              </div>
            );
          })}
        </div>
        {finished.summary_id ? (
          <Button asChild className="mt-4 w-full rounded-full" variant="outline">
            <Link href={`/summary/${finished.summary_id}`}>View Full Summary</Link>
          </Button>
        ) : null}
      </PhaseCard>
    );
  }

  return null;
}

/* ── Display Room Scene ── */

function DisplayRoomScene() {
  const { room, connected } = useRoomLive();
  const vip = room.players.find((p) => p.id === room.vip_player_id) ?? null;

  return (
    <GameShell>
      {/* ── Top Bar ── */}
      <div className="flex items-center justify-between gap-4 pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--bm-neon-purple)] to-[var(--bm-neon-pink)]">
            <Zap className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="bm-title text-lg text-[var(--bm-text-bright)]">BuzzerMinds</span>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={connected ? "secondary" : "outline"}>
            {connected ? "Live" : "Reconnecting"}
          </Badge>
          <Badge variant="outline">{formatPhase(room.phase)}</Badge>
          <span className="bm-display-code text-xl text-[var(--bm-neon-cyan)]">{room.code}</span>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="grid gap-5">
          {/* Stats row */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="bm-card rounded-xl p-4">
              <div className="flex items-center gap-2 text-[var(--bm-text-dim)]">
                <Users className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-widest">Players</span>
              </div>
              <p className="bm-score mt-2 text-3xl text-[var(--bm-text-bright)]">{room.active_player_count}</p>
              <p className="mt-1 text-xs text-[var(--bm-text-dim)]">{room.spectator_count} spectators</p>
            </div>
            <div className="bm-card rounded-xl p-4">
              <div className="flex items-center gap-2 text-[var(--bm-text-dim)]">
                <Zap className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-widest">VIP</span>
              </div>
              <p className="bm-score mt-2 text-2xl text-[var(--bm-text-bright)]">{vip?.name ?? "Waiting..."}</p>
              <p className="mt-1 text-xs text-[var(--bm-text-dim)]">First player controls the game</p>
            </div>
            <div className="bm-card rounded-xl p-4">
              <div className="flex items-center gap-2 text-[var(--bm-text-dim)]">
                <Clock className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-widest">Mode</span>
              </div>
              <p className="bm-score mt-2 text-2xl text-[var(--bm-text-bright)]">
                {room.settings.end_mode === "rounds" ? `${room.settings.rounds_count} rounds` : `${room.settings.timer_minutes} min`}
              </p>
              <p className="mt-1 text-xs text-[var(--bm-text-dim)]">
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
          <div className="bm-card rounded-2xl">
            <div className="p-5 pb-0">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--bm-text-dim)]">Players</h2>
                <Badge variant="outline">{room.players.length} joined</Badge>
              </div>
            </div>
            <div className="grid gap-2 p-5">
              {room.players.map((player) => (
                <PlayerRow
                  key={player.id}
                  active={player.is_answering || player.bonus_active || room.buzz_state?.winner_player_id === player.id}
                  color={player.color}
                  connected={player.connected}
                  name={player.name}
                  ready={player.ready}
                  role={player.role}
                  score={player.score}
                  trailing={player.id === room.vip_player_id ? <Badge>VIP</Badge> : null}
                />
              ))}
              {room.players.length === 0 ? (
                <p className="py-4 text-center text-sm text-[var(--bm-text-dim)]">No players yet. Share the room code!</p>
              ) : null}
            </div>
          </div>

          {/* Narration */}
          {room.narration?.text ? (
            <div className="bm-card rounded-2xl p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--bm-text-dim)]">Narration</p>
              <p className="mt-2 text-sm italic text-[var(--bm-text-bright)]">{room.narration.text}</p>
            </div>
          ) : null}

          {/* Quick links */}
          <div className="flex gap-3">
            <Button asChild className="flex-1 rounded-full" size="sm">
              <Link href={`/player/${room.code}`}>Join as Player</Link>
            </Button>
            <Button asChild className="flex-1 rounded-full" size="sm" variant="outline">
              <Link href="/">New Room</Link>
            </Button>
          </div>
        </div>
      </div>
    </GameShell>
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
