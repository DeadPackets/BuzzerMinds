"use client";

import Link from "next/link";
import { ReactNode, FormEvent, useMemo, useState, useCallback, useEffect } from "react";
import {
  ArrowRight,
  Brain,
  Check,
  CheckCircle,
  ChevronDown,
  Clock,
  Coffee,
  Crown,
  Eye,
  Flag,
  Gamepad2,
  Hourglass,
  Layers,
  Loader2,
  Mic,
  Minus,
  Monitor,
  Palette,
  Play,
  Plus,
  Repeat,
  Scale,
  Shield,
  ShieldCheck,
  ShieldOff,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Target,
  Ticket,
  Timer,
  User,
  X,
  XCircle,
  Zap,
} from "lucide-react";


import { useTurnstile, TurnstileProvider } from "@/components/providers/turnstile-provider";
import { TurnstilePlaceholder } from "@/components/turnstile-placeholder";
import { RoomLiveProvider, useRoomLive } from "@/components/providers/room-live-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayerRow } from "@/components/ui/player-row";
import { SettingSlider } from "@/components/ui/setting-slider";
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

/* ── Buzzer speed presets (frontend-only) ── */

const BUZZER_PRESETS = {
  lightning: { main_answer_seconds: 10, no_buzz_window_seconds: 5, bonus_answer_seconds: 10 },
  standard: { main_answer_seconds: 15, no_buzz_window_seconds: 8, bonus_answer_seconds: 15 },
  relaxed: { main_answer_seconds: 25, no_buzz_window_seconds: 12, bonus_answer_seconds: 25 },
} as const;

type BuzzerPresetKey = keyof typeof BUZZER_PRESETS;

/** Detect which buzzer preset matches current settings, if any */
function detectBuzzerPreset(main: number, noBuzz: number, bonus: number): BuzzerPresetKey | null {
  for (const [key, vals] of Object.entries(BUZZER_PRESETS)) {
    if (vals.main_answer_seconds === main && vals.no_buzz_window_seconds === noBuzz && vals.bonus_answer_seconds === bonus) {
      return key as BuzzerPresetKey;
    }
  }
  return null;
}

/* ── Phase Card (reusable for game phases) ── */

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

/* ── useCountdown hook (shared with display) ── */

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

/* ── PGTimer: Circular SVG countdown (player-size variant) ── */

function PGTimer({ deadline, totalSeconds, label }: { deadline: string | null; totalSeconds: number; label: string }) {
  const remaining = useCountdown(deadline);
  const progress = totalSeconds > 0 ? remaining / totalSeconds : 0;
  const isWarning = remaining > 0 && remaining <= 5;

  const r = 42;
  const circumference = 2 * Math.PI * r;
  const dashoffset = circumference * (1 - progress);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const display = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  if (!deadline) return null;

  return (
    <div className={`bm-pg-timer ${isWarning ? "bm-pg-timer--warning" : ""}`}>
      <div className="bm-pg-timer-ring">
        <svg className="bm-pg-timer-svg" viewBox="0 0 100 100">
          <circle className="bm-pg-timer-bg" cx="50" cy="50" r={r} />
          <circle
            className="bm-pg-timer-fg"
            cx="50" cy="50" r={r}
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
          />
        </svg>
        <span className="bm-pg-timer-value">{display}</span>
      </div>
      <span className="bm-pg-timer-label">{label}</span>
    </div>
  );
}

/* ── Phase badge accent helper ── */

function phaseBadgeAccent(phase: string): "amber" | "sage" | "rose" | "sky" | undefined {
  switch (phase) {
    case "buzz_open":
    case "question_reveal_progressive":
    case "question_reveal_full":
      return "amber";
    case "answering":
    case "bonus_answering":
      return "sky";
    case "score_reveal":
    case "finished":
      return "sage";
    case "grading":
      return "rose";
    default:
      return undefined;
  }
}

/* ══════════════════════════════════════════════════════
   Arcade Ticket Join Form
   ══════════════════════════════════════════════════════ */

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
    <div className="bm-ticket-page">
      <div className="bm-ticket">
        {/* ── Ticket Top ── */}
        <div className="bm-ticket-top">
          <div className="bm-ticket-logo">
            <span style={{ color: "var(--amber)" }}>Buzzer</span>
            <span style={{ color: "var(--sage)" }}>Minds</span>
          </div>
          <div className="bm-ticket-admit">Admit One Player</div>
          <div className="bm-ticket-code">{roomCode}</div>
          <div className="bm-ticket-subtitle">A live trivia game is starting</div>
        </div>

        {/* ── Perforation ── */}
        <div className="bm-ticket-perf">
          <div className="bm-ticket-perf-left" />
          <div className="bm-ticket-perf-right" />
        </div>

        {/* ── Ticket Bottom (form) ── */}
        <div className="bm-ticket-bottom">
          <form onSubmit={handleSubmit}>
            {/* Name */}
            <div className="bm-ticket-field">
              <label className="bm-ticket-label">
                <User /> Your Name
              </label>
              <input
                type="text"
                className="bm-ticket-input"
                placeholder="Display name"
                maxLength={40}
                autoComplete="off"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Color picker */}
            <div className="bm-ticket-field">
              <label className="bm-ticket-label">
                <Palette /> Pick a Color
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
            <div className="bm-ticket-field">
              <label className="bm-ticket-label">
                <Brain /> Expertise
              </label>
              <textarea
                className="bm-ticket-input"
                placeholder="What are you good at?"
                maxLength={250}
                autoComplete="off"
                required
                value={expertise}
                onChange={(e) => setExpertise(e.target.value)}
              />
              <div className="bm-char-count">{expertise.length} / 250</div>
            </div>

            {/* Error */}
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
            <button type="submit" className="bm-ticket-submit" disabled={submitting}>
              <Ticket />
              {submitting ? "Joining..." : "Claim Your Seat"}
            </button>
          </form>

          {/* Serial number footer */}
          <div className="bm-ticket-serial">
            <span>BM-{roomCode}-001</span>
            <span>First player = VIP</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   VIP Configure Screen (full-screen mobile)
   ══════════════════════════════════════════════════════ */

