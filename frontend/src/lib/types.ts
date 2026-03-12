export type RevealMode = "progressive" | "full";
export type EndMode = "rounds" | "timer";
export type TimerExpiryMode = "finish_round" | "finish_main_only" | "stop_immediately";
export type PlayerRole = "vip_player" | "player" | "spectator";
export type RoomPhase =
  | "lobby"
  | "intro"
  | "topic_voting"
  | "question_loading"
  | "question_reveal_progressive"
  | "question_reveal_full"
  | "buzz_open"
  | "answering"
  | "grading"
  | "bonus_loading"
  | "bonus_answering"
  | "score_reveal"
  | "finished"
  | "paused_waiting_for_vip";
export type TopicSource = "player" | "standard";
export type TopicVotingStatus = "collecting_votes" | "locked";
export type BuzzStatus = "waiting" | "locked" | "expired";
export type QuestionResult = "unanswered" | "correct" | "incorrect" | "adjudicated";
export type GradingStatus = "pending" | "complete" | "fallback_to_adjudication";
export type AdjudicationStatus = "idle" | "vip_deciding" | "player_vote" | "resolved";
export type NarrationStatus = "idle" | "pending" | "ready" | "failed" | "disabled";
export type EndReason = "rounds_completed" | "timer_expired" | "vip_disconnected_timeout" | "manual_reset";

export interface IntRangeResponse {
  min: number;
  max: number;
  default: number;
}

export interface PublicModelPreset {
  id: string;
  label: string;
  description: string;
  content_model: string;
  grading_model: string;
  experimental: boolean;
}

export interface AudioSettings {
  narration_enabled: boolean;
  sound_effects_enabled: boolean;
  music_enabled: boolean;
}

export interface RoomSettingsState {
  model_preset_id: string;
  content_model_id: string;
  grading_model_id: string;
  topic_pool_size: number;
  reveal_mode: RevealMode;
  end_mode: EndMode;
  rounds_count: number;
  timer_minutes: number;
  timer_expiry_mode: TimerExpiryMode;
  main_answer_seconds: number;
  no_buzz_window_seconds: number;
  bonus_answer_seconds: number;
  moderation_mode: "off" | "light" | "family_safe";
  audio: AudioSettings;
}

export interface TopicOptionState {
  id: string;
  label: string;
  source: TopicSource;
  approval_count: number;
}

export interface TopicVoteState {
  player_id: string;
  topic_ids: string[];
  submitted_at: string;
}

export interface TopicTieBreakState {
  candidate_topic_ids: string[];
  chosen_topic_ids: string[];
  approval_count: number;
}

export interface TopicVotingState {
  status: TopicVotingStatus;
  rerolls_remaining: number;
  max_approvals_per_player: number;
  options: TopicOptionState[];
  votes: TopicVoteState[];
  players_pending: string[];
  selected_topic_ids: string[];
  selected_topics: TopicOptionState[];
  tie_break: TopicTieBreakState | null;
}

export interface PublicConfigResponse {
  app_name: string;
  hard_max_players: number;
  room_code_length: number;
  turnstile_enabled: boolean;
  turnstile_site_key: string | null;
  model_presets: PublicModelPreset[];
  default_settings: RoomSettingsState;
  topic_pool_size: IntRangeResponse;
  rounds_count: IntRangeResponse;
  timer_minutes: IntRangeResponse;
  main_answer_seconds: IntRangeResponse;
  no_buzz_window_seconds: IntRangeResponse;
  bonus_answer_seconds: IntRangeResponse;
  reveal_modes: RevealMode[];
  end_modes: EndMode[];
  timer_expiry_modes: TimerExpiryMode[];
  audio_default_states: AudioSettings;
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  expertise: string;
  role: PlayerRole;
  ready: boolean;
  connected: boolean;
  joined_at: string;
  score: number;
  can_buzz: boolean;
  has_buzzed: boolean;
  is_answering: boolean;
  bonus_active: boolean;
}

export interface GameConfigSnapshotState {
  model_preset_id: string;
  content_model_id: string;
  grading_model_id: string;
  settings: RoomSettingsState;
}

export interface TopicDeckState {
  selected_topic_ids: string[];
  upcoming_topic_ids: string[];
  used_topic_ids: string[];
  skipped_topic_ids: string[];
  failure_counts: Record<string, number>;
  reshuffle_count: number;
}

export interface GameClockState {
  started_at: string;
  deadline_at: string | null;
  expired: boolean;
}

export interface GameProgressState {
  round_index: number;
  completed_rounds: number;
  main_questions_completed: number;
  current_topic_id: string | null;
  current_topic_label: string | null;
  topic_deck: TopicDeckState | null;
  game_clock: GameClockState | null;
}

export interface FactCardState {
  headline: string;
  detail: string;
  citations: string[];
}

export interface QuestionPromptState {
  id: string;
  topic_id: string;
  topic_label: string;
  prompt: string;
  prompt_chunks: string[];
  fact_card: FactCardState;
  reveal_index: number;
  interruption_index: number | null;
  source_attempt: number;
}

export interface MainQuestionState {
  question: QuestionPromptState;
  status: "loading" | "ready" | "active" | "resolved";
  asked_at: string | null;
  reveal_started_at: string | null;
  reveal_completed_at: string | null;
  buzz_opened_at: string | null;
  buzz_deadline_at: string | null;
  answering_player_id: string | null;
  answering_deadline_at: string | null;
  submitted_answer: string | null;
  result: QuestionResult;
  grading_status: GradingStatus;
  grading_reason: string | null;
  retry_count: number;
  no_buzz_reason: string | null;
}

