from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


RoomPhase = Literal[
    "lobby",
    "intro",
    "topic_voting",
    "question_loading",
    "question_reveal_progressive",
    "question_reveal_full",
    "buzz_open",
    "answering",
    "grading",
    "bonus_loading",
    "bonus_answering",
    "score_reveal",
    "finished",
    "paused_waiting_for_vip",
]
PlayerRole = Literal["vip_player", "player", "spectator"]
RevealMode = Literal["progressive", "full"]
EndMode = Literal["rounds", "timer"]
TimerExpiryMode = Literal["finish_round", "finish_main_only", "stop_immediately"]
TopicSource = Literal["player", "standard"]
TopicVotingStatus = Literal["collecting_votes", "locked"]
BuzzState = Literal["waiting", "locked", "expired"]
QuestionResult = Literal["unanswered", "correct", "incorrect", "adjudicated"]
GradingStatus = Literal["pending", "complete", "fallback_to_adjudication"]
AdjudicationStatus = Literal["idle", "vip_deciding", "player_vote", "resolved"]
NarrationStatus = Literal["idle", "pending", "ready", "failed", "disabled"]
EndReason = Literal[
    "rounds_completed",
    "timer_expired",
    "vip_disconnected_timeout",
    "manual_reset",
]


class IntRangeResponse(BaseModel):
    min: int
    max: int
    default: int


class PublicModelPreset(BaseModel):
    id: str
    label: str
    description: str
    content_model: str
    grading_model: str
    experimental: bool = False


class AudioSettings(BaseModel):
    narration_enabled: bool
    sound_effects_enabled: bool
    music_enabled: bool


class RoomSettingsState(BaseModel):
    model_preset_id: str
    content_model_id: str
    grading_model_id: str
    topic_pool_size: int
    reveal_mode: RevealMode
    end_mode: EndMode
    rounds_count: int
    timer_minutes: int
    timer_expiry_mode: TimerExpiryMode
    main_answer_seconds: int
    no_buzz_window_seconds: int
    bonus_answer_seconds: int
    moderation_mode: Literal["off", "light", "family_safe"]
    audio: AudioSettings


class TopicOptionState(BaseModel):
    id: str
    label: str
    source: TopicSource
    approval_count: int


class TopicVoteState(BaseModel):
    player_id: str
    topic_ids: list[str]
    submitted_at: datetime


class TopicTieBreakState(BaseModel):
    candidate_topic_ids: list[str]
    chosen_topic_ids: list[str]
    approval_count: int


class TopicVotingState(BaseModel):
    status: TopicVotingStatus
    rerolls_remaining: int
    max_approvals_per_player: int
    options: list[TopicOptionState]
    votes: list[TopicVoteState]
    players_pending: list[str]
    selected_topic_ids: list[str]
    selected_topics: list[TopicOptionState]
    tie_break: TopicTieBreakState | None = None


class PublicConfigResponse(BaseModel):
    app_name: str
    hard_max_players: int
    room_code_length: int
    turnstile_enabled: bool
    turnstile_site_key: str | None = None
    model_presets: list[PublicModelPreset]
    default_settings: RoomSettingsState
    topic_pool_size: IntRangeResponse
    rounds_count: IntRangeResponse
    timer_minutes: IntRangeResponse
    main_answer_seconds: IntRangeResponse
    no_buzz_window_seconds: IntRangeResponse
    bonus_answer_seconds: IntRangeResponse
    reveal_modes: list[RevealMode]
    end_modes: list[EndMode]
    timer_expiry_modes: list[TimerExpiryMode]
    audio_default_states: AudioSettings


class PlayerState(BaseModel):
    id: str
    name: str
    color: str
    expertise: str
    role: PlayerRole
    ready: bool
    connected: bool
    joined_at: datetime
    score: int = 0
    can_buzz: bool = False
    has_buzzed: bool = False
    is_answering: bool = False
    bonus_active: bool = False


class GameConfigSnapshotState(BaseModel):
    model_preset_id: str
    content_model_id: str
    grading_model_id: str
    settings: RoomSettingsState


class TopicDeckState(BaseModel):
    selected_topic_ids: list[str]
    upcoming_topic_ids: list[str]
    used_topic_ids: list[str]
    skipped_topic_ids: list[str]
    failure_counts: dict[str, int]
    reshuffle_count: int = 0


