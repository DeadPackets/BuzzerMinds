"use client";

import Link from "next/link";
import { ReactNode, FormEvent, useMemo, useState } from "react";
import {
  Brain,
  CheckCircle,
  Clock,
  Hash,
  Loader2,
  Palette,
  PartyPopper,
  Sparkles,
  Trophy,
  User,
  XCircle,
} from "lucide-react";

import { NarrationAudio } from "@/components/providers/narration-audio";
import { ShowAudio } from "@/components/providers/show-audio";
import { useTurnstile, TurnstileProvider } from "@/components/providers/turnstile-provider";
import { TurnstilePlaceholder } from "@/components/turnstile-placeholder";
import { RoomLiveProvider, useRoomLive } from "@/components/providers/room-live-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { PlayerRow } from "@/components/ui/player-row";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingSlider } from "@/components/ui/setting-slider";
import { GameShell } from "@/components/ui/studio-shell";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { WireframeBackground } from "@/components/ui/wireframe-background";
import { api } from "@/lib/api";
import { clearRoomSession, currentClientId, getOrCreateClientId, loadRoomSession, saveRoomSession } from "@/lib/storage";
import { JoinRoomResponse, PlayerSessionResponse, PublicConfigResponse, RoomStateResponse, SettingsPatch } from "@/lib/types";
import { formatCountdown, formatPhase, formatRole } from "@/lib/utils";

interface PlayerRoomViewProps {
  roomCode: string;
  initialRoom: RoomStateResponse;
  config: PublicConfigResponse;
}

/* ── Color swatch presets ── */

const COLOR_PRESETS = [
  "#22d3ee", // cyan
  "#f59e0b", // amber
  "#4ade80", // sage
  "#fb7185", // rose
  "#a78bfa", // violet
  "#f472b6", // pink
  "#fbbf24", // yellow
  "#34d399", // emerald
];

/* ── Phase Card (reusable) ── */

function PhaseCard({ badge, title, body, children }: { badge: string; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="bm-card rounded-[var(--radius)]">
      <div className="p-5">
        <Badge variant="secondary">{badge}</Badge>
        <h2 className="bm-title mt-2 text-xl text-[var(--text-bright)]">{title}</h2>
        <p className="bm-body mt-1 text-sm">{body}</p>
      </div>
      {children ? <div className="px-5 pb-5">{children}</div> : null}
    </div>
  );
}

/* ── Join Form (Party Invite design) ── */