export interface BuzzStateResponse {
  status: BuzzStatus;
  opened_at: string | null;
  deadline_at: string | null;
  winner_player_id: string | null;
  winner_locked_at: string | null;
  eligible_player_ids: string[];
  locked_out_player_ids: string[];
  buzz_order: string[];
}

export interface AdjudicationVoteState {
  player_id: string;
  decision: "accept" | "reject";
  submitted_at: string;
}

export interface AdjudicationState {
  status: AdjudicationStatus;
  mode: "none" | "vip_binary" | "player_majority";
  subject_player_id: string | null;
  prompt: string | null;
  eligible_voter_ids: string[];
  votes: AdjudicationVoteState[];
  resolved_decision: "accept" | "reject" | null;
  reason: string | null;
}

export interface BonusQuestionState {
  id: string;
  prompt: string;
  grading_reason: string | null;
  submitted_answer: string | null;
  result: QuestionResult;
}

export interface ResolvedQuestionState {
  topic_label: string;
  prompt: string;
  submitted_answer: string | null;
  correct_answer: string;
  grading_reason: string | null;
  fact_card: FactCardState;
  result: QuestionResult;
  answering_player_id: string | null;
}

export interface BonusChainState {
  awarded_player_id: string;
  source_question_id: string;
  current_index: number;
  total_questions: number;
  questions: BonusQuestionState[];
  answer_deadline_at: string | null;
  completed: boolean;
}

export interface ScoreEventState {
  player_id: string;
  delta: number;
  reason: string;
}

export interface StandingsEntryState {
  player_id: string;
  score: number;
  rank: number;
}

export interface ScoreRevealState {
  headline: string;
  events: ScoreEventState[];
  standings: StandingsEntryState[];
  resolved_question: ResolvedQuestionState | null;
  next_topic_label: string | null;
  next_round_index: number | null;
}

export interface PauseState {
  reason: string;
  started_at: string;
  deadline_at: string;
}

export interface NarrationCueState {
  status: NarrationStatus;
  text: string;
  voice_id: string | null;
  model_id: string | null;
  audio_base64: string | null;
  mime_type: string | null;
  duration_ms: number | null;
  chunk_durations_ms: number[];
  error: string | null;
}

export interface FinishedState {
  reason: EndReason;
  winners: string[];
  standings: StandingsEntryState[];
  finished_at: string;
  summary_id: string | null;
}

export interface RoomStateResponse {
  code: string;
  phase: RoomPhase;
  created_at: string;
  updated_at: string;
  display_connected: boolean;
  settings_locked: boolean;
  vip_player_id: string | null;
  players: PlayerState[];
  settings: RoomSettingsState;
  active_player_count: number;
  spectator_count: number;
  can_start: boolean;
  start_blockers: string[];
  topic_voting: TopicVotingState | null;
  game_config_snapshot: GameConfigSnapshotState | null;
  progress: GameProgressState | null;
  current_question: MainQuestionState | null;
  buzz_state: BuzzStateResponse | null;
  adjudication: AdjudicationState | null;
  bonus_chain: BonusChainState | null;
  score_reveal: ScoreRevealState | null;
  pause_state: PauseState | null;
  narration: NarrationCueState | null;
  finished: FinishedState | null;
  intro_deadline_at: string | null;
}

export interface CreateRoomResponse {
  room: RoomStateResponse;
  display_session: {
    room_code: string;
    display_token: string;
  };
}

export interface PlayerSessionResponse {
  player_id: string;
  player_token: string;
  role: PlayerRole;
  room_code: string;
}

export interface JoinRoomResponse {
  room: RoomStateResponse;
  player_session: PlayerSessionResponse;
}

export interface SettingsPatch {
  model_preset_id?: string;
  topic_pool_size?: number;
  reveal_mode?: RevealMode;
  end_mode?: EndMode;
  rounds_count?: number;
  timer_minutes?: number;
  timer_expiry_mode?: TimerExpiryMode;
  main_answer_seconds?: number;
  no_buzz_window_seconds?: number;
  bonus_answer_seconds?: number;
  moderation_mode?: "off" | "light" | "family_safe";
  narration_enabled?: boolean;
  sound_effects_enabled?: boolean;
  music_enabled?: boolean;
}

export interface SummaryPlayerState {
  player_id: string;
  name: string;
  color: string;
  score: number;
  rank: number;
}

export interface SummaryBonusQuestionState {
  prompt: string;
  submitted_answer: string | null;
  correct_answer: string;
  grading_reason: string | null;
  result: QuestionResult;
}

export interface SummaryQuestionState {
  question_id: string;
  topic_label: string;
  prompt: string;
  submitted_answer: string | null;
  correct_answer: string;
  grading_reason: string | null;
  fact_card: FactCardState;
  result: QuestionResult;
  answering_player_id: string | null;
  score_events: ScoreEventState[];
  bonus_awarded_player_id: string | null;
  bonus_questions: SummaryBonusQuestionState[];
}

export interface GameSummaryResponse {
  summary_id: string;
  room_code: string;
  created_at: string;
  finished_at: string;
  reason: EndReason;
  winners: string[];
  selected_topics: string[];
  players: SummaryPlayerState[];
  questions: SummaryQuestionState[];
}

export interface RoomEnvelope {
  type: "room_state";
  payload: RoomStateResponse;
}