function VipConfigureScreen({
  room,
  config,
  onPatchSettings,
  onDone,
}: {
  room: RoomStateResponse;
  config: PublicConfigResponse;
  onPatchSettings: (patch: SettingsPatch) => void;
  onDone: () => void;
}) {
  const s = room.settings;
  const buzzerPreset = detectBuzzerPreset(s.main_answer_seconds, s.no_buzz_window_seconds, s.bonus_answer_seconds);

  return (
    <div className="bm-mobile-frame">
      {/* Top bar */}
      <div className="bm-topbar">
        <div className="bm-topbar-left">
          <Sparkles />
          <span className="bm-topbar-logo">
            <span style={{ color: "var(--amber)" }}>Buzzer</span>
            <span style={{ color: "var(--sage)" }}>Minds</span>
          </span>
        </div>
        <span className="bm-topbar-code">{room.code}</span>
      </div>

      {/* Scrollable body */}
      <div className="bm-cfg-scroll">
        <h1 className="bm-cfg-title" style={{ color: "var(--text-bright)" }}>
          Configure Match
        </h1>
        <p className="bm-cfg-subtitle">Set up the game before players join. You can adjust later.</p>

        {/* ── Game Mode ── */}
        <div className="bm-cfg-label"><Gamepad2 /> Game Mode</div>
        <div className="bm-cfg-mode-row">
          <button
            type="button"
            className="bm-cfg-mode-card"
            data-active={s.end_mode === "rounds"}
            onClick={() => onPatchSettings({ end_mode: "rounds" })}
          >
            <span className="bm-check-dot"><Check /></span>
            <span className="bm-cfg-mode-icon"><Repeat /></span>
            <span className="bm-cfg-mode-name">Rounds</span>
            <span className="bm-cfg-mode-desc">Play a set number of rounds</span>
          </button>
          <button
            type="button"
            className="bm-cfg-mode-card"
            data-active={s.end_mode === "timer"}
            onClick={() => onPatchSettings({ end_mode: "timer" })}
          >
            <span className="bm-check-dot"><Check /></span>
            <span className="bm-cfg-mode-icon"><Clock /></span>
            <span className="bm-cfg-mode-name">Timed</span>
            <span className="bm-cfg-mode-desc">Play until the clock runs out</span>
          </button>
        </div>

        {/* ── AI Quality ── */}
        <div className="bm-cfg-label"><Sparkles /> AI Quality</div>
        <div className="bm-cfg-ai-row">
          {config.model_presets.map((preset) => {
            const presetUi: Record<string, { icon: ReactNode; desc: string }> = {
              speed: { icon: <Zap />, desc: "Fast & fun, may slip up" },
              balanced: { icon: <Scale />, desc: "Smart questions, quick judging" },
              pro: { icon: <Crown />, desc: "Best quality, slower pace" },
            };
            const ui = presetUi[preset.id] ?? { icon: <Sparkles />, desc: preset.description };
            return (
              <button
                key={preset.id}
                type="button"
                className="bm-cfg-ai-card"
                data-preset={preset.id}
                data-active={s.model_preset_id === preset.id}
                onClick={() => onPatchSettings({ model_preset_id: preset.id })}
              >
                <span className="bm-check-dot"><Check /></span>
                <span className="bm-cfg-ai-icon">{ui.icon}</span>
                <span className="bm-cfg-ai-name">{preset.label}</span>
                <span className="bm-cfg-ai-desc">{ui.desc}</span>
              </button>
            );
          })}
        </div>

        {/* ── Rounds / Timer stepper ── */}
        <div className="bm-cfg-label">
          {s.end_mode === "rounds" ? <><Layers /> Rounds</> : <><Timer /> Timer</>}
        </div>
        <div className="bm-cfg-stepper-section">
          {s.end_mode === "rounds" ? (
            <div className="bm-cfg-stepper">
              <button
                type="button"
                className="bm-cfg-stepper-btn"
                disabled={s.rounds_count <= config.rounds_count.min}
                onClick={() => onPatchSettings({ rounds_count: s.rounds_count - 1 })}
              >
                <Minus />
              </button>
              <div className="bm-cfg-stepper-sep" />
              <div className="bm-cfg-stepper-display">
                <span className="bm-cfg-stepper-num">{s.rounds_count}</span>
                <span className="bm-cfg-stepper-unit">Rounds</span>
              </div>
              <div className="bm-cfg-stepper-sep" />
              <button
                type="button"
                className="bm-cfg-stepper-btn"
                disabled={s.rounds_count >= config.rounds_count.max}
                onClick={() => onPatchSettings({ rounds_count: s.rounds_count + 1 })}
              >
                <Plus />
              </button>
            </div>
          ) : (
            <div className="bm-cfg-stepper">
              <button
                type="button"
                className="bm-cfg-stepper-btn"
                disabled={s.timer_minutes <= config.timer_minutes.min}
                onClick={() => onPatchSettings({ timer_minutes: s.timer_minutes - 1 })}
              >
                <Minus />
              </button>
              <div className="bm-cfg-stepper-sep" />
              <div className="bm-cfg-stepper-display">
                <span className="bm-cfg-stepper-num">{s.timer_minutes}</span>
                <span className="bm-cfg-stepper-unit">Minutes</span>
              </div>
              <div className="bm-cfg-stepper-sep" />
              <button
                type="button"
                className="bm-cfg-stepper-btn"
                disabled={s.timer_minutes >= config.timer_minutes.max}
                onClick={() => onPatchSettings({ timer_minutes: s.timer_minutes + 1 })}
              >
                <Plus />
              </button>
            </div>
          )}
        </div>

        {/* ── Buzzer Speed ── */}
        <div className="bm-cfg-label"><Zap /> Buzzer Speed</div>
        <div className="bm-cfg-buzzer-row">
          <button
            type="button"
            className="bm-cfg-buzzer-card"
            data-bz="lightning"
            data-active={buzzerPreset === "lightning"}
            onClick={() => onPatchSettings(BUZZER_PRESETS.lightning)}
          >
            <span className="bm-check-dot"><Check /></span>
            <span className="bm-cfg-buzzer-icon"><Zap /></span>
            <span className="bm-cfg-buzzer-name">Lightning</span>
            <span className="bm-cfg-buzzer-desc">10s answer, 5s no-buzz</span>
          </button>
          <button
            type="button"
            className="bm-cfg-buzzer-card"
            data-bz="standard"
            data-active={buzzerPreset === "standard"}
            onClick={() => onPatchSettings(BUZZER_PRESETS.standard)}
          >
            <span className="bm-check-dot"><Check /></span>
            <span className="bm-cfg-buzzer-icon"><Target /></span>
            <span className="bm-cfg-buzzer-name">Standard</span>
            <span className="bm-cfg-buzzer-desc">15s answer, 8s no-buzz</span>
          </button>
          <button
            type="button"
            className="bm-cfg-buzzer-card"
            data-bz="relaxed"
            data-active={buzzerPreset === "relaxed"}
            onClick={() => onPatchSettings(BUZZER_PRESETS.relaxed)}
          >
            <span className="bm-check-dot"><Check /></span>
            <span className="bm-cfg-buzzer-icon"><Coffee /></span>
            <span className="bm-cfg-buzzer-name">Relaxed</span>
            <span className="bm-cfg-buzzer-desc">25s answer, 12s no-buzz</span>
          </button>
        </div>

        {/* ── Moderation ── */}
        <div className="bm-cfg-label"><Shield /> Moderation</div>
        <div className="bm-cfg-pill-row">
          <button
            type="button"
            className="bm-cfg-pill"
            data-active={s.moderation_mode === "off"}
            onClick={() => onPatchSettings({ moderation_mode: "off" })}
          >
            <span className="bm-cfg-pill-icon"><ShieldOff /></span>
            <span className="bm-cfg-pill-name">Off</span>
          </button>
          <button
            type="button"
            className="bm-cfg-pill"
            data-active={s.moderation_mode === "light"}
            onClick={() => onPatchSettings({ moderation_mode: "light" })}
          >
            <span className="bm-cfg-pill-icon"><Shield /></span>
            <span className="bm-cfg-pill-name">Light</span>
          </button>
          <button
            type="button"
            className="bm-cfg-pill"
            data-active={s.moderation_mode === "family_safe"}
            onClick={() => onPatchSettings({ moderation_mode: "family_safe" })}
          >
            <span className="bm-cfg-pill-icon"><ShieldCheck /></span>
            <span className="bm-cfg-pill-name">Family Safe</span>
          </button>
        </div>

        {/* ── Narration toggle ── */}
        <div className="bm-cfg-label"><Mic /> Narration</div>
        <div style={{ marginBottom: 24 }}>
          <button
            type="button"
            className="bm-cfg-audio-pill"
            data-active={s.audio.narration_enabled}
            onClick={() => onPatchSettings({ narration_enabled: !s.audio.narration_enabled })}
          >
            <Mic />
            <span className="bm-cfg-audio-label">Narration</span>
            <span className="bm-cfg-audio-switch" />
          </button>
        </div>

        {/* ornament divider */}
        <div className="bm-cfg-ornament">
          <div className="bm-cfg-ornament-line" />
          <div className="bm-cfg-ornament-diamond" />
          <div className="bm-cfg-ornament-line" />
        </div>
      </div>

      {/* Footer */}
      <div className="bm-cfg-footer">
        <button type="button" className="bm-cfg-letsgo" onClick={onDone}>
          <Play /> Let&apos;s Go
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   Slide-up Settings Panel (VIP reconfigure from lobby)
   ══════════════════════════════════════════════════════ */

function SettingsPanel({
  open,
  onClose,
  room,
  config,
  onPatchSettings,
}: {
  open: boolean;
  onClose: () => void;
  room: RoomStateResponse;
  config: PublicConfigResponse;
  onPatchSettings: (patch: SettingsPatch) => void;
}) {
  const [tab, setTab] = useState<"quick" | "advanced">("quick");
  const [openAccordions, setOpenAccordions] = useState<Record<string, boolean>>({});
  const s = room.settings;
  const buzzerPreset = detectBuzzerPreset(s.main_answer_seconds, s.no_buzz_window_seconds, s.bonus_answer_seconds);

  const toggleAccordion = useCallback((id: string) => {
    setOpenAccordions((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  return (
    <>
      {/* Scrim */}
      <div className="bm-panel-scrim" data-open={open} onClick={onClose} />

      {/* Panel */}
      <div className="bm-panel" data-open={open}>
        <div className="bm-panel-surface">
          {/* Handle */}
          <div className="bm-panel-handle">
            <div className="bm-panel-drag-bar" />
          </div>

          {/* Header */}
          <div className="bm-panel-header">
            <span className="bm-panel-title">Settings</span>
            <button type="button" className="bm-panel-close" onClick={onClose}>
              <X />
            </button>
          </div>

          {/* Segmented control */}
          <div className="bm-panel-seg">
            <div className="bm-panel-seg-indicator" data-tab={tab} />
            <button
              type="button"
              className="bm-panel-seg-btn"
              data-active={tab === "quick"}
              onClick={() => setTab("quick")}
            >
              <Gamepad2 /> Quick
            </button>
            <button
              type="button"
              className="bm-panel-seg-btn"
              data-active={tab === "advanced"}
              onClick={() => setTab("advanced")}
            >
              <SlidersHorizontal /> Advanced
            </button>
          </div>

          {/* Body */}
          <div className="bm-panel-body">
            {tab === "quick" ? (
              <>
                {/* AI Quality */}
                <div className="bm-cfg-label" style={{ marginTop: 12 }}><Sparkles /> AI Quality</div>
                <div className="bm-cfg-ai-row">
                  {config.model_presets.map((preset) => {
                    const presetUi: Record<string, { icon: ReactNode; desc: string }> = {
                      speed: { icon: <Zap />, desc: "Fast & fun" },
                      balanced: { icon: <Scale />, desc: "Smart & quick" },
                      pro: { icon: <Crown />, desc: "Best quality" },
                    };
                    const ui = presetUi[preset.id] ?? { icon: <Sparkles />, desc: preset.description };
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className="bm-cfg-ai-card"
                        data-preset={preset.id}
                        data-active={s.model_preset_id === preset.id}
                        onClick={() => onPatchSettings({ model_preset_id: preset.id })}
                      >
                        <span className="bm-check-dot"><Check /></span>
                        <span className="bm-cfg-ai-icon">{ui.icon}</span>
                        <span className="bm-cfg-ai-name">{preset.label}</span>
                        <span className="bm-cfg-ai-desc">{ui.desc}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Rounds / Timer stepper */}
                <div className="bm-cfg-label">
                  {s.end_mode === "rounds" ? <><Layers /> Rounds</> : <><Timer /> Timer</>}
                </div>
                <div className="bm-cfg-stepper-section">
                  {s.end_mode === "rounds" ? (
                    <div className="bm-cfg-stepper">
                      <button type="button" className="bm-cfg-stepper-btn" disabled={s.rounds_count <= config.rounds_count.min} onClick={() => onPatchSettings({ rounds_count: s.rounds_count - 1 })}><Minus /></button>
                      <div className="bm-cfg-stepper-sep" />
                      <div className="bm-cfg-stepper-display">
                        <span className="bm-cfg-stepper-num">{s.rounds_count}</span>
                        <span className="bm-cfg-stepper-unit">Rounds</span>
                      </div>
                      <div className="bm-cfg-stepper-sep" />
                      <button type="button" className="bm-cfg-stepper-btn" disabled={s.rounds_count >= config.rounds_count.max} onClick={() => onPatchSettings({ rounds_count: s.rounds_count + 1 })}><Plus /></button>
                    </div>
                  ) : (
                    <div className="bm-cfg-stepper">
                      <button type="button" className="bm-cfg-stepper-btn" disabled={s.timer_minutes <= config.timer_minutes.min} onClick={() => onPatchSettings({ timer_minutes: s.timer_minutes - 1 })}><Minus /></button>
                      <div className="bm-cfg-stepper-sep" />
                      <div className="bm-cfg-stepper-display">
                        <span className="bm-cfg-stepper-num">{s.timer_minutes}</span>
                        <span className="bm-cfg-stepper-unit">Minutes</span>
                      </div>
                      <div className="bm-cfg-stepper-sep" />
                      <button type="button" className="bm-cfg-stepper-btn" disabled={s.timer_minutes >= config.timer_minutes.max} onClick={() => onPatchSettings({ timer_minutes: s.timer_minutes + 1 })}><Plus /></button>
                    </div>
                  )}
                </div>

                {/* Buzzer Speed */}
                <div className="bm-cfg-label"><Zap /> Buzzer Speed</div>
                <div className="bm-cfg-buzzer-row">
                  <button type="button" className="bm-cfg-buzzer-card" data-bz="lightning" data-active={buzzerPreset === "lightning"} onClick={() => onPatchSettings(BUZZER_PRESETS.lightning)}>
                    <span className="bm-check-dot"><Check /></span>
                    <span className="bm-cfg-buzzer-icon"><Zap /></span>
                    <span className="bm-cfg-buzzer-name">Lightning</span>
                    <span className="bm-cfg-buzzer-desc">10s / 5s</span>
                  </button>
                  <button type="button" className="bm-cfg-buzzer-card" data-bz="standard" data-active={buzzerPreset === "standard"} onClick={() => onPatchSettings(BUZZER_PRESETS.standard)}>
                    <span className="bm-check-dot"><Check /></span>
                    <span className="bm-cfg-buzzer-icon"><Target /></span>
                    <span className="bm-cfg-buzzer-name">Standard</span>
                    <span className="bm-cfg-buzzer-desc">15s / 8s</span>
                  </button>
                  <button type="button" className="bm-cfg-buzzer-card" data-bz="relaxed" data-active={buzzerPreset === "relaxed"} onClick={() => onPatchSettings(BUZZER_PRESETS.relaxed)}>
                    <span className="bm-check-dot"><Check /></span>
                    <span className="bm-cfg-buzzer-icon"><Coffee /></span>
                    <span className="bm-cfg-buzzer-name">Relaxed</span>
                    <span className="bm-cfg-buzzer-desc">25s / 12s</span>
                  </button>
                </div>

                {/* Moderation */}
                <div className="bm-cfg-label"><Shield /> Moderation</div>
                <div className="bm-cfg-pill-row">
                  <button type="button" className="bm-cfg-pill" data-active={s.moderation_mode === "off"} onClick={() => onPatchSettings({ moderation_mode: "off" })}>
                    <span className="bm-cfg-pill-icon"><ShieldOff /></span>
                    <span className="bm-cfg-pill-name">Off</span>
                  </button>
                  <button type="button" className="bm-cfg-pill" data-active={s.moderation_mode === "light"} onClick={() => onPatchSettings({ moderation_mode: "light" })}>
                    <span className="bm-cfg-pill-icon"><Shield /></span>
                    <span className="bm-cfg-pill-name">Light</span>
                  </button>
                  <button type="button" className="bm-cfg-pill" data-active={s.moderation_mode === "family_safe"} onClick={() => onPatchSettings({ moderation_mode: "family_safe" })}>
                    <span className="bm-cfg-pill-icon"><ShieldCheck /></span>
                    <span className="bm-cfg-pill-name">Family Safe</span>
                  </button>
                </div>

                {/* Narration */}
                <div className="bm-cfg-label"><Mic /> Narration</div>
                <div style={{ marginBottom: 16 }}>
                  <button
                    type="button"
                    className="bm-cfg-audio-pill"
                    data-active={s.audio.narration_enabled}
                    onClick={() => onPatchSettings({ narration_enabled: !s.audio.narration_enabled })}
                  >
                    <Mic />
                    <span className="bm-cfg-audio-label">Narration</span>
                    <span className="bm-cfg-audio-switch" />
                  </button>
                </div>
              </>
            ) : (
              /* ── Advanced Tab ── */
              <>
                {/* Topic Pool */}
                <div className="bm-adv-accordion" data-open={openAccordions["topics"] ?? false}>
                  <div className="bm-adv-accordion-header" onClick={() => toggleAccordion("topics")}>
                    <span className="bm-adv-accordion-icon amber"><Layers /></span>
                    <span className="bm-adv-accordion-title">Topic Pool</span>
                    <span className="bm-adv-accordion-count">{s.topic_pool_size}</span>
                    <span className="bm-adv-accordion-chevron"><ChevronDown /></span>
                  </div>
                  <div className="bm-adv-accordion-body">
                    <div>
                      <div className="bm-adv-accordion-content">
                        <div className="bm-adv-field">
                          <div className="bm-adv-field-label">
                            <Layers /> Topic pool size
                            <span className="bm-adv-field-hint">{config.topic_pool_size.min}-{config.topic_pool_size.max}</span>
                          </div>
                          <SettingSlider
                            description="Topics in the shared pool."
                            label="Topic pool size"
                            min={config.topic_pool_size.min}
                            max={config.topic_pool_size.max}
                            value={s.topic_pool_size}
                            onCommit={(v) => onPatchSettings({ topic_pool_size: v })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Game Mode */}
                <div className="bm-adv-accordion" data-open={openAccordions["mode"] ?? false}>
                  <div className="bm-adv-accordion-header" onClick={() => toggleAccordion("mode")}>
                    <span className="bm-adv-accordion-icon sage"><Gamepad2 /></span>
                    <span className="bm-adv-accordion-title">Game Mode</span>
                    <span className="bm-adv-accordion-count">{s.end_mode === "rounds" ? `${s.rounds_count} rnds` : `${s.timer_minutes} min`}</span>
                    <span className="bm-adv-accordion-chevron"><ChevronDown /></span>
                  </div>
                  <div className="bm-adv-accordion-body">
                    <div>
                      <div className="bm-adv-accordion-content">
                        {/* Reveal mode */}
                        <div className="bm-adv-field">
                          <div className="bm-adv-field-label">
                            <Eye /> Reveal mode
                          </div>
                          <div className="bm-adv-pill-group">
                            {config.reveal_modes.map((m) => (
                              <button key={m} type="button" className="bm-adv-pill" data-active={s.reveal_mode === m} onClick={() => onPatchSettings({ reveal_mode: m })}>
                                {formatPhase(`question_reveal_${m}`)}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* End mode */}
                        <div className="bm-adv-field">
                          <div className="bm-adv-field-label">
                            <Flag /> End mode
                          </div>
                          <div className="bm-adv-pill-group">
                            {config.end_modes.map((m) => (
                              <button key={m} type="button" className="bm-adv-pill" data-active={s.end_mode === m} onClick={() => onPatchSettings({ end_mode: m })}>
                                {m === "rounds" ? "Rounds" : "Timer"}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* Timer expiry */}
                        <div className="bm-adv-field">
                          <div className="bm-adv-field-label">
                            <Hourglass /> Timer expiry
                            <span className="bm-adv-field-hint">{s.end_mode !== "timer" ? "n/a" : ""}</span>
                          </div>
                          <div className="bm-adv-pill-group">
                            {config.timer_expiry_modes.map((m) => (
                              <button key={m} type="button" className="bm-adv-pill" data-active={s.timer_expiry_mode === m} disabled={s.end_mode !== "timer"} onClick={() => onPatchSettings({ timer_expiry_mode: m })}>
                                {m.replace(/_/g, " ")}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Timing */}
                <div className="bm-adv-accordion" data-open={openAccordions["timing"] ?? false}>
                  <div className="bm-adv-accordion-header" onClick={() => toggleAccordion("timing")}>
                    <span className="bm-adv-accordion-icon sky"><Clock /></span>
                    <span className="bm-adv-accordion-title">Timing</span>
                    <span className="bm-adv-accordion-count">{s.main_answer_seconds}s</span>
                    <span className="bm-adv-accordion-chevron"><ChevronDown /></span>
                  </div>
                  <div className="bm-adv-accordion-body">
                    <div>
                      <div className="bm-adv-accordion-content">
                        <div className="bm-adv-field">
                          <div className="bm-adv-field-label">
                            <Clock /> Answer time
                            <span className="bm-adv-field-hint">{config.main_answer_seconds.min}-{config.main_answer_seconds.max}s</span>
                          </div>
                          <SettingSlider
                            description="Seconds for main answer."
                            label="Answer time"
                            min={config.main_answer_seconds.min}
                            max={config.main_answer_seconds.max}
                            value={s.main_answer_seconds}
                            onCommit={(v) => onPatchSettings({ main_answer_seconds: v })}
                          />
                        </div>
                        <div className="bm-adv-field">
                          <div className="bm-adv-field-label">
                            <Hourglass /> No-buzz window
                            <span className="bm-adv-field-hint">{config.no_buzz_window_seconds.min}-{config.no_buzz_window_seconds.max}s</span>
                          </div>
                          <SettingSlider
                            description="Delay after full reveal."
                            label="No-buzz window"
                            min={config.no_buzz_window_seconds.min}
                            max={config.no_buzz_window_seconds.max}
                            value={s.no_buzz_window_seconds}
                            onCommit={(v) => onPatchSettings({ no_buzz_window_seconds: v })}
                          />
                        </div>
                        <div className="bm-adv-field">
                          <div className="bm-adv-field-label">
                            <Zap /> Bonus time
                            <span className="bm-adv-field-hint">{config.bonus_answer_seconds.min}-{config.bonus_answer_seconds.max}s</span>
                          </div>
                          <SettingSlider
                            description="Seconds per bonus question."
                            label="Bonus time"
                            min={config.bonus_answer_seconds.min}
                            max={config.bonus_answer_seconds.max}
                            value={s.bonus_answer_seconds}
                            onCommit={(v) => onPatchSettings({ bonus_answer_seconds: v })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Audio */}
                <div className="bm-adv-accordion" data-open={openAccordions["audio"] ?? false}>
                  <div className="bm-adv-accordion-header" onClick={() => toggleAccordion("audio")}>
                    <span className="bm-adv-accordion-icon rose"><Mic /></span>
                    <span className="bm-adv-accordion-title">Narration</span>
                    <span className="bm-adv-accordion-count">{s.audio.narration_enabled ? "On" : "Off"}</span>
                    <span className="bm-adv-accordion-chevron"><ChevronDown /></span>
                  </div>
                  <div className="bm-adv-accordion-body">
                    <div>
                      <div className="bm-adv-accordion-content">
                        <div className="bm-adv-field" style={{ marginTop: 14 }}>
                          <button
                            type="button"
                            className="bm-cfg-audio-pill"
                            data-active={s.audio.narration_enabled}
                            onClick={() => onPatchSettings({ narration_enabled: !s.audio.narration_enabled })}
                          >
                            <Mic />
                            <span className="bm-cfg-audio-label">Narration</span>
                            <span className="bm-cfg-audio-switch" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="bm-panel-footer">
            <button type="button" className="bm-panel-done" onClick={onClose}>
              <Check /> Done
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════
   Lobby Waiting Screen
   ══════════════════════════════════════════════════════ */

function LobbyScreen({
  room,
  config,
  session,
  busy,
  error,
  onRunAction,
  onPatchSettings,
}: {
  room: RoomStateResponse;
  config: PublicConfigResponse;
  session: PlayerSessionResponse;
  busy: string | null;
  error: string | null;
  onRunAction: (action: string, operation: () => Promise<RoomStateResponse>) => void;
  onPatchSettings: (patch: SettingsPatch) => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const me = room.players.find((p) => p.id === session.player_id);
  const isVip = me?.role === "vip_player";

  return (
    <div className="bm-mobile-frame">
      {/* Top bar */}
      <div className="bm-topbar">
        <div className="bm-topbar-left">
          <Sparkles />
          <span className="bm-topbar-logo">
            <span style={{ color: "var(--amber)" }}>Buzzer</span>
            <span style={{ color: "var(--sage)" }}>Minds</span>
          </span>
        </div>
        <span className="bm-topbar-code">{room.code}</span>
      </div>

      {/* Lobby body */}
      <div className="bm-lobby">
        {/* Waiting text */}
        <p className="bm-lobby-waiting" style={{ color: "var(--text-bright)" }}>
          Waiting for players
        </p>

        {/* Pulse rings with count */}
        <div className="bm-lobby-pulse">
          <div className="bm-lobby-pulse-ring" />
          <div className="bm-lobby-pulse-ring" />
          <div className="bm-lobby-count">
            <span className="bm-lobby-count-num">{room.active_player_count}</span>
            <span className="bm-lobby-count-label">
              {room.active_player_count === 1 ? "player" : "players"}
            </span>
          </div>
        </div>

        {/* Player cards */}
        <div className="bm-lobby-players">
          {room.players.map((player) => (
            <div key={player.id} className="bm-lobby-player">
              <span className="bm-lobby-player-dot" style={{ backgroundColor: player.color }} />
              <span className="bm-lobby-player-name" style={{ color: "var(--text-bright)" }}>
                {player.name}
              </span>
              {player.id === room.vip_player_id && (
                <span className="bm-lobby-badge bm-lobby-badge-vip">VIP</span>
              )}
              {!player.connected ? (
                <span className="bm-lobby-badge bm-lobby-badge-disconnected">DC</span>
              ) : player.ready ? (
                <span className="bm-lobby-badge bm-lobby-badge-ready">Ready</span>
              ) : (
                <span className="bm-lobby-badge bm-lobby-badge-waiting">Waiting</span>
              )}
              {/* VIP can kick non-self players */}
              {isVip && player.id !== session.player_id ? (
                <button
                  type="button"
                  className="bm-lobby-badge bm-lobby-badge-disconnected"
                  style={{ cursor: "pointer" }}
                  disabled={busy === `kick-${player.id}`}
                  onClick={() => onRunAction(`kick-${player.id}`, () => api.kickPlayer(room.code, session.player_id, session.player_token, currentClientId(), player.id))}
                >
                  {busy === `kick-${player.id}` ? "..." : "Kick"}
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {/* Blocker text */}
        {!room.can_start && room.start_blockers.length > 0 ? (
          <p className="bm-lobby-blocker">
            {room.start_blockers.join(" · ")}
          </p>
        ) : null}

        {error ? <p className="text-center text-sm font-semibold text-[var(--rose)]">{error}</p> : null}
      </div>

      {/* Bottom bar */}
      <div className="bm-lobby-bottom">
        {isVip ? (
          <div className="bm-lobby-bottom-btns">
            <button
              type="button"
              className="bm-lobby-btn-configure"
              onClick={() => setPanelOpen(true)}
            >
              <SlidersHorizontal /> Configure
            </button>
            <button
              type="button"
              className="bm-lobby-btn-start"
              disabled={!room.can_start || room.settings_locked || busy === "start"}
              onClick={() => onRunAction("start", () => api.startGame(room.code, session.player_id, session.player_token, currentClientId()))}
            >
              <Play /> {busy === "start" ? "Starting..." : "Start Match"}
            </button>
          </div>
        ) : null}
        {me && me.role !== "spectator" ? (
          <button
            type="button"
            className="bm-lobby-btn-ready"
            data-ready={me.ready}
            disabled={busy === "ready"}
            onClick={() => onRunAction("ready", () => api.setReady(room.code, session.player_id, session.player_token, currentClientId(), !me.ready))}
          >
            {me.ready ? <><Check /> Ready</> : <><ArrowRight /> Mark Ready</>}
          </button>
        ) : null}
      </div>

      {/* Slide-up Settings Panel (VIP only) */}
      {isVip ? (
        <SettingsPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          room={room}
          config={config}
          onPatchSettings={onPatchSettings}
        />
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   Player Room Scene (in-game logic)
   ══════════════════════════════════════════════════════ */

function PlayerRoomScene({ session, config, onSessionLost }: { session: PlayerSessionResponse; config: PublicConfigResponse; onSessionLost: () => void }) {
  const { room, connected, replaceRoom, buzzViaWs, onBuzzError } = useRoomLive();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [answerText, setAnswerText] = useState("");
  const [vipConfigured, setVipConfigured] = useState(false);

  // Register buzz error callback to surface server rejections
  useEffect(() => {
    onBuzzError((errMsg) => {
      setBusy(null);
      setError(errMsg);
    });
    return () => onBuzzError(null);
  }, [onBuzzError]);

  const me = room.players.find((p) => p.id === session.player_id) ?? null;
  const isVip = me?.role === "vip_player";
  const topicVoting = room.topic_voting;
  const myVote = topicVoting?.votes.find((v) => v.player_id === session.player_id) ?? null;

  // Stable shuffle of topic options so player/standard topics are mixed randomly.
  // Uses option IDs as seed so order stays consistent across re-renders but
  // changes on reroll (when the option list itself changes).
  const shuffledTopics = useMemo(() => {
    if (!topicVoting) return [];
    const items = [...topicVoting.options];
    // Simple seeded shuffle using a hash of all option IDs
    let seed = 0;
    for (const opt of items) {
      for (let i = 0; i < opt.id.length; i++) seed = (seed * 31 + opt.id.charCodeAt(i)) | 0;
    }
    // Fisher-Yates with seeded PRNG
    const rng = () => { seed = (seed * 1664525 + 1013904223) | 0; return (seed >>> 0) / 0xFFFFFFFF; };
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }, [topicVoting?.options]);
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

  /**
   * Buzz-in: prefer WebSocket (lowest latency) with HTTP fallback.
   * WebSocket buzz fires instantly and state arrives via broadcast.
   * HTTP buzz is used when the WebSocket isn't connected.
   */
  function doBuzz() {
    setBusy("buzz");
    setError(null);
    const cid = currentClientId();
    const sent = buzzViaWs(cid);
    if (sent) {
      // WebSocket buzz sent — state update arrives via broadcast.
      // Clear busy after a short timeout as a safety net (server broadcast
      // will trigger a re-render which naturally resets the UI).
      // If server sends buzz_error, the onBuzzError callback clears busy.
      setTimeout(() => setBusy((prev) => (prev === "buzz" ? null : prev)), 4000);
      return;
    }
    // Fallback to HTTP if WebSocket not connected
    runAction("buzz", () => api.buzzIn(room.code, session.player_id, session.player_token, cid));
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

  // ── Session lost ──
  if (!me) {
    return (
      <div className="bm-mobile-frame">
        <div className="bm-topbar">
          <div className="bm-topbar-left">
            <Sparkles />
            <span className="bm-topbar-logo">
              <span style={{ color: "var(--amber)" }}>Buzzer</span>
              <span style={{ color: "var(--sage)" }}>Minds</span>
            </span>
          </div>
          <span className="bm-topbar-code">{room.code}</span>
        </div>
        <div className="bm-lobby" style={{ justifyContent: "center" }}>
          <PhaseCard badge="Session Lost" title="No longer active" body="Rejoin the room from the same phone to get back in.">
            <button className="bm-btn-primary w-full py-3" onClick={onSessionLost} type="button">Rejoin Room</button>
          </PhaseCard>
        </div>
      </div>
    );
  }

  // ── Lobby phase ──
  if (room.phase === "lobby") {
    // VIP who hasn't configured yet: show configure screen
    if (isVip && !vipConfigured) {
      return (
        <VipConfigureScreen
          room={room}
          config={config}
          onPatchSettings={patchSettings}
          onDone={() => setVipConfigured(true)}
        />
      );
    }

    // VIP who has configured or non-VIP: show lobby waiting screen
    return (
      <LobbyScreen
        room={room}
        config={config}
        session={session}
        busy={busy}
        error={error}
        onRunAction={runAction}
        onPatchSettings={patchSettings}
      />
    );
  }

  // ── All other game phases (Full Bleed layout) ──
  // `me` is guaranteed non-null past the early return above; alias for TS narrowing inside closure
  const activeMe = me;

  const roundIndex = (room.progress?.round_index ?? 0) + 1;
  const topicLabel = room.progress?.current_topic_label ?? null;
  const accent = phaseBadgeAccent(room.phase);

  // Determine if we should show the buzz button during reveal
  const isRevealPhase = room.phase === "question_reveal_progressive" || room.phase === "question_reveal_full";
  const canBuzzDuringReveal = isRevealPhase && activeMe.can_buzz && activeMe.role !== "spectator" && room.buzz_state?.status === "waiting";

  function renderPhaseContent() {
    // ── Intro ──
    if (room.phase === "intro") {
      return (
        <div className="bm-pg-content">
          <div className="bm-pg-center-msg">
            <div className="bm-pg-center-msg-icon">
              <Monitor className="h-10 w-10 mx-auto" />
            </div>
            <h2 className="bm-pg-center-msg-title">Watch the Display!</h2>
            <p className="bm-pg-center-msg-body">
              The rules are being explained on the big screen. The game will begin shortly.
            </p>
            {isVip && (
              <button
                type="button"
                className="bm-intro-skip mt-4"
                disabled={busy === "skip-intro"}
                onClick={() =>
                  runAction("skip-intro", () =>
                    api.skipIntro(room.code, session.player_id, session.player_token, currentClientId())
                  )
                }
              >
                <SkipForward className="h-4 w-4" />
                {busy === "skip-intro" ? "Skipping..." : "Skip Intro"}
              </button>
            )}
          </div>
        </div>
      );
    }

    // ── Topic Voting ──
    if (room.phase === "topic_voting" && topicVoting) {
      const maxPicks = topicVoting.max_approvals_per_player;
      const pickCount = myVote ? myVote.topic_ids.length : selectedTopicIds.length;
      const isLocked = topicVoting.status === "locked";
      const hasVoted = Boolean(myVote);
      const tileDisabled = isLocked || hasVoted;

      return (
        <div className="bm-pg-content" style={{ justifyContent: "flex-start", paddingTop: 100 }}>
          <div className="bm-bingo">
            <div className="bm-bingo-header">
              <h2 className="bm-bingo-title">
                {isLocked ? "Pool Locked" : "Pick Topics"}
              </h2>
              <p className="bm-bingo-sub">
                {isLocked ? "Preparing the first question" : `Tap up to ${maxPicks} topics you want to play`}
              </p>
              {!isLocked && (
                <span className="bm-bingo-counter" data-full={pickCount >= maxPicks}>
                  {pickCount} / {maxPicks} picked
                </span>
              )}
            </div>

            <div className="bm-bingo-grid">
              {shuffledTopics.map((topic) => {
                const selected = selectedTopicIds.includes(topic.id) || (myVote?.topic_ids.includes(topic.id) ?? false);
                return (
                  <button
                    key={topic.id}
                    className="bm-bingo-tile"
                    data-selected={selected}
                    data-disabled={tileDisabled}
                    disabled={tileDisabled}
                    onClick={() => toggleTopic(topic.id)}
                    type="button"
                  >
                    <div className="bm-bingo-tile-top">
                      <span className="bm-bingo-tile-label">{topic.label}</span>
                      <div className="bm-bingo-check-dot">
                        {selected && <Check strokeWidth={3} />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="bm-bingo-footer">
              {isLocked ? (
                <div className="bm-bingo-msg" data-variant="success">
                  <Loader2 className="inline-block h-4 w-4 animate-spin mr-2 align-middle" />
                  Pool locked — preparing the first question.
                </div>
              ) : hasVoted ? (
                <div className="bm-bingo-msg">
                  Vote locked. Waiting on: {topicVoting.players_pending.join(", ") || "nobody"}
                </div>
              ) : (
                <>
                  <button
                    className="bm-btn-primary w-full py-3"
                    disabled={selectedTopicIds.length === 0 || busy === "topic-vote"}
                    onClick={() => runAction("topic-vote", () => api.submitTopicVotes(room.code, session.player_id, session.player_token, currentClientId(), selectedTopicIds))}
                    type="button"
                  >
                    {busy === "topic-vote" ? "Submitting..." : `Submit ${selectedTopicIds.length} Pick${selectedTopicIds.length !== 1 ? "s" : ""}`}
                  </button>
                  {isVip && (
                    <div className="bm-bingo-vip-row">
                      <button
                        className="bm-btn-outline flex-1 py-2.5 text-sm"
                        disabled={topicVoting.rerolls_remaining <= 0 || topicVoting.votes.length > 0 || busy === "reroll-topics"}
                        onClick={() => runAction("reroll-topics", () => api.rerollTopics(room.code, session.player_id, session.player_token, currentClientId()))}
                        type="button"
                      >
                        {busy === "reroll-topics" ? "Refreshing..." : `Reroll (${topicVoting.rerolls_remaining})`}
                      </button>
                      <button
                        className="bm-btn-primary flex-1 py-2.5 text-sm"
                        disabled={busy === "lock-topics"}
                        onClick={() => runAction("lock-topics", () => api.lockTopicVoting(room.code, session.player_id, session.player_token, currentClientId()))}
                        type="button"
                      >
                        {busy === "lock-topics" ? "Locking..." : "Lock Pool"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      );
    }

    // ── Question Loading ──
    if (room.phase === "question_loading") {
      return (
        <div className="bm-pg-content">
          <div className="bm-pg-center-msg">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--amber)] mx-auto mb-3" />
            <h2 className="bm-pg-center-msg-title">Question incoming</h2>
            <p className="bm-pg-center-msg-body">Topic: {room.progress?.current_topic_label ?? "Unknown"}</p>
          </div>
        </div>
      );
    }

    // ── Question Reveal (with buzz-during-reveal) ──
    if (isRevealPhase && room.current_question) {
      const chunks = room.current_question.question.prompt_chunks;
      const revealIndex = room.current_question.question.reveal_index;
      const isProgressive = room.phase === "question_reveal_progressive";

      return (
        <div className="bm-pg-content">
          <div className="bm-pg-reveal">
            <div className="bm-pg-reveal-text">
              {isProgressive ? (
                <>
                  {chunks.slice(0, revealIndex).map((chunk, i) => (
                    <span key={i} className="bm-pg-chunk">{chunk} </span>
                  ))}
                  {revealIndex < chunks.length && <span className="bm-pg-reveal-cursor" />}
                </>
              ) : (
                <span>{chunks.join(" ")}</span>
              )}
            </div>
            {activeMe.role !== "spectator" && (
              <button
                className={`bm-pg-reveal-buzz-btn ${!canBuzzDuringReveal ? "" : ""}`}
                disabled={!canBuzzDuringReveal || busy === "buzz"}
                onClick={() => doBuzz()}
                type="button"
              >
                {busy === "buzz" ? "BUZZING..." : canBuzzDuringReveal ? "BUZZ IN" : "LOCKED OUT"}
              </button>
            )}
          </div>
        </div>
      );
    }

    // ── Buzz Open (full-bleed hero) ──
    if (room.phase === "buzz_open") {
      return (
        <div className="bm-pg-content bm-pg-content--full">
          <PGTimer
            deadline={room.buzz_state?.deadline_at ?? null}
            totalSeconds={room.settings.no_buzz_window_seconds}
            label="Buzz"
          />
          <div className="bm-pg-buzz-hero">
            <h2 className="bm-pg-buzz-title">Hit the buzzer!</h2>
            <p className="bm-pg-buzz-sub">
              {room.buzz_state?.status === "locked"
                ? `${room.players.find(p => p.id === room.buzz_state?.winner_player_id)?.name ?? "Someone"} buzzed in!`
                : `Window closes in ${formatCountdown(room.buzz_state?.deadline_at ?? null)}.`}
            </p>
            {activeMe.role === "spectator" ? (
              <p className="bm-pg-buzz-sub">Spectators watch this round.</p>
            ) : (
              <button
                className={`bm-pg-buzz-btn ${!activeMe.can_buzz ? "bm-pg-buzz-btn--locked" : ""}`}
                disabled={!activeMe.can_buzz || busy === "buzz" || room.buzz_state?.status === "locked"}
                onClick={() => doBuzz()}
                type="button"
              >
                {busy === "buzz" ? "BUZZING..." : room.buzz_state?.status === "locked" ? "LOCKED" : activeMe.can_buzz ? "BUZZ IN" : "LOCKED OUT"}
              </button>
            )}
          </div>
        </div>
      );
    }

    // ── Answering (active: you are the answerer) ──
    if ((room.phase === "answering" || room.phase === "bonus_answering") && (activeMe.is_answering || activeMe.bonus_active || room.current_question?.answering_player_id === activeMe.id || room.bonus_chain?.awarded_player_id === activeMe.id)) {
      const isBonus = room.phase === "bonus_answering";
      const bc = room.bonus_chain;
      const prompt = isBonus ? bc?.questions[bc.current_index]?.prompt : room.current_question?.question.prompt;
      const deadline = isBonus ? bc?.answer_deadline_at : room.current_question?.answering_deadline_at;
      const totalSecs = isBonus ? room.settings.bonus_answer_seconds : room.settings.main_answer_seconds;
      const prevBonusQ = isBonus && bc && bc.current_index > 0 ? bc.questions[bc.current_index - 1] : null;

      return (
        <div className="bm-pg-content">
          <PGTimer
            deadline={deadline ?? null}
            totalSeconds={totalSecs}
            label={isBonus ? "Bonus" : "Answer"}
          />
          <div className="bm-pg-answer">
            {prevBonusQ && prevBonusQ.result !== "unanswered" && (
              <p className={`text-xs font-semibold mb-2 ${prevBonusQ.result === "correct" ? "text-[var(--sage)]" : "text-[var(--rose)]"}`}>
                {prevBonusQ.result === "correct" ? "Previous bonus: Correct! +5" : `Previous bonus: ${prevBonusQ.grading_reason ?? "Incorrect"}`}
              </p>
            )}
            {isBonus && bc && (
              <div className="bm-pg-bonus-dots">
                {Array.from({ length: bc.total_questions }).map((_, i) => {
                  const q = bc.questions[i];
                  const color = i < bc.current_index
                    ? q?.result === "correct" ? "var(--sage)" : "var(--rose)"
                    : i === bc.current_index ? "var(--sky)" : "rgba(255,255,255,0.15)";
                  return <div key={i} className="bm-pg-bonus-dot" style={{ background: color }} />;
                })}
              </div>
            )}
            <p className="bm-pg-answer-prompt">{prompt}</p>
            <textarea
              className="bm-pg-answer-textarea"
              maxLength={160}
              onChange={(e) => setAnswerText(e.target.value)}
              placeholder="Type your answer..."
              value={answerText}
            />
            <div className="bm-pg-answer-meta">
              <span className="bm-pg-answer-charcount">{answerText.length}/160</span>
            </div>
            <button
              className="bm-pg-answer-submit"
              disabled={!answerText.trim() || busy === "answer"}
              onClick={() => runAction("answer", async () => { const nr = await api.submitAnswer(room.code, session.player_id, session.player_token, currentClientId(), answerText.trim()); setAnswerText(""); return nr; })}
              type="button"
            >
              {busy === "answer" ? "Submitting..." : "Submit Answer"}
            </button>
          </div>
        </div>
      );
    }

    // ── Answering (spectating: someone else is answering) ──
    if (room.phase === "answering" || room.phase === "bonus_answering") {
      const isBonus = room.phase === "bonus_answering";
      const answerer = isBonus
        ? room.players.find((p) => p.id === room.bonus_chain?.awarded_player_id)
        : room.players.find((p) => p.id === room.current_question?.answering_player_id);
      const deadline = isBonus
        ? room.bonus_chain?.answer_deadline_at
        : room.current_question?.answering_deadline_at;
      const totalSecs = isBonus ? room.settings.bonus_answer_seconds : room.settings.main_answer_seconds;

      return (
        <div className="bm-pg-content">
          <PGTimer
            deadline={deadline ?? null}
            totalSeconds={totalSecs}
            label={isBonus ? "Bonus" : "Answer"}
          />
          <div className="bm-pg-spectate">
            <h2 className="bm-pg-spectate-title">
              {answerer?.name ?? "Another player"} is answering
            </h2>
            <p className="bm-pg-spectate-body">
              {room.current_question?.question.prompt ?? "Watch the display and wait for the result."}
            </p>
          </div>
        </div>
      );
    }

    // ── Grading: Adjudication ──
    if (room.phase === "grading" && room.adjudication?.status !== "idle") {
      const adj = room.adjudication;
      if (!adj) return null;
      const canVote = adj.eligible_voter_ids.includes(activeMe.id) || (isVip && adj.status === "vip_deciding");
      return (
        <div className="bm-pg-content">
          <div className="bm-pg-grading">
            <h2 className="bm-pg-grading-title">Manual decision needed</h2>
            <p className="bm-pg-grading-body">{adj.prompt ?? room.current_question?.grading_reason ?? "Automatic grading failed."}</p>
            {canVote ? (
              <div className="bm-pg-adj-buttons">
                <button
                  className="bm-pg-adj-btn bm-pg-adj-btn--accept"
                  disabled={busy === "adjudicate-accept"}
                  onClick={() => runAction("adjudicate-accept", () => api.adjudicate(room.code, session.player_id, session.player_token, currentClientId(), "accept"))}
                  type="button"
                >
                  <CheckCircle className="h-5 w-5" /> Accept
                </button>
                <button
                  className="bm-pg-adj-btn bm-pg-adj-btn--reject"
                  disabled={busy === "adjudicate-reject"}
                  onClick={() => runAction("adjudicate-reject", () => api.adjudicate(room.code, session.player_id, session.player_token, currentClientId(), "reject"))}
                  type="button"
                >
                  <XCircle className="h-5 w-5" /> Reject
                </button>
              </div>
            ) : <p className="bm-pg-spectate-body">Only eligible voters can decide.</p>}
          </div>
        </div>
      );
    }

    // ── Grading: Auto ──
    if (room.phase === "grading") {
      return (
        <div className="bm-pg-content">
          <div className="bm-pg-center-msg">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--amber)] mx-auto mb-3" />
            <h2 className="bm-pg-center-msg-title">Checking the answer</h2>
            <p className="bm-pg-center-msg-body">{room.current_question?.submitted_answer ?? "Hold on..."}</p>
          </div>
        </div>
      );
    }

    // ── Bonus Loading ──
    if (room.phase === "bonus_loading") {
      return (
        <div className="bm-pg-content">
          <div className="bm-pg-center-msg">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--sage)] mx-auto mb-3" />
            <h2 className="bm-pg-center-msg-title">Bonus chain incoming</h2>
            <p className="bm-pg-center-msg-body">Three solo bonus questions.</p>
          </div>
        </div>
      );
    }

    // ── Score Reveal (full-bleed hero) ──
    if (room.phase === "score_reveal") {
      const resolved = room.score_reveal?.resolved_question;
      return (
        <div className="bm-pg-content bm-pg-content--full" style={{ background: "linear-gradient(180deg, transparent 0%, rgba(245,158,11,0.03) 100%)" }}>
          <div className="bm-pg-score-hero">
            {myStanding && <span className="bm-pg-score-rank">#{myStanding.rank}</span>}
            <h2 className="bm-pg-score-headline">{room.score_reveal?.headline ?? "Standings updated"}</h2>
            <p className="bm-pg-score-points">
              {myStanding ? `${myStanding.score} points` : "Stand by for the next round."}
            </p>
            {resolved && (
              <div className="bm-pg-score-answer">
                <div className="bm-pg-score-answer-label">Answer: {resolved.correct_answer}</div>
                <div className="bm-pg-score-answer-detail">
                  {resolved.fact_card?.detail ?? resolved.grading_reason ?? "No grading note."}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    // ── Paused ──
    if (room.phase === "paused_waiting_for_vip") {
      return (
        <div className="bm-pg-content">
          <div className="bm-pg-center-msg">
            <Hourglass className="h-8 w-8 text-[var(--text-dim)] mx-auto mb-3" />
            <h2 className="bm-pg-center-msg-title">Waiting for VIP</h2>
            <p className="bm-pg-center-msg-body">
              {room.pause_state?.reason ?? "Match paused."}{" "}
              {room.pause_state ? `Timeout ${formatCountdown(room.pause_state.deadline_at)}.` : ""}
            </p>
          </div>
        </div>
      );
    }

    // ── Finished ──
    if (room.phase === "finished") {
      return (
        <div className="bm-pg-content">
          <div className="bm-pg-finished">
            {myStanding && <span className="bm-pg-finished-rank">#{myStanding.rank}</span>}
            <h2 className="bm-pg-finished-title">Match complete</h2>
            <p className="bm-pg-finished-body">
              {myStanding ? `Final rank #${myStanding.rank} with ${myStanding.score} points.` : "Thanks for playing."}
            </p>
            <div className="bm-pg-finished-actions">
              {room.finished?.summary_id ? (
                <Button asChild className="rounded-xl" variant="outline"><Link href={`/summary/${room.finished.summary_id}`}>View Summary</Link></Button>
              ) : null}
              {isVip ? (
                <button className="bm-pg-answer-submit" disabled={busy === "reset"} onClick={() => runAction("reset", () => api.resetRoom(room.code, session.player_id, session.player_token, currentClientId()))} type="button">
                  {busy === "reset" ? "Resetting..." : "Reset Room"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      );
    }

    // ── Fallback ──
    return (
      <div className="bm-pg-content">
        <div className="bm-pg-center-msg">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--text-dim)] mx-auto mb-3" />
          <h2 className="bm-pg-center-msg-title">Stand by...</h2>
          <p className="bm-pg-center-msg-body">Waiting for the next phase.</p>
        </div>
      </div>
    );
  }

  // Show round/topic info strip for in-game phases
  const showInfoStrip = !["intro", "topic_voting", "finished", "paused_waiting_for_vip"].includes(room.phase);

  return (
    <main className="bm-pg-wrap">
      {/* Overlay top bar */}
      <div className="bm-pg-topbar">
        <div className="bm-pg-topbar-inner">
          <div className="bm-pg-topbar-brand">
            <div className="bm-pg-topbar-icon">
              <Sparkles />
            </div>
            <span className="bm-pg-topbar-wordmark">BuzzerMinds</span>
          </div>
          <span className="bm-pg-phase-badge" data-accent={accent}>
            {formatPhase(room.phase)}
          </span>
        </div>
      </div>

      {/* Round/Topic info strip */}
      {showInfoStrip && (
        <div className="bm-pg-info-strip">
          <span className="bm-pg-info-strip-tag">R{roundIndex}</span>
          {topicLabel && (
            <>
              <span style={{ color: "var(--text-dim)", opacity: 0.4 }}>/</span>
              <span>{topicLabel}</span>
            </>
          )}
        </div>
      )}

      {/* Phase content */}
      {renderPhaseContent()}

      {/* Bottom identity pill */}
      <div className="bm-pg-pill">
        <span className="bm-pg-pill-swatch" style={{ backgroundColor: activeMe.color }} />
        <span className="bm-pg-pill-name">{activeMe.name}</span>
        <span className="bm-pg-pill-score">{activeMe.score} pts</span>
      </div>

      {/* Floating error toast */}
      {error && <div className="bm-pg-error">{error}</div>}
    </main>
  );
}

/* ══════════════════════════════════════════════════════
   Root Export
   ══════════════════════════════════════════════════════ */

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
    <>
      <WireframeBackground />
      <TurnstileProvider config={config}>
        <RoomLiveProvider initialRoom={room} query={{ client_type: "player", player_id: session.player_id, player_token: session.player_token, client_id: currentClientId() }} roomCode={roomCode}>
          <PlayerRoomScene config={config} onSessionLost={resetSession} session={session} />
        </RoomLiveProvider>
      </TurnstileProvider>
    </>
  );
}