function JoinForm({ roomCode, config, onJoined }: { roomCode: string; config: PublicConfigResponse; onJoined: (result: JoinRoomResponse) => void }) {
  const { requestToken } = useTurnstile();
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [expertise, setExpertise] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const turnstileToken = await requestToken(`join-${roomCode}`);
      const result = await api.joinRoom(roomCode, {
        client_id: getOrCreateClientId(),
        name,
        color,
        expertise,
        turnstile_token: turnstileToken,
      });
      saveRoomSession(roomCode, result.player_session);
      onJoined(result);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to join room. Try another name or color.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bm-invite-page">
      <div className="bm-invite-card">
        <div className="bm-invite-frame">
          <div className="bm-invite-inner">

            {/* Top decorative strip */}
            <div className="bm-invite-strip">
              <div className="bm-invite-strip-label">
                <Sparkles />
                Live Trivia
              </div>
              <div className="bm-invite-strip-dots">
                <div className="bm-invite-dot" style={{ background: "var(--amber)" }} />
                <div className="bm-invite-dot" style={{ background: "var(--sage)" }} />
                <div className="bm-invite-dot" style={{ background: "var(--rose)" }} />
              </div>
            </div>

            {/* Header */}
            <div className="bm-invite-header">
              <div className="bm-invite-pre">You&apos;re Invited To</div>
              <div className="bm-invite-title">
                <span style={{ color: "var(--amber)" }}>Buzzer</span>
                <span style={{ color: "var(--sage)" }}>Minds</span>
              </div>
              <div className="bm-invite-room">
                <Hash />
                <span className="bm-invite-room-code">{roomCode}</span>
              </div>
              <p className="bm-invite-desc">
                A live trivia game is starting. Fill in your details to claim a seat.
              </p>
            </div>

            {/* Diamond ornament divider */}
            <div className="bm-ornament">
              <div className="bm-ornament-line" />
              <div className="bm-ornament-diamond" />
              <div className="bm-ornament-line" />
            </div>

            {/* Form */}
            <form className="bm-invite-form" onSubmit={handleSubmit}>
              {/* Name field */}
              <div className="bm-invite-field">
                <label className="bm-invite-label">
                  <User />
                  Your Name
                </label>
                <input
                  type="text"
                  className="bm-invite-input"
                  placeholder="Display name"
                  maxLength={40}
                  autoComplete="off"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {/* Color picker */}
              <div className="bm-invite-field">
                <label className="bm-invite-label">
                  <Palette />
                  Pick a Color
                </label>
                <div className="bm-color-swatches">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="bm-swatch-pick"
                      data-active={color === c}
                      onClick={() => setColor(c)}
                      aria-label={`Select color ${c}`}
                    >
                      <span
                        style={{
                          display: "block",
                          width: "100%",
                          height: "100%",
                          borderRadius: "50%",
                          background: c,
                        }}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Expertise */}
              <div className="bm-invite-field">
                <label className="bm-invite-label">
                  <Brain />
                  Expertise
                </label>
                <textarea
                  className="bm-invite-input"
                  placeholder="What are you good at?"
                  maxLength={250}
                  autoComplete="off"
                  required
                  value={expertise}
                  onChange={(e) => setExpertise(e.target.value)}
                />
                <div className="bm-char-count">{expertise.length} / 250</div>
              </div>

              {/* Error message */}
              {error ? (
                <p className="mb-4 text-sm font-semibold text-[var(--rose)]" aria-live="polite">
                  {error}
                </p>
              ) : null}

              {/* Turnstile */}
              <div className="mb-4">
                <TurnstilePlaceholder enabled={config.turnstile_enabled} />
              </div>

              {/* Submit */}
              <button
                type="submit"
                className="bm-invite-submit"
                disabled={submitting}
              >
                <PartyPopper />
                {submitting ? "Joining..." : "RSVP & Join"}
              </button>
            </form>

            {/* Bottom strip */}
            <div className="bm-invite-bottom">
              First player becomes <strong style={{ color: "var(--sage)", fontWeight: 600 }}>VIP</strong> and controls the game
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Player Room Scene (in-game) ── */