class NarrationCueState(BaseModel):
    status: NarrationStatus
    text: str
    voice_id: str | None = None
    model_id: str | None = None
    audio_base64: str | None = None
    mime_type: str | None = None
    duration_ms: int | None = None
    chunk_durations_ms: list[int] = []
    error: str | None = None


class FactCardState(BaseModel):
    headline: str
    detail: str
    citations: list[str] = []


class QuestionPromptState(BaseModel):
    id: str
    topic_id: str
    topic_label: str
    prompt: str
    prompt_chunks: list[str]
    fact_card: FactCardState
    reveal_index: int = 0
    interruption_index: int | None = None
    source_attempt: int = 1


class MainQuestionState(BaseModel):
    question: QuestionPromptState
    status: Literal["loading", "ready", "active", "resolved"]
    asked_at: datetime | None = None
    reveal_started_at: datetime | None = None
    reveal_completed_at: datetime | None = None
    buzz_opened_at: datetime | None = None
    buzz_deadline_at: datetime | None = None
    answering_player_id: str | None = None
    answering_deadline_at: datetime | None = None
    submitted_answer: str | None = None
    result: QuestionResult = "unanswered"
    grading_status: GradingStatus = "pending"
    grading_reason: str | None = None
    retry_count: int = 0
    no_buzz_reason: str | None = None


class BuzzStateResponse(BaseModel):
    status: BuzzState
    opened_at: datetime | None = None
    deadline_at: datetime | None = None
    winner_player_id: str | None = None
    winner_locked_at: datetime | None = None
    eligible_player_ids: list[str]
    locked_out_player_ids: list[str]
    buzz_order: list[str]


class AdjudicationVoteState(BaseModel):
    player_id: str
    decision: Literal["accept", "reject"]
    submitted_at: datetime


class AdjudicationState(BaseModel):
    status: AdjudicationStatus
    mode: Literal["none", "vip_binary", "player_majority"]
    subject_player_id: str | None = None
    prompt: str | None = None
    eligible_voter_ids: list[str] = []
    votes: list[AdjudicationVoteState] = []
    resolved_decision: Literal["accept", "reject"] | None = None
    reason: str | None = None


class BonusQuestionState(BaseModel):
    id: str
    prompt: str
    grading_reason: str | None = None
    submitted_answer: str | None = None
    result: QuestionResult = "unanswered"


class ResolvedQuestionState(BaseModel):
    topic_label: str
    prompt: str
    submitted_answer: str | None = None
    correct_answer: str
    grading_reason: str | None = None
    fact_card: FactCardState
    result: QuestionResult
    answering_player_id: str | None = None


class BonusChainState(BaseModel):
    awarded_player_id: str
    source_question_id: str
    current_index: int
    total_questions: int
    questions: list[BonusQuestionState]
    answer_deadline_at: datetime | None = None
    completed: bool = False


class ScoreEventState(BaseModel):
    player_id: str
    delta: int
    reason: str


class StandingsEntryState(BaseModel):
    player_id: str
    score: int
    rank: int


class ScoreRevealState(BaseModel):
    headline: str
    events: list[ScoreEventState]
    standings: list[StandingsEntryState]
    resolved_question: ResolvedQuestionState | None = None
    next_topic_label: str | None = None
    next_round_index: int | None = None


class PauseState(BaseModel):
    reason: str
    started_at: datetime
    deadline_at: datetime


class GameClockState(BaseModel):
    started_at: datetime
    deadline_at: datetime | None = None
    expired: bool = False


class GameProgressState(BaseModel):
    round_index: int = 0
    completed_rounds: int = 0
    main_questions_completed: int = 0
    current_topic_id: str | None = None
    current_topic_label: str | None = None
    topic_deck: TopicDeckState | None = None
    game_clock: GameClockState | None = None


class FinishedState(BaseModel):
    reason: EndReason
    winners: list[str]
    standings: list[StandingsEntryState]
    finished_at: datetime
    summary_id: str | None = None


class SummaryPlayerState(BaseModel):
    player_id: str
    name: str
    color: str
    score: int
    rank: int


class SummaryBonusQuestionState(BaseModel):
    prompt: str
    submitted_answer: str | None = None
    correct_answer: str
    grading_reason: str | None = None
    result: QuestionResult