function PlayerRoomScene({ session, config, onSessionLost }: { session: PlayerSessionResponse; config: PublicConfigResponse; onSessionLost: () => void }) {
  const { room, connected, replaceRoom } = useRoomLive();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [answerText, setAnswerText] = useState("");

  const me = room.players.find((p) => p.id === session.player_id) ?? null;
  const isVip = me?.role === "vip_player";
  const topicVoting = room.topic_voting;
  const myVote = topicVoting?.votes.find((v) => v.player_id === session.player_id) ?? null;
  const myStanding = useMemo(() => {
    const standings = room.score_reveal?.standings ?? room.finished?.standings ?? [];
    return standings.find((e) => e.player_id === session.player_id) ?? null;
  }, [room.finished?.standings, room.score_reveal?.standings, session.player_id]);

  async function runAction(action: string, operation: () => Promise<RoomStateResponse>) {
    setBusy(action);
    setError(null);
    try {
      const nextRoom = await operation();
      replaceRoom(nextRoom);
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "Something went wrong. Try again.";
      setError(message);
      if (message.includes("Invalid player session")) onSessionLost();
    } finally {
      setBusy(null);
    }
  }

  function patchSettings(settings: SettingsPatch) {
    return runAction("settings", () => api.updateSettings(room.code, session.player_id, session.player_token, currentClientId(), settings));
  }

  function toggleTopic(topicId: string) {
    setSelectedTopicIds((current) => {
      if (current.includes(topicId)) return current.filter((i) => i !== topicId);
      if (topicVoting && current.length >= topicVoting.max_approvals_per_player) return current;
      return [...current, topicId];
    });
  }

  if (!me) {
    return (
      <PhaseCard badge="Session Lost" title="No longer active" body="Rejoin the room from the same phone to get back in.">
        <button className="bm-btn-primary w-full py-3" onClick={onSessionLost} type="button">Rejoin Room</button>
      </PhaseCard>
    );
  }

  const activeMe = me;

  function renderPhaseCard() {
    if (room.phase === "lobby") {
      return (
        <div className="bm-card rounded-[var(--radius)]">
          <div className="p-5 pb-0">
            <Badge variant="secondary">Game Settings</Badge>
            <h2 className="bm-title mt-2 text-xl text-[var(--text-bright)]">Pregame controls</h2>
            <p className="bm-body mt-1 text-sm">Only the VIP can change settings before the game starts.</p>
          </div>
          <div className="grid gap-4 p-5">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="model-preset">Model preset</FieldLabel>
                <FieldContent>
                  <Select disabled={!isVip || room.settings_locked} value={room.settings.model_preset_id} onValueChange={(v) => patchSettings({ model_preset_id: v })}>
                    <SelectTrigger aria-label="Model preset" className="h-11 rounded-xl border border-[var(--border)] bg-[rgba(20,20,20,0.5)]" id="model-preset"><SelectValue placeholder="Choose a model preset" /></SelectTrigger>
                    <SelectContent><SelectGroup>{config.model_presets.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                  <FieldDescription>Content: {room.settings.content_model_id} · Grading: {room.settings.grading_model_id}</FieldDescription>
                </FieldContent>
              </Field>
            </FieldGroup>

            <div className="grid gap-4 rounded-xl border border-[var(--border)] bg-[rgba(20,20,20,0.5)] p-4">
              <SettingSlider description="Topics in the shared pool." disabled={!isVip || room.settings_locked} label="Topic pool size" max={config.topic_pool_size.max} min={config.topic_pool_size.min} onCommit={(v) => patchSettings({ topic_pool_size: v })} value={room.settings.topic_pool_size} />
              <SettingSlider description="Full main-question rounds." disabled={!isVip || room.settings_locked} label="Rounds" max={config.rounds_count.max} min={config.rounds_count.min} onCommit={(v) => patchSettings({ rounds_count: v })} value={room.settings.rounds_count} />
              <SettingSlider description="Timer mode duration." disabled={!isVip || room.settings_locked} label="Timer (min)" max={config.timer_minutes.max} min={config.timer_minutes.min} onCommit={(v) => patchSettings({ timer_minutes: v })} value={room.settings.timer_minutes} />
              <SettingSlider description="Seconds for main answer." disabled={!isVip || room.settings_locked} label="Answer time" max={config.main_answer_seconds.max} min={config.main_answer_seconds.min} onCommit={(v) => patchSettings({ main_answer_seconds: v })} value={room.settings.main_answer_seconds} />
              <SettingSlider description="Delay after full reveal." disabled={!isVip || room.settings_locked} label="No-buzz window" max={config.no_buzz_window_seconds.max} min={config.no_buzz_window_seconds.min} onCommit={(v) => patchSettings({ no_buzz_window_seconds: v })} value={room.settings.no_buzz_window_seconds} />
              <SettingSlider description="Seconds per bonus question." disabled={!isVip || room.settings_locked} label="Bonus time" max={config.bonus_answer_seconds.max} min={config.bonus_answer_seconds.min} onCommit={(v) => patchSettings({ bonus_answer_seconds: v })} value={room.settings.bonus_answer_seconds} />
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="reveal-mode">Reveal mode</FieldLabel>
                <FieldContent>
                  <Select disabled={!isVip || room.settings_locked} value={room.settings.reveal_mode} onValueChange={(v) => patchSettings({ reveal_mode: v as SettingsPatch["reveal_mode"] })}>
                    <SelectTrigger className="h-11 rounded-xl border border-[var(--border)] bg-[rgba(20,20,20,0.5)]" id="reveal-mode"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>{config.reveal_modes.map((m) => <SelectItem key={m} value={m}>{formatPhase(`question_reveal_${m}`)}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor="end-mode">End mode</FieldLabel>
                <FieldContent>
                  <Select disabled={!isVip || room.settings_locked} value={room.settings.end_mode} onValueChange={(v) => patchSettings({ end_mode: v as SettingsPatch["end_mode"] })}>
                    <SelectTrigger className="h-11 rounded-xl border border-[var(--border)] bg-[rgba(20,20,20,0.5)]" id="end-mode"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>{config.end_modes.map((m) => <SelectItem key={m} value={m}>{m === "rounds" ? "Rounds" : "Timer"}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor="timer-expiry-mode">Timer expiry</FieldLabel>
                <FieldContent>
                  <Select disabled={!isVip || room.settings_locked || room.settings.end_mode !== "timer"} value={room.settings.timer_expiry_mode} onValueChange={(v) => patchSettings({ timer_expiry_mode: v as SettingsPatch["timer_expiry_mode"] })}>
                    <SelectTrigger className="h-11 rounded-xl border border-[var(--border)] bg-[rgba(20,20,20,0.5)]" id="timer-expiry-mode"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>{config.timer_expiry_modes.map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                </FieldContent>
              </Field>
            </FieldGroup>

            <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[rgba(20,20,20,0.5)] p-4">
              <Field>
                <FieldLabel htmlFor="moderation-mode">Moderation</FieldLabel>
                <FieldContent>
                  <Select disabled={!isVip || room.settings_locked} value={room.settings.moderation_mode} onValueChange={(v) => patchSettings({ moderation_mode: v as SettingsPatch["moderation_mode"] })}>
                    <SelectTrigger className="h-11 rounded-xl border border-[var(--border)] bg-[rgba(20,20,20,0.5)]" id="moderation-mode"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup><SelectItem value="off">Off</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="family_safe">Family Safe</SelectItem></SelectGroup></SelectContent>
                  </Select>
                </FieldContent>
              </Field>
              <Field orientation="horizontal"><FieldLabel htmlFor="narration">Narration</FieldLabel><FieldContent><Switch checked={room.settings.audio.narration_enabled} disabled={!isVip || room.settings_locked} id="narration" onCheckedChange={(c) => patchSettings({ narration_enabled: c })} /></FieldContent></Field>
              <Field orientation="horizontal"><FieldLabel htmlFor="sfx">Sound effects</FieldLabel><FieldContent><Switch checked={room.settings.audio.sound_effects_enabled} disabled={!isVip || room.settings_locked} id="sfx" onCheckedChange={(c) => patchSettings({ sound_effects_enabled: c })} /></FieldContent></Field>
              <Field orientation="horizontal"><FieldLabel htmlFor="music">Music</FieldLabel><FieldContent><Switch checked={room.settings.audio.music_enabled} disabled={!isVip || room.settings_locked} id="music" onCheckedChange={(c) => patchSettings({ music_enabled: c })} /></FieldContent></Field>
            </div>

            {error ? <p aria-live="polite" className="text-sm font-semibold text-[var(--rose)]">{error}</p> : null}
            {isVip ? (
              <button className="bm-btn-primary w-full py-3.5 text-base" disabled={!room.can_start || room.settings_locked || busy === "start"} onClick={() => runAction("start", () => api.startGame(room.code, session.player_id, session.player_token, currentClientId()))} type="button">
                {busy === "start" ? "Starting..." : "Start Match"}
              </button>
            ) : null}
            {!room.can_start ? (
              <div className="rounded-xl border border-[var(--amber)]/20 bg-[var(--amber)]/5 px-4 py-3 text-sm">
                <p className="font-semibold text-[var(--amber)]">Start blockers</p>
                <ul className="mt-1.5 flex flex-col gap-1 text-[var(--text-dim)]">{room.start_blockers.map((b) => <li key={b}>- {b}</li>)}</ul>
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    if (room.phase === "topic_voting" && topicVoting) {
      return (
        <div className="bm-card rounded-[var(--radius)]">
          <div className="p-5 pb-0">
            <div className="flex items-center justify-between">
              <Badge variant={topicVoting.status === "locked" ? "secondary" : "outline"}>Topic Voting</Badge>
              <Badge variant="outline">{topicVoting.max_approvals_per_player} max</Badge>
            </div>
            <h2 className="bm-title mt-2 text-xl text-[var(--text-bright)]">
              {topicVoting.status === "locked" ? "Pool locked" : "Choose your topics"}
            </h2>
            <p className="bm-body mt-1 text-sm">Approve up to {topicVoting.max_approvals_per_player} topics. Highest voted make the pool.</p>
          </div>
          <div className="grid gap-2 p-5">
            {topicVoting.options.map((topic) => {
              const selected = selectedTopicIds.includes(topic.id) || myVote?.topic_ids.includes(topic.id);
              const locked = topicVoting.status === "locked" || Boolean(myVote);
              return (
                <button key={topic.id} className={`bm-focus-ring flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150 ${selected ? "border-[var(--sky)]/40 bg-[var(--sky)]/10" : "border-[var(--border)] bg-[rgba(20,20,20,0.5)]"} disabled:cursor-default`} disabled={locked} onClick={() => toggleTopic(topic.id)} type="button">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text-bright)]">{topic.label}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-dim)]">{topic.source === "player" ? "From expertise" : "Standard"}</p>
                  </div>
                  <Badge variant={selected ? "secondary" : "outline"}>{selected ? "Approved" : `${topic.approval_count}`}</Badge>
                </button>
              );
            })}
            {topicVoting.status === "collecting_votes" ? (
              <>
                {myVote ? (
                  <div className="rounded-xl border border-[var(--border)] bg-[rgba(20,20,20,0.5)] px-4 py-3 text-sm text-[var(--text-dim)]">
                    Vote locked. Waiting on: {topicVoting.players_pending.join(", ") || "nobody"}
                  </div>
                ) : (
                  <button className="bm-btn-primary w-full py-3" disabled={selectedTopicIds.length === 0 || busy === "topic-vote"} onClick={() => runAction("topic-vote", () => api.submitTopicVotes(room.code, session.player_id, session.player_token, currentClientId(), selectedTopicIds))} type="button">
                    {busy === "topic-vote" ? "Submitting..." : `Submit ${selectedTopicIds.length} approvals`}
                  </button>
                )}
                {isVip ? (
                  <div className="flex gap-3">
                    <button className="bm-btn-outline flex-1 py-2.5 text-sm" disabled={topicVoting.rerolls_remaining <= 0 || topicVoting.votes.length > 0 || busy === "reroll-topics"} onClick={() => runAction("reroll-topics", () => api.rerollTopics(room.code, session.player_id, session.player_token, currentClientId()))} type="button">
                      {busy === "reroll-topics" ? "Refreshing..." : `Reroll (${topicVoting.rerolls_remaining})`}
                    </button>
                    <button className="bm-btn-primary flex-1 py-2.5 text-sm" disabled={busy === "lock-topics"} onClick={() => runAction("lock-topics", () => api.lockTopicVoting(room.code, session.player_id, session.player_token, currentClientId()))} type="button">
                      {busy === "lock-topics" ? "Locking..." : "Lock Pool"}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-xl border border-[var(--sage)]/20 bg-[var(--sage)]/5 px-4 py-3 text-sm text-[var(--text-dim)]">
                Pool locked. Preparing the first question.
              </div>
            )}
          </div>
        </div>
      );
    }

    if (room.phase === "question_loading") {
      return (
        <PhaseCard badge="Loading" title="Question incoming" body={`Topic: ${room.progress?.current_topic_label ?? "Unknown"}`}>
          <Loader2 className="h-6 w-6 animate-spin text-[var(--amber)]" />
        </PhaseCard>
      );
    }

    if ((room.phase === "question_reveal_progressive" || room.phase === "question_reveal_full") && room.current_question) {
      const chunks = room.phase === "question_reveal_full" ? room.current_question.question.prompt_chunks : room.current_question.question.prompt_chunks.slice(0, room.current_question.question.reveal_index);
      return <PhaseCard badge={formatPhase(room.phase)} title={room.current_question.question.topic_label} body={chunks.join(" ") || "Stand by..."} />;
    }

    if (room.phase === "buzz_open") {
      return (
        <PhaseCard badge="Buzz Open" title="Hit the buzzer!" body={`Window closes in ${formatCountdown(room.buzz_state?.deadline_at ?? null)}.`}>
          {activeMe.role === "spectator" ? (
            <p className="text-sm text-[var(--text-dim)]">Spectators watch this round.</p>
          ) : (
            <button
              className={`w-full rounded-xl py-6 text-xl font-bold transition-all duration-150 ${activeMe.can_buzz ? "bm-btn-primary bm-buzz-active text-2xl" : "cursor-default rounded-xl border border-[var(--border)] bg-[rgba(20,20,20,0.5)] text-[var(--text-dim)] opacity-60"}`}
              disabled={!activeMe.can_buzz || busy === "buzz"}
              onClick={() => runAction("buzz", () => api.buzzIn(room.code, session.player_id, session.player_token, currentClientId()))}
              type="button"
            >
              {busy === "buzz" ? "BUZZING..." : activeMe.can_buzz ? "BUZZ IN" : "LOCKED OUT"}
            </button>
          )}
        </PhaseCard>
      );
    }

    if ((room.phase === "answering" || room.phase === "bonus_answering") && (activeMe.is_answering || activeMe.bonus_active || room.current_question?.answering_player_id === activeMe.id || room.bonus_chain?.awarded_player_id === activeMe.id)) {
      const prompt = room.phase === "bonus_answering" ? room.bonus_chain?.questions[room.bonus_chain.current_index]?.prompt : room.current_question?.question.prompt;
      const deadline = room.phase === "bonus_answering" ? room.bonus_chain?.answer_deadline_at : room.current_question?.answering_deadline_at;
      return (
        <div className="bm-card rounded-[var(--radius)]">
          <div className="p-5">
            <Badge variant="secondary">{room.phase === "bonus_answering" ? "Bonus" : "Your Turn"}</Badge>
            <h2 className="bm-title mt-2 text-xl text-[var(--text-bright)]">You have the floor</h2>
            <p className="bm-body mt-1 text-sm">{prompt}</p>
          </div>
          <div className="grid gap-3 px-5 pb-5">
            <Textarea className="min-h-24 rounded-xl border border-[var(--border)] bg-[rgba(20,20,20,0.5)] text-[var(--text-bright)] placeholder:text-[var(--text-dim)]" maxLength={160} onChange={(e) => setAnswerText(e.target.value)} placeholder="Type your answer..." value={answerText} />
            <div className="flex items-center justify-between">
              <span className="bm-countdown text-sm flex items-center gap-1"><Clock className="h-4 w-4" />{formatCountdown(deadline ?? null)}</span>
              <span className="text-xs text-[var(--text-dim)]">{answerText.length}/160</span>
            </div>
            <button className="bm-btn-primary w-full py-3" disabled={!answerText.trim() || busy === "answer"} onClick={() => runAction("answer", async () => { const nr = await api.submitAnswer(room.code, session.player_id, session.player_token, currentClientId(), answerText.trim()); setAnswerText(""); return nr; })} type="button">
              {busy === "answer" ? "Submitting..." : "Submit Answer"}
            </button>
          </div>
        </div>
      );
    }

    if (room.phase === "answering" || room.phase === "bonus_answering") {
      return <PhaseCard badge={room.phase === "bonus_answering" ? "Bonus" : "Answering"} title="Another player is answering" body="Watch the display and wait for the result." />;
    }

    if (room.phase === "grading" && room.adjudication?.status !== "idle") {
      const adj = room.adjudication;
      if (!adj) return null;
      const canVote = adj.eligible_voter_ids.includes(activeMe.id) || (isVip && adj.status === "vip_deciding");
      return (
        <PhaseCard badge="Adjudication" title="Manual decision needed" body={adj.prompt ?? room.current_question?.grading_reason ?? "Automatic grading failed."}>
          {canVote ? (
            <div className="flex gap-3">
              <button className="bm-btn-primary flex-1 py-3 flex items-center justify-center gap-2" disabled={busy === "adjudicate-accept"} onClick={() => runAction("adjudicate-accept", () => api.adjudicate(room.code, session.player_id, session.player_token, currentClientId(), "accept"))} type="button">
                <CheckCircle className="h-5 w-5" /> Accept
              </button>
              <button className="bm-btn-outline flex-1 py-3 flex items-center justify-center gap-2" disabled={busy === "adjudicate-reject"} onClick={() => runAction("adjudicate-reject", () => api.adjudicate(room.code, session.player_id, session.player_token, currentClientId(), "reject"))} type="button">
                <XCircle className="h-5 w-5" /> Reject
              </button>
            </div>
          ) : <p className="text-sm text-[var(--text-dim)]">Only eligible voters can decide.</p>}
        </PhaseCard>
      );
    }

    if (room.phase === "grading") {
      return (
        <PhaseCard badge="Grading" title="Checking the answer" body={room.current_question?.submitted_answer ?? "Hold on..."}>
          <Loader2 className="h-6 w-6 animate-spin text-[var(--amber)]" />
        </PhaseCard>
      );
    }

    if (room.phase === "bonus_loading") {
      return (
        <PhaseCard badge="Bonus" title="Bonus chain incoming" body="Three solo bonus questions.">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--sage)]" />
        </PhaseCard>
      );
    }

    if (room.phase === "score_reveal") {
      const resolved = room.score_reveal?.resolved_question;
      return (
        <PhaseCard badge="Scores" title={room.score_reveal?.headline ?? "Standings updated"} body={myStanding ? `You are #${myStanding.rank} with ${myStanding.score} points.` : "Stand by for the next round."}>
          {resolved ? (
            <div className="grid gap-2 text-sm">
              <div className="rounded-xl border border-[var(--sage)]/20 bg-[var(--sage)]/5 px-4 py-3">
                <p className="font-semibold text-[var(--sage)]">Answer: {resolved.correct_answer}</p>
                <p className="mt-1 text-[var(--text-dim)]">{resolved.grading_reason ?? "No grading note."}</p>
                <p className="mt-1 text-[var(--text-dim)]">{resolved.fact_card.detail}</p>
              </div>
            </div>
          ) : null}
        </PhaseCard>
      );
    }

    if (room.phase === "paused_waiting_for_vip") {
      return (
        <PhaseCard badge="Paused" title="Waiting for VIP" body={`${room.pause_state?.reason ?? "Match paused."} ${room.pause_state ? `Timeout ${formatCountdown(room.pause_state.deadline_at)}.` : ""}`} />
      );
    }

    if (room.phase === "finished") {
      return (
        <PhaseCard badge="Game Over" title="Match complete" body={myStanding ? `Final rank #${myStanding.rank} with ${myStanding.score} points.` : "Thanks for playing."}>
          <div className="flex flex-col gap-3">
            {room.finished?.summary_id ? (
              <Button asChild className="rounded-xl" variant="outline"><Link href={`/summary/${room.finished.summary_id}`}>View Summary</Link></Button>
            ) : null}
            {isVip ? (
              <button className="bm-btn-primary w-full py-3" disabled={busy === "reset"} onClick={() => runAction("reset", () => api.resetRoom(room.code, session.player_id, session.player_token, currentClientId()))} type="button">
                {busy === "reset" ? "Resetting..." : "Reset Room"}
              </button>
            ) : null}
          </div>
        </PhaseCard>
      );
    }

    return null;
  }

  return (
    <>
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "var(--amber)" }}>
            <Sparkles className="h-4 w-4" style={{ color: "var(--bg)" }} />
          </div>
          <span className="bm-title text-base text-[var(--text-bright)]">BuzzerMinds</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={connected ? "secondary" : "outline"}>{connected ? "Live" : "..."}</Badge>
          <span className="bm-display-code text-sm text-[var(--amber)]">{room.code}</span>
        </div>
      </div>

      {/* Player identity strip */}
      <div className="mb-5 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="bm-swatch" style={{ backgroundColor: me.color }} />
          <div>
            <p className="font-semibold text-[var(--text-bright)]">{me.name}</p>
            <p className="text-xs text-[var(--text-dim)]">{formatRole(me.role)} · {me.score} pts</p>
          </div>
        </div>
        <Badge variant="outline">{formatPhase(room.phase)}</Badge>
      </div>

      {/* Main content */}
      <div className="grid gap-4">
        {renderPhaseCard()}

        {/* Player roster (collapsible on mobile) */}
        <details className="bm-card rounded-[var(--radius)]" open={room.phase === "lobby"}>
          <summary className="cursor-pointer p-5 text-sm font-bold uppercase tracking-widest text-[var(--text-dim)]">
            Players ({room.players.length})
          </summary>
          <div className="grid gap-2 px-5 pb-5">
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
                trailing={
                  isVip && room.phase === "lobby" && player.id !== session.player_id ? (
                    <Button className="rounded-xl" disabled={busy === `kick-${player.id}`} onClick={() => runAction(`kick-${player.id}`, () => api.kickPlayer(room.code, session.player_id, session.player_token, currentClientId(), player.id))} size="sm" type="button" variant="outline">
                      Kick
                    </Button>
                  ) : player.id === room.vip_player_id ? <Badge>VIP</Badge> : null
                }
              />
            ))}
            {room.phase === "lobby" && me.role !== "spectator" ? (
              <button className={`w-full rounded-xl py-2.5 text-sm font-semibold transition-all ${me.ready ? "bm-btn-outline" : "bm-btn-primary"}`} disabled={busy === "ready"} onClick={() => runAction("ready", () => api.setReady(room.code, session.player_id, session.player_token, currentClientId(), !me.ready))} type="button">
                {busy === "ready" ? "Saving..." : me.ready ? "Unready" : "Mark Ready"}
              </button>
            ) : null}
          </div>
        </details>

        {/* Narration */}
        {room.narration?.text ? (
          <div className="bm-card rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-dim)]">Narration</p>
            <p className="mt-1.5 text-sm italic text-[var(--text-bright)]">{room.narration.text}</p>
          </div>
        ) : null}

        {error ? <p className="text-center text-sm font-semibold text-[var(--rose)]">{error}</p> : null}
      </div>
    </>
  );
}

/* ── Root Export ── */

export function PlayerRoomView({ roomCode, initialRoom, config }: PlayerRoomViewProps) {
  const [session, setSession] = useState<PlayerSessionResponse | null>(() => loadRoomSession(roomCode));
  const [room, setRoom] = useState(initialRoom);

  function resetSession() {
    clearRoomSession(roomCode);
    setSession(null);
  }

  if (!session) {
    return (
      <>
        <WireframeBackground />
        <TurnstileProvider config={config}>
          <JoinForm config={config} roomCode={roomCode} onJoined={(result) => { setRoom(result.room); setSession(result.player_session); }} />
        </TurnstileProvider>
      </>
    );
  }

  return (
    <GameShell>
      <TurnstileProvider config={config}>
        <RoomLiveProvider initialRoom={room} query={{ client_type: "player", player_id: session.player_id, player_token: session.player_token, client_id: currentClientId() }} roomCode={roomCode}>
          <NarrationAudio />
          <ShowAudio />
          <PlayerRoomScene config={config} onSessionLost={resetSession} session={session} />
        </RoomLiveProvider>
      </TurnstileProvider>
    </GameShell>
  );
}