class SummaryQuestionState(BaseModel):
    question_id: str
    topic_label: str
    prompt: str
    submitted_answer: str | None = None
    correct_answer: str
    grading_reason: str | None = None
    fact_card: FactCardState
    result: QuestionResult
    answering_player_id: str | None = None
    score_events: list[ScoreEventState] = []
    bonus_awarded_player_id: str | None = None
    bonus_questions: list[SummaryBonusQuestionState] = []


class GameSummaryResponse(BaseModel):
    summary_id: str
    room_code: str
    created_at: datetime
    finished_at: datetime
    reason: EndReason
    winners: list[str]
    selected_topics: list[str]
    players: list[SummaryPlayerState]
    questions: list[SummaryQuestionState]


class RoomStateResponse(BaseModel):
    code: str
    phase: RoomPhase
    created_at: datetime
    updated_at: datetime
    display_connected: bool
    settings_locked: bool
    vip_player_id: str | None
    players: list[PlayerState]
    settings: RoomSettingsState
    active_player_count: int
    spectator_count: int
    can_start: bool
    start_blockers: list[str]
    topic_voting: TopicVotingState | None = None
    game_config_snapshot: GameConfigSnapshotState | None = None
    progress: GameProgressState | None = None
    current_question: MainQuestionState | None = None
    buzz_state: BuzzStateResponse | None = None
    adjudication: AdjudicationState | None = None
    bonus_chain: BonusChainState | None = None
    score_reveal: ScoreRevealState | None = None
    pause_state: PauseState | None = None
    narration: NarrationCueState | None = None
    finished: FinishedState | None = None
    intro_deadline_at: datetime | None = None


class PlayerSessionResponse(BaseModel):
    player_id: str
    player_token: str
    role: PlayerRole
    room_code: str


class DisplaySessionResponse(BaseModel):
    room_code: str
    display_token: str


class CreateRoomResponse(BaseModel):
    room: RoomStateResponse
    display_session: DisplaySessionResponse


class JoinRoomRequest(BaseModel):
    turnstile_token: str | None = None
    client_id: str = Field(min_length=8, max_length=120)
    name: str = Field(min_length=1, max_length=40)
    color: str = Field(min_length=3, max_length=20)
    expertise: str = Field(min_length=1, max_length=250)


class CreateRoomRequest(BaseModel):
    turnstile_token: str | None = None


class JoinRoomResponse(BaseModel):
    room: RoomStateResponse
    player_session: PlayerSessionResponse


class PlayerAuthRequest(BaseModel):
    player_token: str = Field(min_length=8, max_length=128)
    client_id: str | None = Field(default=None, min_length=8, max_length=120)


class ReadyUpdateRequest(PlayerAuthRequest):
    ready: bool


class SettingsPatch(BaseModel):
    model_preset_id: str | None = None
    topic_pool_size: int | None = None
    reveal_mode: RevealMode | None = None
    end_mode: EndMode | None = None
    rounds_count: int | None = None
    timer_minutes: int | None = None
    timer_expiry_mode: TimerExpiryMode | None = None
    main_answer_seconds: int | None = None
    no_buzz_window_seconds: int | None = None
    bonus_answer_seconds: int | None = None
    moderation_mode: Literal["off", "light", "family_safe"] | None = None
    narration_enabled: bool | None = None
    sound_effects_enabled: bool | None = None
    music_enabled: bool | None = None


class UpdateSettingsRequest(PlayerAuthRequest):
    settings: SettingsPatch


class StartGameRequest(PlayerAuthRequest):
    pass


class SkipIntroRequest(PlayerAuthRequest):
    pass


class KickPlayerRequest(PlayerAuthRequest):
    target_player_id: str


class SubmitTopicVotesRequest(PlayerAuthRequest):
    topic_ids: list[str] = Field(min_length=1, max_length=3)


class TopicVotingActionRequest(PlayerAuthRequest):
    pass


class BuzzRequest(PlayerAuthRequest):
    pass


class SubmitAnswerRequest(PlayerAuthRequest):
    answer: str = Field(min_length=1, max_length=160)


class AdjudicationDecisionRequest(PlayerAuthRequest):
    decision: Literal["accept", "reject"]


class ResetRoomRequest(PlayerAuthRequest):
    pass


class DisplayAuthRequest(BaseModel):
    display_token: str = Field(min_length=8, max_length=128)


class ApiEnvelope(BaseModel):
    type: Literal["room_state"]
    payload: RoomStateResponse
