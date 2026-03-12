from __future__ import annotations

import asyncio
import logging
import os
import secrets
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import HTTPException, status

from .audio import ElevenLabsNarrationService
from .config import AppConfig, ModelPreset
from .metrics import GAMES_FINISHED
from .gameplay_generation import (
    GradingPayload,
    OpenRouterGameplayGenerator,
    QuestionGenerationInput,
    make_id,
)
from .schemas import (
    AdjudicationState,
    AdjudicationVoteState,
    AudioSettings,
    BonusChainState,
    BonusQuestionState,
    BuzzStateResponse,
    FactCardState,
    FinishedState,
    GameSummaryResponse,
    GameClockState,
    GameConfigSnapshotState,
    GameProgressState,
    IntRangeResponse,
    JoinRoomResponse,
    MainQuestionState,
    NarrationCueState,
    PauseState,
    PlayerSessionResponse,
    PlayerState,
    PublicConfigResponse,
    PublicModelPreset,
    QuestionPromptState,
    ResolvedQuestionState,
    RoomPhase,
    RoomSettingsState,
    RoomStateResponse,
    ScoreEventState,
    ScoreRevealState,
    SettingsPatch,
    SummaryBonusQuestionState,
    SummaryPlayerState,
    SummaryQuestionState,
    StandingsEntryState,
    TopicDeckState,
    TopicOptionState,
    TopicTieBreakState,
    TopicVoteState,
    TopicVotingState,
)
from .security import InMemoryRateLimiter
from .storage import PersistenceAdapter
from .topic_generation import OpenRouterTopicGenerator, TopicSourceInput

logger = logging.getLogger(__name__)

MAX_APPROVALS_PER_PLAYER = 3
SHORTLIST_SIZE = 12
PLAYER_TOPIC_COUNT = 8
STANDARD_TOPIC_COUNT = 4
TOPIC_REROLLS_PER_GAME = 1
BONUS_QUESTION_COUNT = 3
BUZZ_CELEBRATION_SECONDS = 3
VIP_RETURN_TIMEOUT_SECONDS = 90
STANDARD_TOPICS = [
    "World History",
    "Film & Television",
    "Science Breakthroughs",
    "Literature & Poetry",
    "Music Icons",
    "Politics & Power",
    "Geography",
    "Sports Legends",
]
HARD_BLOCK_TERMS = {
    "kill yourself",
    "kys",
    "nigger",
    "rape",
    "child porn",
}


def utc_now() -> datetime:
    return datetime.now(UTC)


def normalize_room_code(code: str) -> str:
    return code.strip().upper()


def safe_room_key(code: str) -> str:
    return normalize_room_code(code)


def topic_label_to_id(label: str) -> str:
    slug = "-".join(
        part
        for part in "".join(char.lower() if char.isalnum() else " " for char in label).split()
        if part
    )
    return slug[:48] or secrets.token_hex(4)


@dataclass(slots=True)
class Player:
    id: str
    token: str
    client_id: str
    name: str
    color: str
    expertise: str
    role: Literal["vip_player", "player", "spectator"]
    ready: bool = False
    connected: bool = False
    joined_at: datetime = field(default_factory=utc_now)
    score: int = 0
    can_buzz: bool = False
    has_buzzed: bool = False
    is_answering: bool = False
    bonus_active: bool = False


@dataclass(slots=True)
class RoomSettings:
    model_preset_id: str
    content_model_id: str
    grading_model_id: str
    topic_pool_size: int
    reveal_mode: Literal["progressive", "full"]
    end_mode: Literal["rounds", "timer"]
    rounds_count: int
    timer_minutes: int
    timer_expiry_mode: Literal["finish_round", "finish_main_only", "stop_immediately"]
    main_answer_seconds: int
    no_buzz_window_seconds: int
    bonus_answer_seconds: int
    moderation_mode: Literal["off", "light", "family_safe"]
    narration_enabled: bool
    sound_effects_enabled: bool
    music_enabled: bool


@dataclass(slots=True)
class TopicOption:
    id: str
    label: str
    source: Literal["player", "standard"]


@dataclass(slots=True)
class TopicVote:
    player_id: str
    topic_ids: list[str]
    submitted_at: datetime = field(default_factory=utc_now)


@dataclass(slots=True)
class TopicTieBreak:
    candidate_topic_ids: list[str]
    chosen_topic_ids: list[str]
    approval_count: int


@dataclass(slots=True)
class TopicVoting:
    status: Literal["collecting_votes", "locked"]
    rerolls_remaining: int
    max_approvals_per_player: int
    options: list[TopicOption]
    votes: dict[str, TopicVote] = field(default_factory=dict)
    selected_topic_ids: list[str] = field(default_factory=list)
    tie_break: TopicTieBreak | None = None


@dataclass(slots=True)
class QuestionPrompt:
    id: str
    topic_id: str
    topic_label: str
    prompt: str
    prompt_chunks: list[str]
    answer: str
    acceptable_answers: list[str]
    fact_card: FactCardState
    reveal_index: int = 0
    interruption_index: int | None = None
    source_attempt: int = 1


@dataclass(slots=True)
class MainQuestion:
    question: QuestionPrompt
    status: Literal["loading", "ready", "active", "resolved"]
    asked_at: datetime | None = None
    reveal_started_at: datetime | None = None
    reveal_completed_at: datetime | None = None
    buzz_opened_at: datetime | None = None
    buzz_deadline_at: datetime | None = None
    answering_player_id: str | None = None
    answering_deadline_at: datetime | None = None
    submitted_answer: str | None = None
    result: Literal["unanswered", "correct", "incorrect", "adjudicated"] = "unanswered"
    grading_status: Literal["pending", "complete", "fallback_to_adjudication"] = "pending"
    grading_reason: str | None = None
    retry_count: int = 0
    no_buzz_reason: str | None = None


@dataclass(slots=True)
class BuzzState:
    status: Literal["waiting", "locked", "expired"]
    opened_at: datetime | None = None
    deadline_at: datetime | None = None
    winner_player_id: str | None = None
    winner_locked_at: datetime | None = None
    eligible_player_ids: list[str] = field(default_factory=list)
    locked_out_player_ids: list[str] = field(default_factory=list)
    buzz_order: list[str] = field(default_factory=list)


@dataclass(slots=True)
class BonusQuestion:
    id: str
    prompt: str
    answer: str
    acceptable_answers: list[str]
    grading_reason: str | None = None
    submitted_answer: str | None = None
    result: Literal["unanswered", "correct", "incorrect", "adjudicated"] = "unanswered"


@dataclass(slots=True)
class BonusChain:
    awarded_player_id: str
    source_question_id: str
    current_index: int
    total_questions: int
    questions: list[BonusQuestion]
    answer_deadline_at: datetime | None = None
    completed: bool = False


@dataclass(slots=True)
class ScoreEvent:
    player_id: str
    delta: int
    reason: str


@dataclass(slots=True)
class SummaryQuestionRecord:
    question_id: str
    topic_label: str
    prompt: str
    submitted_answer: str | None
    correct_answer: str
    grading_reason: str | None
    fact_card: FactCardState
    result: Literal["unanswered", "correct", "incorrect", "adjudicated"]
    answering_player_id: str | None
    score_events: list[ScoreEvent] = field(default_factory=list)
    bonus_awarded_player_id: str | None = None
    bonus_questions: list[BonusQuestion] = field(default_factory=list)


@dataclass(slots=True)
class AdjudicationVote:
    player_id: str
    decision: Literal["accept", "reject"]
    submitted_at: datetime = field(default_factory=utc_now)


@dataclass(slots=True)
class Adjudication:
    status: Literal["idle", "vip_deciding", "player_vote", "resolved"] = "idle"
    mode: Literal["none", "vip_binary", "player_majority"] = "none"
    subject_player_id: str | None = None
    prompt: str | None = None
    eligible_voter_ids: list[str] = field(default_factory=list)
    votes: list[AdjudicationVote] = field(default_factory=list)
    resolved_decision: Literal["accept", "reject"] | None = None
    reason: str | None = None


@dataclass(slots=True)
class GameProgress:
    round_index: int = 0
    completed_rounds: int = 0
    main_questions_completed: int = 0
    current_topic_id: str | None = None
    current_topic_label: str | None = None
    selected_topic_ids: list[str] = field(default_factory=list)
    upcoming_topic_ids: list[str] = field(default_factory=list)
    used_topic_ids: list[str] = field(default_factory=list)
    skipped_topic_ids: list[str] = field(default_factory=list)
    failure_counts: dict[str, int] = field(default_factory=dict)
    reshuffle_count: int = 0
    game_started_at: datetime | None = None
    game_deadline_at: datetime | None = None
    timer_expired: bool = False


@dataclass(slots=True)
class Room:
    code: str
    settings: RoomSettings
    display_token: str = field(default_factory=lambda: secrets.token_urlsafe(18))
    phase: RoomPhase = "lobby"
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)
    settings_locked: bool = False
    display_connection_count: int = 0
    players: dict[str, Player] = field(default_factory=dict)
    blocked_client_ids: set[str] = field(default_factory=set)
    topic_voting: TopicVoting | None = None
    game_config_snapshot: RoomSettings | None = None
    progress: GameProgress | None = None
    current_question: MainQuestion | None = None
    buzz_state: BuzzState | None = None
    adjudication: Adjudication = field(default_factory=Adjudication)
    bonus_chain: BonusChain | None = None
    score_events: list[ScoreEvent] = field(default_factory=list)
    score_headline: str | None = None
    last_resolved_question: MainQuestion | None = None
    question_history: list[SummaryQuestionRecord] = field(default_factory=list)
    summary_id: str | None = None
    pause_state: PauseState | None = None
    narration: NarrationCueState | None = None
    finished: FinishedState | None = None
    paused_phase: RoomPhase | None = None
    paused_remaining_seconds: dict[str, float] = field(default_factory=dict)
    intro_deadline_at: datetime | None = None
    async_work_in_progress: bool = False
    _topic_task: asyncio.Task | None = None
    _pending_narration_text: str | None = None

    @property
    def vip_player_id(self) -> str | None:
        for player in self.players.values():
            if player.role == "vip_player":
                return player.id
        return None


class RoomManager:
    def __init__(self, app_config: AppConfig) -> None:
        self.app_config = app_config
        self.rooms: dict[str, Room] = {}
        self._room_locks: dict[str, asyncio.Lock] = {}
        self._creation_lock = asyncio.Lock()
        self.topic_generator = OpenRouterTopicGenerator(app_config)
        self.gameplay_generator = OpenRouterGameplayGenerator(app_config)
        self.narration_service = ElevenLabsNarrationService(app_config)
        self.rate_limiter = InMemoryRateLimiter()
        self.persistence = PersistenceAdapter(app_config)

    def _get_room_lock(self, room_code: str) -> asyncio.Lock:
        code = normalize_room_code(room_code)
        if code not in self._room_locks:
            self._room_locks[code] = asyncio.Lock()
        return self._room_locks[code]

    def public_config(self) -> PublicConfigResponse:
        experimental_map = {item.id: item.experimental for item in self.app_config.models.catalog}
        presets = [
            PublicModelPreset(
                id=preset.id,
                label=preset.label,
                description=preset.description,
                content_model=preset.content_model,
                grading_model=preset.grading_model,
                experimental=experimental_map.get(preset.content_model, False)
                or experimental_map.get(preset.grading_model, False),
            )
            for preset in self.app_config.visible_presets
        ]
        limits = self.app_config.settings.limits
        defaults = self.app_config.settings.defaults
        return PublicConfigResponse(
            app_name=self.app_config.app.name,
            hard_max_players=self.app_config.room.hard_max_players,
            room_code_length=self.app_config.room.code_length,
            turnstile_enabled=self.app_config.turnstile.enabled,
            turnstile_site_key=os.getenv(self.app_config.turnstile.site_key_env),
            model_presets=presets,
            default_settings=self.serialize_settings(self.default_settings()),
            topic_pool_size=IntRangeResponse(
                min=limits.topic_pool_size.min,
                max=limits.topic_pool_size.max,
                default=limits.topic_pool_size.default,
            ),
            rounds_count=IntRangeResponse(
                min=limits.rounds_count.min,
                max=limits.rounds_count.max,
                default=limits.rounds_count.default,
            ),
            timer_minutes=IntRangeResponse(
                min=limits.timer_minutes.min,
                max=limits.timer_minutes.max,
                default=limits.timer_minutes.default,
            ),
            main_answer_seconds=IntRangeResponse(
                min=limits.main_answer_seconds.min,
                max=limits.main_answer_seconds.max,
                default=limits.main_answer_seconds.default,
            ),
            no_buzz_window_seconds=IntRangeResponse(
                min=limits.no_buzz_window_seconds.min,
                max=limits.no_buzz_window_seconds.max,
                default=limits.no_buzz_window_seconds.default,
            ),
            bonus_answer_seconds=IntRangeResponse(
                min=limits.bonus_answer_seconds.min,
                max=limits.bonus_answer_seconds.max,
                default=limits.bonus_answer_seconds.default,
            ),
            reveal_modes=["progressive", "full"],
            end_modes=["rounds", "timer"],
            timer_expiry_modes=["finish_round", "finish_main_only", "stop_immediately"],
            audio_default_states=AudioSettings(
                narration_enabled=defaults.narration_enabled,
                sound_effects_enabled=defaults.sound_effects_enabled,
                music_enabled=defaults.music_enabled,
            ),
        )

    def default_settings(self) -> RoomSettings:
        preset = self.default_preset()
        defaults = self.app_config.settings.defaults
        limits = self.app_config.settings.limits
        return RoomSettings(
            model_preset_id=preset.id,
            content_model_id=preset.content_model,
            grading_model_id=preset.grading_model,
            topic_pool_size=limits.topic_pool_size.default,
            reveal_mode=defaults.reveal_mode,
            end_mode=defaults.end_mode,
            rounds_count=limits.rounds_count.default,
            timer_minutes=limits.timer_minutes.default,
            timer_expiry_mode=defaults.timer_expiry_mode,
            main_answer_seconds=limits.main_answer_seconds.default,
            no_buzz_window_seconds=limits.no_buzz_window_seconds.default,
            bonus_answer_seconds=limits.bonus_answer_seconds.default,
            moderation_mode=defaults.moderation_mode,
            narration_enabled=defaults.narration_enabled,
            sound_effects_enabled=defaults.sound_effects_enabled,
            music_enabled=defaults.music_enabled,
        )

    def default_preset(self) -> ModelPreset:
        return self.app_config.default_preset

    async def create_room(self) -> RoomStateResponse:
        async with self._creation_lock:
            self.prune_expired_rooms()
            code = self._generate_room_code()
            room = Room(code=code, settings=self.default_settings())
            self.rooms[code] = room
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            logger.info(
                "Room created",
                extra={"event": "room_created", "room_code": code},
            )
            return room_state

    def create_display_session(self, room_code: str) -> str:
        room = self.rooms[normalize_room_code(room_code)]
        return room.display_token

    def apply_rate_limit(self, action: str, subject: str, limit: int) -> None:
        self.rate_limiter.check(f"{action}:{subject}", limit)

    async def load_room(self, room_code: str) -> Room:
        code = normalize_room_code(room_code)
        room = self.rooms.get(code)
        if room is not None:
            return room
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")

    async def persist_room(self, room: Room, room_state: RoomStateResponse) -> None:
        self.rooms[room.code] = room
        return None

    def prune_expired_rooms(self) -> None:
        now = utc_now()
        to_delete: list[str] = []
        for code, room in self.rooms.items():
            age_minutes = (now - room.updated_at).total_seconds() / 60
            if room.phase == "lobby" and age_minutes >= self.app_config.room.lobby_idle_ttl_minutes:
                to_delete.append(code)
            elif (
                room.phase == "finished"
                and age_minutes >= self.app_config.room.finished_room_ttl_minutes
            ):
                to_delete.append(code)
        for code in to_delete:
            self.rooms.pop(code, None)
            self._room_locks.pop(code, None)

    async def get_room_state(self, room_code: str) -> RoomStateResponse:
        async with self._get_room_lock(room_code):
            self.prune_expired_rooms()
            room = await self.load_room(room_code)
            self.advance_room_state(room)
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def join_room(
        self, room_code: str, client_id: str, name: str, color: str, expertise: str
    ) -> JoinRoomResponse:
        async with self._get_room_lock(room_code):
            self.prune_expired_rooms()
            room = await self.load_room(room_code)
            self.advance_room_state(room)
            if client_id in room.blocked_client_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You were removed from this room.",
                )

            clean_name = name.strip()
            clean_color = color.strip().lower()
            clean_expertise = expertise.strip()
            self.validate_user_text(clean_name, room.settings.moderation_mode)
            self.validate_user_text(clean_expertise, room.settings.moderation_mode)
            self.validate_join_constraints(room, clean_name, clean_color)

            current_active_players = [
                player for player in room.players.values() if player.role != "spectator"
            ]
            if (
                room.phase == "lobby"
                and len(current_active_players) >= self.app_config.room.hard_max_players
            ):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Room is full.")

            role: Literal["vip_player", "player", "spectator"]
            if room.phase != "lobby":
                role = "spectator"
            elif not current_active_players:
                role = "vip_player"
            else:
                role = "player"

            player = Player(
                id=secrets.token_urlsafe(8),
                token=secrets.token_urlsafe(18),
                client_id=client_id,
                name=clean_name,
                color=clean_color,
                expertise=clean_expertise,
                role=role,
            )
            room.players[player.id] = player
            room.updated_at = utc_now()
            logger.info(
                "Player joined room",
                extra={
                    "event": "player_joined",
                    "room_code": room.code,
                    "player_id": player.id,
                    "role": player.role,
                    "player_count": len(room.players),
                },
            )
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return JoinRoomResponse(
                room=room_state,
                player_session=PlayerSessionResponse(
                    player_id=player.id,
                    player_token=player.token,
                    role=player.role,
                    room_code=room.code,
                ),
            )

    async def set_ready(
        self,
        room_code: str,
        player_id: str,
        player_token: str,
        ready: bool,
        client_id: str | None = None,
    ) -> RoomStateResponse:
        async with self._get_room_lock(room_code):
            room = await self.load_room(room_code)
            player = self.require_player(room, player_id, player_token)
            self.require_player_client(room, player, client_id)
            if room.phase != "lobby":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Ready state can only change in the lobby.",
                )
            if player.role == "spectator":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Spectators cannot ready up.",
                )
            player.ready = ready
            room.updated_at = utc_now()
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def update_settings(
        self,
        room_code: str,
        player_id: str,
        player_token: str,
        patch: SettingsPatch,
        client_id: str | None = None,
    ) -> RoomStateResponse:
        async with self._get_room_lock(room_code):
            room = await self.load_room(room_code)
            player = self.require_player(room, player_id, player_token)
            self.require_player_client(room, player, client_id)
            self.require_vip_lobby_control(room, player)
            limits = self.app_config.settings.limits
            updates = patch.model_dump(exclude_none=True)
            if not updates:
                return self.serialize_room(room)
            if "model_preset_id" in updates:
                preset = self.require_preset(updates["model_preset_id"])
                room.settings.model_preset_id = preset.id
                room.settings.content_model_id = preset.content_model
                room.settings.grading_model_id = preset.grading_model
            if "topic_pool_size" in updates:
                room.settings.topic_pool_size = self.validate_range(
                    updates["topic_pool_size"],
                    limits.topic_pool_size.min,
                    limits.topic_pool_size.max,
                    "Topic pool size",
                )
            if "reveal_mode" in updates:
                self.validate_choice(updates["reveal_mode"], ["progressive", "full"], "Reveal mode")
                room.settings.reveal_mode = updates["reveal_mode"]
            if "end_mode" in updates:
                self.validate_choice(updates["end_mode"], ["rounds", "timer"], "End mode")
                room.settings.end_mode = updates["end_mode"]
            if "rounds_count" in updates:
                room.settings.rounds_count = self.validate_range(
                    updates["rounds_count"],
                    limits.rounds_count.min,
                    limits.rounds_count.max,
                    "Rounds count",
                )
            if "timer_minutes" in updates:
                room.settings.timer_minutes = self.validate_range(
                    updates["timer_minutes"],
                    limits.timer_minutes.min,
                    limits.timer_minutes.max,
                    "Timer minutes",
                )
            if "timer_expiry_mode" in updates:
                self.validate_choice(
                    updates["timer_expiry_mode"],
                    ["finish_round", "finish_main_only", "stop_immediately"],
                    "Timer expiry mode",
                )
                room.settings.timer_expiry_mode = updates["timer_expiry_mode"]
            if "main_answer_seconds" in updates:
                room.settings.main_answer_seconds = self.validate_range(
                    updates["main_answer_seconds"],
                    limits.main_answer_seconds.min,
                    limits.main_answer_seconds.max,
                    "Main answer timer",
                )
            if "no_buzz_window_seconds" in updates:
                room.settings.no_buzz_window_seconds = self.validate_range(
                    updates["no_buzz_window_seconds"],
                    limits.no_buzz_window_seconds.min,
                    limits.no_buzz_window_seconds.max,
                    "No-buzz window",
                )
            if "bonus_answer_seconds" in updates:
                room.settings.bonus_answer_seconds = self.validate_range(
                    updates["bonus_answer_seconds"],
                    limits.bonus_answer_seconds.min,
                    limits.bonus_answer_seconds.max,
                    "Bonus answer timer",
                )
            if "moderation_mode" in updates:
                self.validate_choice(
                    updates["moderation_mode"],
                    ["off", "light", "family_safe"],
                    "Moderation mode",
                )
                room.settings.moderation_mode = updates["moderation_mode"]
            if "narration_enabled" in updates:
                room.settings.narration_enabled = updates["narration_enabled"]
            if "sound_effects_enabled" in updates:
                room.settings.sound_effects_enabled = updates["sound_effects_enabled"]
            if "music_enabled" in updates:
                room.settings.music_enabled = updates["music_enabled"]
            room.updated_at = utc_now()
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def start_game(
        self, room_code: str, player_id: str, player_token: str, client_id: str | None = None
    ) -> RoomStateResponse:
        async with self._get_room_lock(room_code):
            room = await self.load_room(room_code)
            player = self.require_player(room, player_id, player_token)
            self.require_player_client(room, player, client_id)
            self.require_vip_lobby_control(room, player)
            blockers = self.start_blockers(room)
            if blockers:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot start game: " + "; ".join(blockers),
                )
            room.phase = "intro"
            room.settings_locked = True
            room.intro_deadline_at = utc_now() + timedelta(seconds=85)
            room.game_config_snapshot = self.clone_settings(room.settings)
            room.progress = GameProgress(
                game_started_at=utc_now(),
                game_deadline_at=(utc_now() + timedelta(minutes=room.settings.timer_minutes))
                if room.settings.end_mode == "timer"
                else None,
            )
            # Eagerly start topic generation in the background during intro
            room._topic_task = asyncio.create_task(self.build_topic_voting(room))
            room.updated_at = utc_now()
            active_count = sum(1 for p in room.players.values() if p.role != "spectator")
            logger.info(
                "Game started",
                extra={
                    "event": "game_started",
                    "room_code": room.code,
                    "player_count": active_count,
                    "end_mode": room.settings.end_mode,
                    "reveal_mode": room.settings.reveal_mode,
                    "content_model_id": room.settings.content_model_id,
                    "grading_model_id": room.settings.grading_model_id,
                },
            )
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def skip_intro(
        self, room_code: str, player_id: str, player_token: str, client_id: str | None = None
    ) -> RoomStateResponse:
        lock = self._get_room_lock(room_code)

        # Phase 1: validate & transition under lock
        async with lock:
            room = await self.load_room(room_code)
            player = self.require_player(room, player_id, player_token)
            self.require_player_client(room, player, client_id)
            self.require_vip(room, player)
            if room.phase != "intro":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot skip intro: game is not in the intro phase.",
                )
            room.phase = "topic_voting"
            room.intro_deadline_at = None

            # Check if eager topic task is ready
            if room._topic_task is not None and room._topic_task.done():
                try:
                    room.topic_voting = room._topic_task.result()
                except Exception as exc:
                    logger.warning(
                        "Eager topic task failed in skip_intro: %s",
                        exc,
                        extra={
                            "event": "eager_topic_failed",
                            "room_code": room.code,
                            "error": str(exc),
                        },
                    )
                    room._topic_task = None
                else:
                    room._topic_task = None
                    room.updated_at = utc_now()
                    room_state = self.serialize_room(room)
                    await self.persist_room(room, room_state)
                    return room_state

            room.async_work_in_progress = True
            room.updated_at = utc_now()
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)

        # Phase 2: generate topics without lock
        topic_voting = await self.build_topic_voting(room)

        # Phase 3: apply under lock
        async with lock:
            room.topic_voting = topic_voting
            room.async_work_in_progress = False
            room.updated_at = utc_now()
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def submit_topic_votes(
        self,
        room_code: str,
        player_id: str,
        player_token: str,
        topic_ids: list[str],
        client_id: str | None = None,
    ) -> RoomStateResponse:
        lock = self._get_room_lock(room_code)
        needs_finalize = False

        async with lock:
            room = await self.load_room(room_code)
            self.advance_room_state(room)
            player = self.require_player(room, player_id, player_token)
            self.require_player_client(room, player, client_id)
            if player.role == "spectator":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Spectators cannot vote on topics.",
                )
            topic_voting = self.require_topic_voting(room)
            if topic_voting.status != "collecting_votes":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Topic voting is already locked.",
                )
            unique_topic_ids = list(dict.fromkeys(topic_ids))
            if not unique_topic_ids:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Choose at least one topic."
                )
            if len(unique_topic_ids) > topic_voting.max_approvals_per_player:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"You can approve at most {topic_voting.max_approvals_per_player} topics.",
                )
            valid_topic_ids = {option.id for option in topic_voting.options}
            if [topic_id for topic_id in unique_topic_ids if topic_id not in valid_topic_ids]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="One or more selected topics are invalid.",
                )
            topic_voting.votes[player.id] = TopicVote(
                player_id=player.id, topic_ids=unique_topic_ids
            )
            room.updated_at = utc_now()
            if self.all_active_players_have_voted(room):
                needs_finalize = True
                # Finalize voting (tallying + deck setup) is synchronous,
                # but start_next_main_question is async with LLM calls
                self._finalize_topic_voting_sync(room)
                room.async_work_in_progress = True
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)

            if not needs_finalize:
                return room_state

        # Generate first question without lock
        try:
            await self.start_next_main_question(room)
        except Exception as exc:
            logger.warning(
                "First question generation failed after topic voting: %s",
                exc,
                extra={
                    "event": "first_question_failed",
                    "room_code": room.code,
                    "source": "submit_topic_votes",
                    "error": str(exc),
                },
            )

        async with lock:
            room.async_work_in_progress = False
            room.updated_at = utc_now()
            self.advance_room_state(room)
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def reroll_topics(
        self, room_code: str, player_id: str, player_token: str, client_id: str | None = None
    ) -> RoomStateResponse:
        lock = self._get_room_lock(room_code)

        async with lock:
            room = await self.load_room(room_code)
            player = self.require_player(room, player_id, player_token)
            self.require_player_client(room, player, client_id)
            self.require_vip(room, player)
            topic_voting = self.require_topic_voting(room)
            if topic_voting.rerolls_remaining <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="No topic rerolls remain."
                )
            if topic_voting.votes:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot reroll after voting has started.",
                )
            topic_voting.rerolls_remaining -= 1
            reroll_seed = topic_voting.rerolls_remaining
            room.async_work_in_progress = True
            room.updated_at = utc_now()
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)

        # Generate new topic options without lock
        new_options = await self.generate_topic_options(room, seed=reroll_seed)

        async with lock:
            topic_voting = self.require_topic_voting(room)
            topic_voting.options = new_options
            room.async_work_in_progress = False
            room.updated_at = utc_now()
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def lock_topic_voting(
        self, room_code: str, player_id: str, player_token: str, client_id: str | None = None
    ) -> RoomStateResponse:
        lock = self._get_room_lock(room_code)

        async with lock:
            room = await self.load_room(room_code)
            player = self.require_player(room, player_id, player_token)
            self.require_player_client(room, player, client_id)
            self.require_vip(room, player)
            self.require_topic_voting(room)
            self._finalize_topic_voting_sync(room)
            room.async_work_in_progress = True
            room.updated_at = utc_now()
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)

        # Generate first question without lock
        try:
            await self.start_next_main_question(room)
        except Exception as exc:
            logger.warning(
                "First question generation failed after lock_topic_voting: %s",
                exc,
                extra={
                    "event": "first_question_failed",
                    "room_code": room.code,
                    "source": "lock_topic_voting",
                    "error": str(exc),
                },
            )

        async with lock:
            room.async_work_in_progress = False
            room.updated_at = utc_now()
            self.advance_room_state(room)
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def buzz_in(
        self, room_code: str, player_id: str, player_token: str, client_id: str | None = None
    ) -> RoomStateResponse:
        async with self._get_room_lock(room_code):
            room = await self.load_room(room_code)
            self.advance_room_state(room)
            player = self.require_player(room, player_id, player_token)
            self.require_player_client(room, player, client_id)
            if player.role == "spectator":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Spectators cannot buzz."
                )
            if room.phase != "buzz_open" or room.buzz_state is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Buzzing is not open."
                )
            if not player.can_buzz or player.id in room.buzz_state.locked_out_player_ids:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="You cannot buzz for this question.",
                )
            if room.buzz_state.status != "waiting":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Buzz already locked."
                )
            room.buzz_state.status = "locked"
            room.buzz_state.winner_player_id = player.id
            room.buzz_state.winner_locked_at = utc_now()
            room.buzz_state.buzz_order.append(player.id)
            logger.info(
                "Player buzzed in",
                extra={
                    "event": "buzz_in",
                    "room_code": room.code,
                    "player_id": player.id,
                },
            )
            # Phase stays "buzz_open" for 3-second celebration delay
            # advance_room_state will transition to "answering" after 3 seconds
            room.updated_at = utc_now()
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def submit_answer(
        self,
        room_code: str,
        player_id: str,
        player_token: str,
        answer: str,
        client_id: str | None = None,
    ) -> RoomStateResponse:
        lock = self._get_room_lock(room_code)

        # --- Phase 1: validate & set phase under lock ---
        async with lock:
            room = await self.load_room(room_code)
            self.advance_room_state(room)
            player = self.require_player(room, player_id, player_token)
            self.require_player_client(room, player, client_id)

            if room.phase == "bonus_answering":
                # Bonus grading stays under lock (single LLM, no retry).
                # Narration is deferred and done outside the lock below.
                await self._submit_bonus_answer(room, player, answer.strip())
                room.updated_at = utc_now()
                self.advance_room_state(room)
                narration_result = await self.drain_pending_narration(room, room_code, lock)
                if narration_result is not None:
                    return narration_result
                room_state = self.serialize_room(room)
                await self.persist_room(room, room_state)
                return room_state

            if room.phase != "answering":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No answer is being accepted right now.",
                )

            question = room.current_question
            if question is None or question.answering_player_id != player.id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="You are not the active answerer.",
                )

            stripped = answer.strip()
            question.submitted_answer = stripped
            player.is_answering = False
            room.phase = "grading"
            room.async_work_in_progress = True
            room.updated_at = utc_now()

            # Capture refs needed for unlocked grading
            grading_model_id = room.settings.grading_model_id
            prompt = question.question.prompt
            correct_answer = question.question.answer
            acceptable_answers = question.question.acceptable_answers

            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            # Lock released here — tick loop can now broadcast "grading" phase

        # --- Phase 2: grade answer WITHOUT lock ---
        grade: GradingPayload | None = None
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                grade = await self.gameplay_generator.grade_answer(
                    grading_model_id,
                    prompt,
                    correct_answer,
                    acceptable_answers,
                    stripped,
                )
                break
            except Exception as exc:
                last_error = exc

        # --- Phase 3: apply grading result under lock ---
        need_bonus = False
        async with lock:
            room = await self.load_room(room_code)
            question = room.current_question
            player = room.players.get(player_id)
            if question is None or player is None:
                room.async_work_in_progress = False
                room_state = self.serialize_room(room)
                await self.persist_room(room, room_state)
                return room_state

            question.retry_count = 1 if grade is None else 0

            if grade is None:
                question.grading_status = "fallback_to_adjudication"
                question.grading_reason = (
                    f"Automatic grading failed: {last_error}"
                    if last_error
                    else "Automatic grading failed."
                )
                logger.warning(
                    "Grading fell back to adjudication",
                    extra={
                        "event": "grading_adjudication",
                        "room_code": room_code,
                        "player_id": player.id,
                        "error": str(last_error) if last_error else None,
                    },
                )
                room.async_work_in_progress = False
                self.start_adjudication(room, player.id)
                room.updated_at = utc_now()
                self.advance_room_state(room)
                room_state = self.serialize_room(room)
                await self.persist_room(room, room_state)
                return room_state

            question.grading_status = "complete"
            question.grading_reason = grade.reason
            logger.info(
                "Answer graded in submit_answer",
                extra={
                    "event": "answer_graded",
                    "room_code": room_code,
                    "player_id": player.id,
                    "decision": grade.decision,
                    "player_answer": stripped[:80],
                },
            )

            content_model_id = room.settings.content_model_id
            topic_label = ""
            bonus_source_answer = ""

            if grade.decision == "correct":
                question.result = "correct"
                question.status = "resolved"
                player.score += 10
                room.score_events = [
                    ScoreEvent(player_id=player.id, delta=10, reason="Main question correct")
                ]
                room.phase = "bonus_loading"
                need_bonus = True
                # Keep async_work_in_progress=True while we generate bonus
                content_model_id = room.settings.content_model_id
                topic_label = question.question.topic_label
                bonus_source_answer = question.question.answer
            else:
                question.result = "incorrect"
                question.status = "resolved"
                if room.settings.reveal_mode == "progressive":
                    player.score -= 5
                    room.score_events = [
                        ScoreEvent(player_id=player.id, delta=-5, reason="Incorrect interruption")
                    ]
                else:
                    room.score_events = []
                player.can_buzz = False
                player.has_buzzed = True
                if room.buzz_state is None:
                    room.buzz_state = BuzzState(
                        status="waiting",
                        eligible_player_ids=self.active_player_ids(room),
                        locked_out_player_ids=[],
                    )
                room.buzz_state.locked_out_player_ids.append(player.id)
                room.buzz_state.status = "waiting"
                room.buzz_state.winner_player_id = None
                if self.remaining_buzzers(room):
                    room.phase = "buzz_open"
                    room.buzz_state.deadline_at = utc_now() + timedelta(seconds=8)
                    if room.current_question:
                        room.current_question.answering_player_id = None
                        room.current_question.answering_deadline_at = None
                        room.current_question.question.interruption_index = (
                            room.current_question.question.reveal_index
                        )
                        if room.settings.reveal_mode == "progressive":
                            room.current_question.status = "active"
                            room.phase = "question_reveal_progressive"
                else:
                    self.prepare_score_reveal(room, "Question resolved after incorrect answer.")
                room.async_work_in_progress = False

            room.updated_at = utc_now()
            self.advance_room_state(room)
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)

            if not need_bonus:
                return room_state

        # --- Phase 4: generate bonus questions WITHOUT lock ---
        bonus_chain_result: BonusChain | None = None
        try:
            assert room.current_question is not None
            bonuses = await self.gameplay_generator.generate_bonus_questions(
                content_model_id,
                topic_label,
                bonus_source_answer,
                BONUS_QUESTION_COUNT,
            )
            questions = [
                BonusQuestion(
                    id=make_id("bonus"),
                    prompt=item.prompt,
                    answer=item.answer,
                    acceptable_answers=item.acceptable_answers,
                )
                for item in bonuses[:BONUS_QUESTION_COUNT]
            ]
            bonus_chain_result = BonusChain(
                awarded_player_id=player_id,
                source_question_id=room.current_question.question.id,
                current_index=0,
                total_questions=len(questions),
                questions=questions,
            )
        except Exception as exc:
            logger.warning(
                "Bonus chain generation failed in submit_answer: %s",
                exc,
                extra={"event": "bonus_chain_failed", "room_code": room_code, "error": str(exc)},
            )
            bonus_chain_result = None

        # --- Phase 5: apply bonus chain under lock ---
        async with lock:
            room = await self.load_room(room_code)
            room.bonus_chain = bonus_chain_result
            room.async_work_in_progress = False
            room.updated_at = utc_now()
            self.advance_room_state(room)
            narration_result = await self.drain_pending_narration(room, room_code, lock)
            if narration_result is not None:
                return narration_result
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def submit_adjudication_decision(
        self,
        room_code: str,
        player_id: str,
        player_token: str,
        decision: Literal["accept", "reject"],
        client_id: str | None = None,
    ) -> RoomStateResponse:
        lock = self._get_room_lock(room_code)
        async with lock:
            room = await self.load_room(room_code)
            self.advance_room_state(room)
            player = self.require_player(room, player_id, player_token)
            self.require_player_client(room, player, client_id)
            if room.adjudication.status == "vip_deciding":
                self.require_vip(room, player)
                room.adjudication.status = "resolved"
                room.adjudication.resolved_decision = decision
                room.adjudication.reason = "VIP adjudication applied."
                self.apply_adjudication_result(room, decision)
            elif room.adjudication.status == "player_vote":
                if player.id not in room.adjudication.eligible_voter_ids:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="You cannot vote on this adjudication.",
                    )
                room.adjudication.votes = [
                    vote for vote in room.adjudication.votes if vote.player_id != player.id
                ]
                room.adjudication.votes.append(
                    AdjudicationVote(player_id=player.id, decision=decision)
                )
                self.try_finalize_player_vote_adjudication(room)
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="No adjudication is active."
                )
            room.updated_at = utc_now()
            self.advance_room_state(room)
            narration_result = await self.drain_pending_narration(room, room_code, lock)
            if narration_result is not None:
                return narration_result
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def kick_player(
        self,
        room_code: str,
        player_id: str,
        player_token: str,
        target_player_id: str,
        client_id: str | None = None,
    ) -> RoomStateResponse:
        lock = self._get_room_lock(room_code)
        needs_finalize = False

        async with lock:
            room = await self.load_room(room_code)
            player = self.require_player(room, player_id, player_token)
            self.require_player_client(room, player, client_id)
            self.require_vip(room, player)
            if target_player_id == player.id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="VIP cannot remove themselves.",
                )
            target = room.players.get(target_player_id)
            if target is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Player not found."
                )
            room.blocked_client_ids.add(target.client_id)
            del room.players[target_player_id]
            if room.topic_voting and target_player_id in room.topic_voting.votes:
                room.topic_voting.votes.pop(target_player_id, None)
            room.updated_at = utc_now()
            if (
                room.topic_voting
                and room.topic_voting.status == "collecting_votes"
                and self.all_active_players_have_voted(room)
            ):
                needs_finalize = True
                self._finalize_topic_voting_sync(room)
                room.async_work_in_progress = True
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)

            if not needs_finalize:
                return room_state

        # Generate first question without lock
        try:
            await self.start_next_main_question(room)
        except Exception as exc:
            logger.warning(
                "First question generation failed after kick_player: %s",
                exc,
                extra={
                    "event": "first_question_failed",
                    "room_code": room.code,
                    "source": "kick_player",
                    "error": str(exc),
                },
            )

        async with lock:
            room.async_work_in_progress = False
            room.updated_at = utc_now()
            self.advance_room_state(room)
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def reset_room(
        self, room_code: str, player_id: str, player_token: str, client_id: str | None = None
    ) -> RoomStateResponse:
        async with self._get_room_lock(room_code):
            room = await self.load_room(room_code)
            player = self.require_player(room, player_id, player_token)
            self.require_player_client(room, player, client_id)
            self.require_vip(room, player)
            for item in room.players.values():
                item.ready = False
                item.score = 0
                item.can_buzz = False
                item.has_buzzed = False
                item.is_answering = False
                item.bonus_active = False
            room.phase = "lobby"
            room.settings_locked = False
            room.topic_voting = None
            room.progress = None
            room.current_question = None
            room.buzz_state = None
            room.adjudication = Adjudication()
            room.bonus_chain = None
            room.score_events = []
            room.score_headline = None
            room.pause_state = None
            room.narration = None
            room.finished = None
            room.summary_id = None
            room.question_history = []
            room.async_work_in_progress = False
            if room._topic_task and not room._topic_task.done():
                room._topic_task.cancel()
            room._topic_task = None
            room.updated_at = utc_now()
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def set_display_connected(self, room_code: str, connected: bool) -> RoomStateResponse:
        async with self._get_room_lock(room_code):
            room = await self.load_room(room_code)
            room.display_connection_count += 1 if connected else -1
            if room.display_connection_count < 0:
                room.display_connection_count = 0
            room.updated_at = utc_now()
            self.advance_room_state(room)
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    async def set_player_connected(
        self,
        room_code: str,
        player_id: str,
        player_token: str,
        connected: bool,
        client_id: str | None = None,
    ) -> RoomStateResponse:
        async with self._get_room_lock(room_code):
            room = await self.load_room(room_code)
            player = self.require_player(room, player_id, player_token)
            self.require_player_client(room, player, client_id)
            player.connected = connected
            if player.id == room.vip_player_id and room.phase not in {"lobby", "finished"}:
                if connected:
                    self.resume_from_pause(room)
                    room.pause_state = None
                elif room.pause_state is None:
                    self.pause_room(room)
                    room.pause_state = PauseState(
                        reason="Waiting for VIP to reconnect.",
                        started_at=utc_now(),
                        deadline_at=utc_now() + timedelta(seconds=VIP_RETURN_TIMEOUT_SECONDS),
                    )
                    room.phase = "paused_waiting_for_vip"
            room.updated_at = utc_now()
            self.advance_room_state(room)
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    def pause_room(self, room: Room) -> None:
        room.paused_phase = room.phase
        room.paused_remaining_seconds = {}
        now = utc_now()
        if room.buzz_state and room.buzz_state.deadline_at:
            room.paused_remaining_seconds["buzz_deadline"] = max(
                (room.buzz_state.deadline_at - now).total_seconds(), 0
            )
        if room.buzz_state and room.buzz_state.winner_locked_at:
            elapsed = (now - room.buzz_state.winner_locked_at).total_seconds()
            room.paused_remaining_seconds["buzz_winner_delay"] = max(
                BUZZ_CELEBRATION_SECONDS - elapsed, 0
            )
        if room.current_question and room.current_question.answering_deadline_at:
            room.paused_remaining_seconds["answer_deadline"] = max(
                (room.current_question.answering_deadline_at - now).total_seconds(), 0
            )
        if room.bonus_chain and room.bonus_chain.answer_deadline_at:
            room.paused_remaining_seconds["bonus_deadline"] = max(
                (room.bonus_chain.answer_deadline_at - now).total_seconds(), 0
            )

    def resume_from_pause(self, room: Room) -> None:
        if room.phase != "paused_waiting_for_vip":
            return
        now = utc_now()
        room.phase = room.paused_phase or self.resume_phase_after_pause(room)
        if room.buzz_state and "buzz_deadline" in room.paused_remaining_seconds:
            room.buzz_state.deadline_at = now + timedelta(
                seconds=room.paused_remaining_seconds["buzz_deadline"]
            )
        if room.buzz_state and "buzz_winner_delay" in room.paused_remaining_seconds:
            # Reconstruct winner_locked_at so the remaining celebration time is preserved
            remaining = room.paused_remaining_seconds["buzz_winner_delay"]
            room.buzz_state.winner_locked_at = now - timedelta(
                seconds=BUZZ_CELEBRATION_SECONDS - remaining
            )
        if room.current_question and "answer_deadline" in room.paused_remaining_seconds:
            room.current_question.answering_deadline_at = now + timedelta(
                seconds=room.paused_remaining_seconds["answer_deadline"]
            )
        if room.bonus_chain and "bonus_deadline" in room.paused_remaining_seconds:
            room.bonus_chain.answer_deadline_at = now + timedelta(
                seconds=room.paused_remaining_seconds["bonus_deadline"]
            )
        room.paused_phase = None
        room.paused_remaining_seconds = {}

    async def verify_player_credentials(
        self, room_code: str, player_id: str, player_token: str
    ) -> None:
        async with self._get_room_lock(room_code):
            room = await self.load_room(room_code)
            self.require_player(room, player_id, player_token)

    def advance_room_state(self, room: Room) -> None:
        if room.async_work_in_progress:
            return
        now = utc_now()
        if room.pause_state and now >= room.pause_state.deadline_at:
            self.finish_game(room, "vip_disconnected_timeout")
            return
        if (
            room.progress
            and room.progress.game_deadline_at
            and now >= room.progress.game_deadline_at
        ):
            room.progress.timer_expired = True
            if room.settings.timer_expiry_mode == "stop_immediately":
                self.finish_game(room, "timer_expired")
                return
        if room.phase == "intro":
            if room.intro_deadline_at and now >= room.intro_deadline_at:
                room.phase = "topic_voting"
                room.intro_deadline_at = None
        elif room.phase == "question_loading":
            self.begin_question_reveal(room)
        elif room.phase in {"question_reveal_progressive", "question_reveal_full"}:
            self.maybe_complete_reveal(room)
        elif room.phase == "buzz_open":
            if not self.maybe_transition_buzz_winner(room):
                self.maybe_expire_buzz(room)
        elif room.phase == "answering":
            self.maybe_expire_main_answer(room)
        elif room.phase == "grading":
            self.finish_grading_if_resolved(room)
        elif room.phase == "bonus_loading":
            self.begin_bonus_chain(room)
        elif room.phase == "bonus_answering":
            self.maybe_expire_bonus_answer(room)
        elif room.phase == "score_reveal":
            self.advance_after_score_reveal(room)

    def resume_phase_after_pause(self, room: Room) -> RoomPhase:
        if room.bonus_chain and not room.bonus_chain.completed:
            return "bonus_answering"
        if room.adjudication.status in {"vip_deciding", "player_vote"}:
            return "grading"
        if room.current_question and room.current_question.answering_player_id:
            return "answering"
        if room.buzz_state and room.buzz_state.status in {"waiting", "locked"}:
            return "buzz_open"
        if room.current_question and room.current_question.result == "unanswered":
            return (
                "question_reveal_progressive"
                if room.settings.reveal_mode == "progressive"
                else "question_reveal_full"
            )
        return "score_reveal" if room.score_events else room.phase

    def validate_join_constraints(self, room: Room, name: str, color: str) -> None:
        self.validate_user_text(name, room.settings.moderation_mode if room.settings else "light")
        casefold_name = name.casefold()
        for existing in room.players.values():
            if existing.name.casefold() == casefold_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="That name is already taken in this room.",
                )
            if existing.color == color:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="That color is already taken in this room.",
                )

    def validate_user_text(
        self, value: str, moderation_mode: Literal["off", "light", "family_safe"]
    ) -> None:
        normalized = value.casefold()
        if any(term in normalized for term in HARD_BLOCK_TERMS):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Unsafe content is not allowed."
            )
        if moderation_mode == "family_safe":
            blocked = {"sex", "porn", "fuck", "shit", "bitch"}
            if any(term in normalized for term in blocked):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="That content is not allowed in family-safe rooms.",
                )

    def require_vip_lobby_control(self, room: Room, player: Player) -> None:
        self.require_vip(room, player)
        if room.phase != "lobby" or room.settings_locked:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Room settings are locked once the game has started.",
            )

    def require_vip(self, room: Room, player: Player) -> None:
        if player.role != "vip_player" or player.id != room.vip_player_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Only the VIP can do that."
            )

    def require_display_token(self, room: Room, display_token: str) -> None:
        if room.display_token != display_token:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid display session.",
            )

    def require_topic_voting(self, room: Room) -> TopicVoting:
        if room.phase != "topic_voting" or room.topic_voting is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Topic voting is not active."
            )
        return room.topic_voting

    def require_room(self, room_code: str) -> Room:
        code = normalize_room_code(room_code)
        room = self.rooms.get(code)
        if room is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")
        return room

    def require_player(self, room: Room, player_id: str, player_token: str) -> Player:
        player = room.players.get(player_id)
        if player is None or player.token != player_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid player session."
            )
        return player

    def require_player_client(self, room: Room, player: Player, client_id: str | None) -> None:
        if not self.app_config.security.bind_player_actions_to_client_id:
            return
        if not client_id or player.client_id != client_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This device is not authorized for that player session.",
            )

    def require_preset(self, preset_id: str) -> ModelPreset:
        for preset in self.app_config.visible_presets:
            if preset.id == preset_id:
                return preset
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown model preset.")

    def validate_choice(self, value: str, choices: list[str], label: str) -> None:
        if value not in choices:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{label} must be one of: {', '.join(choices)}.",
            )

    def validate_range(self, value: int, min_value: int, max_value: int, label: str) -> int:
        if not min_value <= value <= max_value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{label} must be between {min_value} and {max_value}.",
            )
        return value

    def start_blockers(self, room: Room) -> list[str]:
        blockers: list[str] = []
        active_players = [player for player in room.players.values() if player.role != "spectator"]
        if len(active_players) < self.app_config.lobby.min_players_to_start:
            blockers.append(
                f"At least {self.app_config.lobby.min_players_to_start} players are required."
            )
        if [player.name for player in active_players if not player.ready]:
            blockers.append("All active players must be ready.")
        return blockers

    async def build_topic_voting(self, room: Room) -> TopicVoting:
        return TopicVoting(
            status="collecting_votes",
            rerolls_remaining=TOPIC_REROLLS_PER_GAME,
            max_approvals_per_player=MAX_APPROVALS_PER_PLAYER,
            options=await self.generate_topic_options(room),
        )

    async def generate_topic_options(self, room: Room, seed: int = 0) -> list[TopicOption]:
        active_players = sorted(
            [player for player in room.players.values() if player.role != "spectator"],
            key=lambda player: player.joined_at,
        )
        player_labels = await self.topic_generator.generate_player_topics(
            players=[
                TopicSourceInput(name=player.name, expertise=player.expertise)
                for player in active_players
            ],
            model_id=room.settings.content_model_id,
            count=PLAYER_TOPIC_COUNT,
            seed=seed,
            soft_filter_enabled=room.settings.moderation_mode != "off",
        )
        player_topics = [
            TopicOption(
                id=f"player-{topic_label_to_id(label)}-{index}", label=label, source="player"
            )
            for index, label in enumerate(player_labels[:PLAYER_TOPIC_COUNT])
        ]
        standard_topics = [
            TopicOption(
                id=f"standard-{topic_label_to_id(STANDARD_TOPICS[(seed + offset) % len(STANDARD_TOPICS)])}",
                label=STANDARD_TOPICS[(seed + offset) % len(STANDARD_TOPICS)],
                source="standard",
            )
            for offset in range(STANDARD_TOPIC_COUNT)
        ]
        options = player_topics + standard_topics
        while len(options) < SHORTLIST_SIZE:
            filler_index = (seed + len(options)) % len(STANDARD_TOPICS)
            filler_label = STANDARD_TOPICS[filler_index]
            options.append(
                TopicOption(
                    id=f"standard-{topic_label_to_id(filler_label)}-{len(options)}",
                    label=filler_label,
                    source="standard",
                )
            )
        return options[:SHORTLIST_SIZE]

    def all_active_players_have_voted(self, room: Room) -> bool:
        topic_voting = room.topic_voting
        if topic_voting is None:
            return False
        active_ids = {player.id for player in room.players.values() if player.role != "spectator"}
        return bool(active_ids) and active_ids.issubset(topic_voting.votes.keys())

    async def finalize_topic_voting(self, room: Room) -> None:
        self._finalize_topic_voting_sync(room)
        await self.start_next_main_question(room)

    def _finalize_topic_voting_sync(self, room: Room) -> None:
        """Tallies votes, selects topics, and sets up the topic deck. Does NOT
        start the next question (which requires async LLM calls)."""
        topic_voting = self.require_topic_voting(room)
        approval_counts = {option.id: 0 for option in topic_voting.options}
        for vote in topic_voting.votes.values():
            for topic_id in vote.topic_ids:
                if topic_id in approval_counts:
                    approval_counts[topic_id] += 1
        sorted_options = sorted(
            topic_voting.options,
            key=lambda option: (-approval_counts.get(option.id, 0), option.label.lower()),
        )
        pool_size = room.settings.topic_pool_size
        if len(sorted_options) <= pool_size:
            selected_ids = [option.id for option in sorted_options]
            tie_break = None
        else:
            cutoff_count = approval_counts.get(sorted_options[pool_size - 1].id, 0)
            guaranteed = [
                option
                for option in sorted_options
                if approval_counts.get(option.id, 0) > cutoff_count
            ]
            tied = [
                option
                for option in sorted_options
                if approval_counts.get(option.id, 0) == cutoff_count
            ]
            remaining_slots = max(pool_size - len(guaranteed), 0)
            chosen_from_tie = list(tied)
            secrets.SystemRandom().shuffle(chosen_from_tie)
            chosen_from_tie = chosen_from_tie[:remaining_slots]
            selected_ids = [option.id for option in guaranteed + chosen_from_tie]
            tie_break = None
            if len(tied) > remaining_slots and remaining_slots > 0:
                tie_break = TopicTieBreak(
                    candidate_topic_ids=[option.id for option in tied],
                    chosen_topic_ids=[option.id for option in chosen_from_tie],
                    approval_count=cutoff_count,
                )
        topic_voting.status = "locked"
        topic_voting.selected_topic_ids = selected_ids
        topic_voting.tie_break = tie_break
        self.setup_topic_deck(room)

    def setup_topic_deck(self, room: Room) -> None:
        if room.progress is None or room.topic_voting is None:
            return
        room.progress.selected_topic_ids = list(room.topic_voting.selected_topic_ids)
        room.progress.upcoming_topic_ids = self.shuffled_topic_ids(
            room.topic_voting.selected_topic_ids
        )
        room.progress.used_topic_ids = []
        room.progress.skipped_topic_ids = []
        room.progress.failure_counts = {
            topic_id: 0 for topic_id in room.topic_voting.selected_topic_ids
        }
        room.progress.reshuffle_count = 0

    def shuffled_topic_ids(self, topic_ids: list[str]) -> list[str]:
        ordered = list(topic_ids)
        secrets.SystemRandom().shuffle(ordered)
        return ordered

    async def start_next_main_question(self, room: Room) -> None:
        if room.progress is None:
            return
        if self.should_finish_game(room):
            self.finish_game(
                room, "rounds_completed" if room.settings.end_mode == "rounds" else "timer_expired"
            )
            return
        next_topic_id = self.next_topic_id(room)
        if next_topic_id is None:
            self.finish_game(room, "rounds_completed")
            return
        topic_label = self.topic_label_by_id(room, next_topic_id)
        room.progress.round_index += 1
        room.progress.current_topic_id = next_topic_id
        room.progress.current_topic_label = topic_label
        room.phase = "question_loading"
        previous_prompts = [rec.prompt for rec in room.question_history]
        t0 = time.monotonic()
        question_payload = None
        attempts_used = 0
        for attempt in range(3):
            attempts_used = attempt + 1
            generated = await self.gameplay_generator.generate_question(
                room.settings.content_model_id,
                QuestionGenerationInput(
                    topic_id=next_topic_id,
                    topic_label=topic_label,
                    reveal_mode=room.settings.reveal_mode,
                    soft_filter_enabled=room.settings.moderation_mode != "off",
                    previous_prompts=previous_prompts,
                ),
            )
            if self.is_usable_question(generated.prompt, generated.answer):
                question_payload = generated
                room.progress.failure_counts[next_topic_id] = 0
                break
            room.progress.failure_counts[next_topic_id] = (
                room.progress.failure_counts.get(next_topic_id, 0) + 1
            )
            if room.progress.failure_counts[next_topic_id] >= 3:
                logger.warning(
                    "Topic skipped after 3 failures",
                    extra={
                        "event": "topic_skipped",
                        "room_code": room.code,
                        "topic_id": next_topic_id,
                        "topic_label": topic_label,
                    },
                )
                room.progress.skipped_topic_ids.append(next_topic_id)
                room.progress.upcoming_topic_ids = [
                    item for item in room.progress.upcoming_topic_ids if item != next_topic_id
                ]
                await self.start_next_main_question(room)
                return
        if question_payload is None:
            logger.warning(
                "Topic skipped: no usable question after retries",
                extra={
                    "event": "topic_skipped",
                    "room_code": room.code,
                    "topic_id": next_topic_id,
                    "topic_label": topic_label,
                },
            )
            room.progress.skipped_topic_ids.append(next_topic_id)
            room.progress.upcoming_topic_ids = [
                item for item in room.progress.upcoming_topic_ids if item != next_topic_id
            ]
            await self.start_next_main_question(room)
            return
        fact_card = await self.gameplay_generator.build_fact_card(question_payload)
        question = QuestionPrompt(
            id=make_id("question"),
            topic_id=next_topic_id,
            topic_label=topic_label,
            prompt=question_payload.prompt,
            prompt_chunks=self.chunk_prompt(question_payload.prompt),
            answer=question_payload.answer,
            acceptable_answers=question_payload.acceptable_answers,
            fact_card=fact_card,
        )
        room.current_question = MainQuestion(question=question, status="ready", asked_at=utc_now())
        room.buzz_state = None
        room.adjudication = Adjudication()
        self.reset_player_turn_flags(room)
        await self.prepare_narration(room, question.prompt)
        pipeline_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "Question pipeline complete",
            extra={
                "event": "question_pipeline",
                "room_code": room.code,
                "question_id": question.id,
                "topic": topic_label,
                "round_index": room.progress.round_index,
                "duration_ms": pipeline_ms,
                "attempts": attempts_used,
            },
        )

    def is_usable_question(self, prompt: str, answer: str) -> bool:
        return len(prompt.strip()) >= 20 and bool(answer.strip())

    def begin_question_reveal(self, room: Room) -> None:
        if room.current_question is None:
            return
        room.current_question.status = "active"
        room.current_question.reveal_started_at = (
            room.current_question.reveal_started_at or utc_now()
        )
        room.phase = (
            "question_reveal_progressive"
            if room.settings.reveal_mode == "progressive"
            else "question_reveal_full"
        )
        if room.settings.reveal_mode == "full":
            room.current_question.question.reveal_index = len(
                room.current_question.question.prompt_chunks
            )
            room.current_question.reveal_completed_at = utc_now() + timedelta(seconds=5)
        else:
            wait_ms = (
                room.narration.duration_ms
                if room.narration
                and room.narration.status == "ready"
                and room.narration.duration_ms
                else None
            )
            room.current_question.reveal_completed_at = utc_now() + timedelta(
                milliseconds=wait_ms or (len(room.current_question.question.prompt_chunks) * 2000)
            )

    def maybe_complete_reveal(self, room: Room) -> None:
        if room.current_question is None:
            return
        chunks = room.current_question.question.prompt_chunks
        if room.phase == "question_reveal_progressive":
            elapsed_ms = max(
                int(
                    (
                        utc_now() - (room.current_question.reveal_started_at or utc_now())
                    ).total_seconds()
                    * 1000
                ),
                0,
            )
            if (
                room.narration
                and room.narration.status == "ready"
                and room.narration.chunk_durations_ms
            ):
                # Reveal each chunk when its narration STARTS (with a small
                # lead so text appears just before the words are spoken).
                REVEAL_LEAD_MS = 150
                cumulative = 0
                reveal_index = 0
                step = max(len(room.narration.chunk_durations_ms) // max(len(chunks), 1), 1)
                for index in range(len(chunks)):
                    # Check BEFORE accumulating: does elapsed time reach
                    # the start of this chunk's audio?
                    if elapsed_ms + REVEAL_LEAD_MS >= cumulative:
                        reveal_index = index + 1
                    slice_end = min((index + 1) * step, len(room.narration.chunk_durations_ms))
                    cumulative += sum(room.narration.chunk_durations_ms[index * step : slice_end])
                room.current_question.question.reveal_index = max(
                    room.current_question.question.reveal_index, min(reveal_index, len(chunks))
                )
            else:
                room.current_question.question.reveal_index = min(
                    max(elapsed_ms // 2000, 0) + 1, len(chunks)
                )
            if room.current_question.question.reveal_index >= len(chunks):
                room.current_question.reveal_completed_at = utc_now()
                self.open_buzz(room, with_window=False)
        elif room.phase == "question_reveal_full":
            if (
                room.current_question.reveal_completed_at
                and utc_now() < room.current_question.reveal_completed_at
            ):
                return
            if room.buzz_state is None:
                room.buzz_state = BuzzState(
                    status="waiting",
                    opened_at=utc_now(),
                    deadline_at=utc_now() + timedelta(seconds=room.settings.no_buzz_window_seconds),
                    eligible_player_ids=self.active_player_ids(room),
                    locked_out_player_ids=[],
                )
            elif (
                room.buzz_state
                and room.buzz_state.deadline_at
                and utc_now() >= room.buzz_state.deadline_at
            ):
                self.open_buzz(room, with_window=True)

    def open_buzz(self, room: Room, with_window: bool) -> None:
        room.phase = "buzz_open"
        for player in room.players.values():
            player.can_buzz = player.role != "spectator"
            player.has_buzzed = False
            player.is_answering = False
        deadline = utc_now() + timedelta(seconds=room.settings.no_buzz_window_seconds)
        room.buzz_state = BuzzState(
            status="waiting",
            opened_at=utc_now(),
            deadline_at=deadline,
            eligible_player_ids=self.active_player_ids(room),
            locked_out_player_ids=[],
        )

    def maybe_transition_buzz_winner(self, room: Room) -> bool:
        """After a player buzzes, wait BUZZ_CELEBRATION_SECONDS then transition
        to the answering phase.  Returns True if the transition happened."""
        bs = room.buzz_state
        if bs is None or bs.status != "locked" or bs.winner_locked_at is None:
            return False
        elapsed = (utc_now() - bs.winner_locked_at).total_seconds()
        if elapsed < BUZZ_CELEBRATION_SECONDS:
            return False
        question = room.current_question
        if question is None:
            return False
        winner = room.players.get(bs.winner_player_id or "")
        if winner is None:
            return False
        # Transition to answering phase
        room.phase = "answering"
        question.answering_player_id = winner.id
        question.answering_deadline_at = utc_now() + timedelta(
            seconds=room.settings.main_answer_seconds
        )
        winner.is_answering = True
        return True

    def maybe_expire_buzz(self, room: Room) -> None:
        if room.buzz_state is None or utc_now() < (room.buzz_state.deadline_at or utc_now()):
            return
        room.buzz_state.status = "expired"
        if room.current_question:
            room.current_question.no_buzz_reason = "Nobody buzzed in time."
            room.current_question.result = "incorrect"
            room.current_question.grading_status = "complete"
            room.current_question.grading_reason = "No buzz received before the window closed."
            room.current_question.status = "resolved"
        self.prepare_score_reveal(room, "No buzz. Answer revealed.")

    async def _submit_main_answer(self, room: Room, player: Player, answer: str) -> None:
        question = room.current_question
        if question is None or question.answering_player_id != player.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="You are not the active answerer."
            )
        question.submitted_answer = answer
        player.is_answering = False
        room.phase = "grading"
        grade: GradingPayload | None = None
        last_error: Exception | None = None
        for attempt in range(2):
            question.retry_count = attempt
            try:
                grade = await self.gameplay_generator.grade_answer(
                    room.settings.grading_model_id,
                    question.question.prompt,
                    question.question.answer,
                    question.question.acceptable_answers,
                    answer,
                )
                break
            except Exception as exc:
                last_error = exc
        if grade is None:
            question.grading_status = "fallback_to_adjudication"
            question.grading_reason = (
                f"Automatic grading failed: {last_error}"
                if last_error
                else "Automatic grading failed."
            )
            self.start_adjudication(room, player.id)
            return
        question.grading_status = "complete"
        question.grading_reason = grade.reason
        if grade.decision == "correct":
            question.result = "correct"
            question.status = "resolved"
            player.score += 10
            room.score_events = [
                ScoreEvent(player_id=player.id, delta=10, reason="Main question correct")
            ]
            room.phase = "bonus_loading"
            room.bonus_chain = await self.build_bonus_chain(room, player.id)
        else:
            question.result = "incorrect"
            question.status = "resolved"
            if room.settings.reveal_mode == "progressive":
                player.score -= 5
                room.score_events = [
                    ScoreEvent(player_id=player.id, delta=-5, reason="Incorrect interruption")
                ]
            else:
                room.score_events = []
            player.can_buzz = False
            player.has_buzzed = True
            if room.buzz_state is None:
                room.buzz_state = BuzzState(
                    status="waiting",
                    eligible_player_ids=self.active_player_ids(room),
                    locked_out_player_ids=[],
                )
            room.buzz_state.locked_out_player_ids.append(player.id)
            room.buzz_state.status = "waiting"
            room.buzz_state.winner_player_id = None
            if self.remaining_buzzers(room):
                room.phase = "buzz_open"
                room.buzz_state.deadline_at = utc_now() + timedelta(seconds=8)
                if room.current_question:
                    room.current_question.answering_player_id = None
                    room.current_question.answering_deadline_at = None
                    room.current_question.question.interruption_index = (
                        room.current_question.question.reveal_index
                    )
                    if room.settings.reveal_mode == "progressive":
                        room.current_question.status = "active"
                        room.phase = "question_reveal_progressive"
            else:
                self.prepare_score_reveal(room, "Question resolved after incorrect answer.")

    async def build_bonus_chain(self, room: Room, player_id: str) -> BonusChain:
        assert room.current_question is not None
        bonuses = await self.gameplay_generator.generate_bonus_questions(
            room.settings.content_model_id,
            room.current_question.question.topic_label,
            room.current_question.question.answer,
            BONUS_QUESTION_COUNT,
        )
        questions = [
            BonusQuestion(
                id=make_id("bonus"),
                prompt=item.prompt,
                answer=item.answer,
                acceptable_answers=item.acceptable_answers,
            )
            for item in bonuses[:BONUS_QUESTION_COUNT]
        ]
        return BonusChain(
            awarded_player_id=player_id,
            source_question_id=room.current_question.question.id,
            current_index=0,
            total_questions=len(questions),
            questions=questions,
        )

    def begin_bonus_chain(self, room: Room) -> None:
        if room.bonus_chain is None:
            self.prepare_score_reveal(room, "Bonus generation unavailable.")
            return
        awarded = room.players.get(room.bonus_chain.awarded_player_id)
        if awarded:
            awarded.bonus_active = True
        room.phase = "bonus_answering"
        room.bonus_chain.answer_deadline_at = utc_now() + timedelta(
            seconds=room.settings.bonus_answer_seconds
        )
        # Defer narration to async caller (will be done outside the lock)
        narration_text = room.bonus_chain.questions[room.bonus_chain.current_index].prompt
        room._pending_narration_text = narration_text
        room.async_work_in_progress = True

    async def _submit_bonus_answer(self, room: Room, player: Player, answer: str) -> None:
        chain = room.bonus_chain
        if chain is None or chain.awarded_player_id != player.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="You are not the bonus player."
            )
        question = chain.questions[chain.current_index]
        question.submitted_answer = answer
        grade = await self.gameplay_generator.grade_answer(
            room.settings.grading_model_id,
            question.prompt,
            question.answer,
            question.acceptable_answers,
            answer,
        )
        question.grading_reason = grade.reason
        if grade.decision == "correct":
            question.result = "correct"
            player.score += 5
            room.score_events.append(
                ScoreEvent(
                    player_id=player.id, delta=5, reason=f"Bonus {chain.current_index + 1} correct"
                )
            )
        else:
            question.result = "incorrect"
        chain.current_index += 1
        if chain.current_index >= chain.total_questions:
            chain.completed = True
            player.bonus_active = False
            self.prepare_score_reveal(room, "Bonus chain completed.")
            return
        chain.answer_deadline_at = utc_now() + timedelta(seconds=room.settings.bonus_answer_seconds)
        # Defer narration to async caller (will be done outside the lock)
        room._pending_narration_text = chain.questions[chain.current_index].prompt
        room.async_work_in_progress = True

    def maybe_expire_main_answer(self, room: Room) -> None:
        if (
            room.current_question
            and room.current_question.answering_deadline_at
            and utc_now() >= room.current_question.answering_deadline_at
        ):
            room.current_question.submitted_answer = room.current_question.submitted_answer or ""
            room.current_question.grading_status = "complete"
            room.current_question.result = "incorrect"
            room.current_question.status = "resolved"
            room.current_question.grading_reason = "Answer window expired."
            player = room.players.get(room.current_question.answering_player_id or "")
            if player:
                player.is_answering = False
                player.can_buzz = False
                player.has_buzzed = True
            if self.remaining_buzzers(room):
                room.phase = "buzz_open"
                if room.buzz_state:
                    room.buzz_state.status = "waiting"
                    room.buzz_state.winner_player_id = None
                    room.buzz_state.deadline_at = utc_now() + timedelta(seconds=8)
                    if player and player.id not in room.buzz_state.locked_out_player_ids:
                        room.buzz_state.locked_out_player_ids.append(player.id)
            else:
                self.prepare_score_reveal(room, "Answer window expired.")

    def maybe_expire_bonus_answer(self, room: Room) -> None:
        chain = room.bonus_chain
        if chain and chain.answer_deadline_at and utc_now() >= chain.answer_deadline_at:
            chain.questions[chain.current_index].result = "incorrect"
            chain.questions[chain.current_index].grading_reason = "Bonus answer window expired."
            chain.current_index += 1
            if chain.current_index >= chain.total_questions:
                chain.completed = True
                awarded = room.players.get(chain.awarded_player_id)
                if awarded:
                    awarded.bonus_active = False
                self.prepare_score_reveal(room, "Bonus chain completed.")
            else:
                chain.answer_deadline_at = utc_now() + timedelta(
                    seconds=room.settings.bonus_answer_seconds
                )

    def finish_grading_if_resolved(self, room: Room) -> None:
        if room.adjudication.status == "resolved":
            if room.adjudication.resolved_decision == "accept":
                assert room.current_question is not None
                room.current_question.result = "adjudicated"
                room.current_question.status = "resolved"
                room.phase = "bonus_loading"
            elif room.adjudication.resolved_decision == "reject":
                self.prepare_score_reveal(room, "Adjudication resolved the question.")

    def start_adjudication(self, room: Room, subject_player_id: str) -> None:
        eligible_non_answering = [
            player.id
            for player in room.players.values()
            if player.role != "spectator" and player.id != subject_player_id and player.connected
        ]
        if subject_player_id == room.vip_player_id:
            if not eligible_non_answering:
                room.adjudication = Adjudication(
                    status="resolved",
                    mode="player_majority",
                    subject_player_id=subject_player_id,
                    resolved_decision="reject",
                    reason="No eligible voters were available for VIP adjudication.",
                )
                self.apply_adjudication_result(room, "reject")
                return
            room.adjudication = Adjudication(
                status="player_vote",
                mode="player_majority",
                subject_player_id=subject_player_id,
                prompt="The VIP's answer needs adjudication.",
                eligible_voter_ids=eligible_non_answering,
            )
        else:
            room.adjudication = Adjudication(
                status="vip_deciding",
                mode="vip_binary",
                subject_player_id=subject_player_id,
                prompt="Automatic grading failed. VIP must accept or reject.",
            )

    def try_finalize_player_vote_adjudication(self, room: Room) -> None:
        if room.adjudication.status != "player_vote":
            return
        accept_count = sum(1 for vote in room.adjudication.votes if vote.decision == "accept")
        reject_count = sum(1 for vote in room.adjudication.votes if vote.decision == "reject")
        majority = (len(room.adjudication.eligible_voter_ids) // 2) + 1
        if accept_count >= majority:
            decision: Literal["accept", "reject"] = "accept"
        elif reject_count >= majority:
            decision = "reject"
        elif len(room.adjudication.votes) < len(room.adjudication.eligible_voter_ids):
            return
        else:
            decision = "accept" if accept_count > reject_count else "reject"
        room.adjudication.status = "resolved"
        room.adjudication.resolved_decision = decision
        room.adjudication.reason = "Player majority vote resolved adjudication."
        self.apply_adjudication_result(room, decision)

    def apply_adjudication_result(self, room: Room, decision: Literal["accept", "reject"]) -> None:
        if room.current_question is None:
            return
        player_id = room.current_question.answering_player_id
        player = room.players.get(player_id or "")
        if decision == "accept" and player is not None:
            player.score += 10
            room.score_events = [
                ScoreEvent(player_id=player.id, delta=10, reason="Accepted after adjudication")
            ]
            room.current_question.status = "resolved"
            room.phase = "bonus_loading"
        else:
            room.score_events = []
            self.prepare_score_reveal(room, "Adjudication rejected the answer.")

    def prepare_score_reveal(self, room: Room, headline: str) -> None:
        if room.current_question is not None:
            room.question_history.append(
                SummaryQuestionRecord(
                    question_id=room.current_question.question.id,
                    topic_label=room.current_question.question.topic_label,
                    prompt=room.current_question.question.prompt,
                    submitted_answer=room.current_question.submitted_answer,
                    correct_answer=room.current_question.question.answer,
                    grading_reason=room.current_question.grading_reason,
                    fact_card=room.current_question.question.fact_card,
                    result=room.current_question.result,
                    answering_player_id=room.current_question.answering_player_id,
                    score_events=list(room.score_events),
                    bonus_awarded_player_id=(
                        room.bonus_chain.awarded_player_id if room.bonus_chain else None
                    ),
                    bonus_questions=(list(room.bonus_chain.questions) if room.bonus_chain else []),
                )
            )
        room.phase = "score_reveal"
        room.score_headline = headline
        room.last_resolved_question = room.current_question
        if room.progress:
            room.progress.completed_rounds += 1
            room.progress.main_questions_completed += 1
            if room.progress.current_topic_id:
                room.progress.used_topic_ids.append(room.progress.current_topic_id)
                room.progress.upcoming_topic_ids = [
                    item
                    for item in room.progress.upcoming_topic_ids
                    if item != room.progress.current_topic_id
                ]
        if room.bonus_chain and room.bonus_chain.completed:
            awarded = room.players.get(room.bonus_chain.awarded_player_id)
            if awarded:
                awarded.bonus_active = False
        room.current_question = None
        room.buzz_state = None
        room.adjudication = Adjudication()
        room.bonus_chain = None

    def advance_after_score_reveal(self, room: Room) -> None:
        if self.should_finish_game(room):
            self.finish_game(
                room, "rounds_completed" if room.settings.end_mode == "rounds" else "timer_expired"
            )
            return
        if room.current_question is None:
            room.score_headline = room.score_headline or "Standings updated."
            if room.progress and room.progress.current_topic_id:
                room.progress.current_topic_id = None
                room.progress.current_topic_label = None
            room.phase = "question_loading"

    def should_finish_game(self, room: Room) -> bool:
        if room.progress is None:
            return False
        if room.settings.end_mode == "rounds":
            return room.progress.completed_rounds >= room.settings.rounds_count
        if room.progress.timer_expired:
            if room.settings.timer_expiry_mode == "finish_round":
                return room.phase == "score_reveal"
            if room.settings.timer_expiry_mode == "finish_main_only":
                return room.phase in {"score_reveal", "bonus_loading", "bonus_answering"}
            return True
        return False

    def finish_game(
        self,
        room: Room,
        reason: Literal[
            "rounds_completed", "timer_expired", "vip_disconnected_timeout", "manual_reset"
        ],
    ) -> None:
        room.phase = "finished"
        standings = self.build_standings(room)
        top_score = standings[0].score if standings else 0
        winners = [entry.player_id for entry in standings if entry.score == top_score]
        room.score_headline = room.score_headline or "Match complete."
        room.summary_id = room.summary_id or make_id("summary")
        room.finished = FinishedState(
            reason=reason,
            winners=winners,
            standings=standings,
            finished_at=utc_now(),
            summary_id=room.summary_id,
        )
        game_duration_ms = None
        if room.progress and room.progress.game_started_at:
            game_duration_ms = int(
                (utc_now() - room.progress.game_started_at).total_seconds() * 1000
            )
        logger.info(
            "Game finished",
            extra={
                "event": "game_finished",
                "room_code": room.code,
                "reason": reason,
                "winner_count": len(winners),
                "top_score": top_score,
                "round_index": room.progress.round_index if room.progress else 0,
                "game_duration_ms": game_duration_ms,
            },
        )
        GAMES_FINISHED.labels(reason=reason).inc()

    async def tick_room(self, room_code: str) -> RoomStateResponse:
        lock = self._get_room_lock(room_code)
        async_work: str | None = None

        # --- Phase 1: advance state under lock, detect if async work needed ---
        async with lock:
            room = await self.load_room(room_code)
            previous_phase = room.phase
            self.advance_room_state(room)

            # Check if eager topic task completed (A4)
            if (
                room.phase == "topic_voting"
                and previous_phase == "intro"
                and room.topic_voting is None
                and room._topic_task is not None
                and room._topic_task.done()
            ):
                try:
                    room.topic_voting = room._topic_task.result()
                except Exception as exc:
                    logger.warning(
                        "Eager topic task failed in tick_room: %s",
                        exc,
                        extra={
                            "event": "eager_topic_failed",
                            "room_code": room_code,
                            "error": str(exc),
                        },
                    )
                    room._topic_task = None
                    # Fall through to generate topics normally
                else:
                    room._topic_task = None

            # Drain deferred narration (e.g. begin_bonus_chain set _pending_narration_text)
            narration_result = await self.drain_pending_narration(room, room_code, lock)

            # Determine what async work is needed (skip if already in progress)
            if not room.async_work_in_progress:
                if room.phase == "question_loading" and previous_phase == "score_reveal":
                    async_work = "next_question"
                elif room.phase == "question_loading" and room.current_question is None:
                    async_work = "next_question"
                elif (
                    room.phase == "topic_voting"
                    and previous_phase == "intro"
                    and room.topic_voting is None
                ):
                    async_work = "topic_voting"

                if async_work:
                    room.async_work_in_progress = True

            room.updated_at = utc_now()
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)

            if room.finished and room.summary_id:
                await self.persistence.save_game_history(
                    room.code, self.build_game_summary(room).model_dump(mode="json")
                )

            if not async_work:
                return room_state

        # --- Phase 2: do async work WITHOUT lock ---
        try:
            if async_work == "next_question":
                await self.start_next_main_question(room)
            elif async_work == "topic_voting":
                room.topic_voting = await self.build_topic_voting(room)
        except Exception as exc:
            logger.warning(
                "Async work failed in tick_room (type=%s): %s",
                async_work,
                exc,
                extra={
                    "event": "tick_async_failed",
                    "room_code": room_code,
                    "async_work": async_work,
                    "error": str(exc),
                },
            )

        # --- Phase 3: apply results and clear flag under lock ---
        async with lock:
            room.async_work_in_progress = False
            room.updated_at = utc_now()
            self.advance_room_state(room)
            narration_result = await self.drain_pending_narration(room, room_code, lock)
            if narration_result is not None:
                return narration_result
            room_state = self.serialize_room(room)
            await self.persist_room(room, room_state)
            return room_state

    def build_game_summary(self, room: Room) -> GameSummaryResponse:
        if room.finished is None or room.summary_id is None:
            raise RuntimeError("Room has no finished summary to serialize.")
        players_by_id = {player.id: player for player in room.players.values()}
        selected_topics = []
        if room.topic_voting:
            selected_topics = [
                topic.label
                for topic in room.topic_voting.options
                if topic.id in room.topic_voting.selected_topic_ids
            ]
        return GameSummaryResponse(
            summary_id=room.summary_id,
            room_code=room.code,
            created_at=room.created_at,
            finished_at=room.finished.finished_at,
            reason=room.finished.reason,
            winners=room.finished.winners,
            selected_topics=selected_topics,
            players=[
                SummaryPlayerState(
                    player_id=entry.player_id,
                    name=players_by_id[entry.player_id].name
                    if entry.player_id in players_by_id
                    else entry.player_id,
                    color=players_by_id[entry.player_id].color
                    if entry.player_id in players_by_id
                    else "unknown",
                    score=entry.score,
                    rank=entry.rank,
                )
                for entry in room.finished.standings
            ],
            questions=[
                SummaryQuestionState(
                    question_id=item.question_id,
                    topic_label=item.topic_label,
                    prompt=item.prompt,
                    submitted_answer=item.submitted_answer,
                    correct_answer=item.correct_answer,
                    grading_reason=item.grading_reason,
                    fact_card=item.fact_card,
                    result=item.result,
                    answering_player_id=item.answering_player_id,
                    score_events=[
                        ScoreEventState(
                            player_id=event.player_id, delta=event.delta, reason=event.reason
                        )
                        for event in item.score_events
                    ],
                    bonus_awarded_player_id=item.bonus_awarded_player_id,
                    bonus_questions=[
                        SummaryBonusQuestionState(
                            prompt=bonus.prompt,
                            submitted_answer=bonus.submitted_answer,
                            correct_answer=bonus.answer,
                            grading_reason=bonus.grading_reason,
                            result=bonus.result,
                        )
                        for bonus in item.bonus_questions
                    ],
                )
                for item in room.question_history
            ],
        )

    def next_topic_id(self, room: Room) -> str | None:
        if room.progress is None:
            return None
        if room.progress.upcoming_topic_ids:
            return room.progress.upcoming_topic_ids[0]
        if not room.progress.selected_topic_ids:
            return None
        room.progress.reshuffle_count += 1
        room.progress.upcoming_topic_ids = self.shuffled_topic_ids(room.progress.selected_topic_ids)
        return room.progress.upcoming_topic_ids[0] if room.progress.upcoming_topic_ids else None

    def topic_label_by_id(self, room: Room, topic_id: str) -> str:
        if room.topic_voting:
            for option in room.topic_voting.options:
                if option.id == topic_id:
                    return option.label
        return topic_id.replace("-", " ").title()

    def chunk_prompt(self, prompt: str) -> list[str]:
        words = prompt.split()
        chunk_size = 5
        return [
            " ".join(words[index : index + chunk_size])
            for index in range(0, len(words), chunk_size)
        ] or [prompt]

    async def prepare_narration(self, room: Room, text: str) -> None:
        if not room.settings.narration_enabled:
            room.narration = self.narration_service.build_disabled_cue(text)
            return
        cue = await self.narration_service.synthesize(text)
        room.narration = cue

    async def drain_pending_narration(
        self, room: Room, room_code: str, lock: asyncio.Lock
    ) -> RoomStateResponse | None:
        """If a synchronous method deferred narration via _pending_narration_text,
        release the lock, synthesize TTS, re-acquire lock, and apply the result.
        Returns the updated room state, or None if no narration was pending."""
        narration_text = room._pending_narration_text
        if narration_text is None:
            return None

        logger.info(
            "Draining pending narration",
            extra={
                "event": "drain_narration",
                "room_code": room_code,
                "text_len": len(narration_text),
            },
        )

        # Persist current state before releasing so clients see the phase change
        room_state = self.serialize_room(room)
        await self.persist_room(room, room_state)

        # --- Release lock, do async TTS ---
        # (lock context manager is NOT used here — caller must manually release/acquire)
        lock.release()
        try:
            await self.prepare_narration(room, narration_text)
        finally:
            await lock.acquire()

        # Apply narration result and clear flag
        room._pending_narration_text = None
        room.async_work_in_progress = False
        room.updated_at = utc_now()
        room_state = self.serialize_room(room)
        await self.persist_room(room, room_state)
        return room_state

    async def get_summary(self, summary_id: str) -> GameSummaryResponse | None:
        return await self.persistence.get_game_summary(summary_id)

    def reset_player_turn_flags(self, room: Room) -> None:
        for player in room.players.values():
            player.can_buzz = player.role != "spectator"
            player.has_buzzed = False
            player.is_answering = False

    def remaining_buzzers(self, room: Room) -> bool:
        return any(
            player.role != "spectator" and player.can_buzz and not player.has_buzzed
            for player in room.players.values()
        )

    def active_player_ids(self, room: Room) -> list[str]:
        return [player.id for player in room.players.values() if player.role != "spectator"]

    def clone_settings(self, settings: RoomSettings) -> RoomSettings:
        return RoomSettings(
            model_preset_id=settings.model_preset_id,
            content_model_id=settings.content_model_id,
            grading_model_id=settings.grading_model_id,
            topic_pool_size=settings.topic_pool_size,
            reveal_mode=settings.reveal_mode,
            end_mode=settings.end_mode,
            rounds_count=settings.rounds_count,
            timer_minutes=settings.timer_minutes,
            timer_expiry_mode=settings.timer_expiry_mode,
            main_answer_seconds=settings.main_answer_seconds,
            no_buzz_window_seconds=settings.no_buzz_window_seconds,
            bonus_answer_seconds=settings.bonus_answer_seconds,
            moderation_mode=settings.moderation_mode,
            narration_enabled=settings.narration_enabled,
            sound_effects_enabled=settings.sound_effects_enabled,
            music_enabled=settings.music_enabled,
        )

    def build_standings(self, room: Room) -> list[StandingsEntryState]:
        ordered = sorted(
            (player for player in room.players.values() if player.role != "spectator"),
            key=lambda player: (-player.score, player.joined_at),
        )
        standings: list[StandingsEntryState] = []
        rank = 0
        previous_score: int | None = None
        for index, player in enumerate(ordered, start=1):
            if previous_score != player.score:
                rank = index
                previous_score = player.score
            standings.append(
                StandingsEntryState(player_id=player.id, score=player.score, rank=rank)
            )
        return standings

    def serialize_settings(self, settings: RoomSettings) -> RoomSettingsState:
        return RoomSettingsState(
            model_preset_id=settings.model_preset_id,
            content_model_id=settings.content_model_id,
            grading_model_id=settings.grading_model_id,
            topic_pool_size=settings.topic_pool_size,
            reveal_mode=settings.reveal_mode,
            end_mode=settings.end_mode,
            rounds_count=settings.rounds_count,
            timer_minutes=settings.timer_minutes,
            timer_expiry_mode=settings.timer_expiry_mode,
            main_answer_seconds=settings.main_answer_seconds,
            no_buzz_window_seconds=settings.no_buzz_window_seconds,
            bonus_answer_seconds=settings.bonus_answer_seconds,
            moderation_mode=settings.moderation_mode,
            audio=AudioSettings(
                narration_enabled=settings.narration_enabled,
                sound_effects_enabled=settings.sound_effects_enabled,
                music_enabled=settings.music_enabled,
            ),
        )

    def serialize_topic_voting(self, room: Room) -> TopicVotingState | None:
        if room.topic_voting is None:
            return None
        topic_voting = room.topic_voting
        approval_counts = {option.id: 0 for option in topic_voting.options}
        for vote in topic_voting.votes.values():
            for topic_id in vote.topic_ids:
                if topic_id in approval_counts:
                    approval_counts[topic_id] += 1
        option_lookup = {option.id: option for option in topic_voting.options}
        selected_topics = [
            option_lookup[topic_id]
            for topic_id in topic_voting.selected_topic_ids
            if topic_id in option_lookup
        ]
        pending = [
            player.name
            for player in sorted(room.players.values(), key=lambda player: player.joined_at)
            if player.role != "spectator" and player.id not in topic_voting.votes
        ]
        return TopicVotingState(
            status=topic_voting.status,
            rerolls_remaining=topic_voting.rerolls_remaining,
            max_approvals_per_player=topic_voting.max_approvals_per_player,
            options=[
                TopicOptionState(
                    id=option.id,
                    label=option.label,
                    source=option.source,
                    approval_count=approval_counts.get(option.id, 0),
                )
                for option in topic_voting.options
            ],
            votes=[
                TopicVoteState(
                    player_id=vote.player_id,
                    topic_ids=vote.topic_ids,
                    submitted_at=vote.submitted_at,
                )
                for vote in sorted(topic_voting.votes.values(), key=lambda vote: vote.submitted_at)
            ],
            players_pending=pending,
            selected_topic_ids=topic_voting.selected_topic_ids,
            selected_topics=[
                TopicOptionState(
                    id=option.id,
                    label=option.label,
                    source=option.source,
                    approval_count=approval_counts.get(option.id, 0),
                )
                for option in selected_topics
            ],
            tie_break=(
                TopicTieBreakState(
                    candidate_topic_ids=topic_voting.tie_break.candidate_topic_ids,
                    chosen_topic_ids=topic_voting.tie_break.chosen_topic_ids,
                    approval_count=topic_voting.tie_break.approval_count,
                )
                if topic_voting.tie_break
                else None
            ),
        )

    def serialize_room(self, room: Room) -> RoomStateResponse:
        ordered_players = sorted(room.players.values(), key=lambda player: player.joined_at)
        players = [
            PlayerState(
                id=player.id,
                name=player.name,
                color=player.color,
                expertise=player.expertise,
                role=player.role,
                ready=player.ready,
                connected=player.connected,
                joined_at=player.joined_at,
                score=player.score,
                can_buzz=player.can_buzz,
                has_buzzed=player.has_buzzed,
                is_answering=player.is_answering,
                bonus_active=player.bonus_active,
            )
            for player in ordered_players
        ]
        blockers = self.start_blockers(room)
        progress = None
        if room.progress:
            progress = GameProgressState(
                round_index=room.progress.round_index,
                completed_rounds=room.progress.completed_rounds,
                main_questions_completed=room.progress.main_questions_completed,
                current_topic_id=room.progress.current_topic_id,
                current_topic_label=room.progress.current_topic_label,
                topic_deck=TopicDeckState(
                    selected_topic_ids=room.progress.selected_topic_ids,
                    upcoming_topic_ids=room.progress.upcoming_topic_ids,
                    used_topic_ids=room.progress.used_topic_ids,
                    skipped_topic_ids=room.progress.skipped_topic_ids,
                    failure_counts=room.progress.failure_counts,
                    reshuffle_count=room.progress.reshuffle_count,
                ),
                game_clock=(
                    GameClockState(
                        started_at=room.progress.game_started_at or room.created_at,
                        deadline_at=room.progress.game_deadline_at,
                        expired=room.progress.timer_expired,
                    )
                    if room.progress.game_started_at
                    else None
                ),
            )
        current_question = None
        if room.current_question:
            current_question = MainQuestionState(
                question=QuestionPromptState(
                    id=room.current_question.question.id,
                    topic_id=room.current_question.question.topic_id,
                    topic_label=room.current_question.question.topic_label,
                    prompt=room.current_question.question.prompt,
                    prompt_chunks=room.current_question.question.prompt_chunks,
                    fact_card=room.current_question.question.fact_card,
                    reveal_index=room.current_question.question.reveal_index,
                    interruption_index=room.current_question.question.interruption_index,
                    source_attempt=room.current_question.question.source_attempt,
                ),
                status=room.current_question.status,
                asked_at=room.current_question.asked_at,
                reveal_started_at=room.current_question.reveal_started_at,
                reveal_completed_at=room.current_question.reveal_completed_at,
                buzz_opened_at=room.current_question.buzz_opened_at,
                buzz_deadline_at=room.current_question.buzz_deadline_at,
                answering_player_id=room.current_question.answering_player_id,
                answering_deadline_at=room.current_question.answering_deadline_at,
                submitted_answer=room.current_question.submitted_answer,
                result=room.current_question.result,
                grading_status=room.current_question.grading_status,
                grading_reason=room.current_question.grading_reason,
                retry_count=room.current_question.retry_count,
                no_buzz_reason=room.current_question.no_buzz_reason,
            )
        buzz_state = None
        if room.buzz_state:
            buzz_state = BuzzStateResponse(
                status=room.buzz_state.status,
                opened_at=room.buzz_state.opened_at,
                deadline_at=room.buzz_state.deadline_at,
                winner_player_id=room.buzz_state.winner_player_id,
                winner_locked_at=room.buzz_state.winner_locked_at,
                eligible_player_ids=room.buzz_state.eligible_player_ids,
                locked_out_player_ids=room.buzz_state.locked_out_player_ids,
                buzz_order=room.buzz_state.buzz_order,
            )
        bonus_chain = None
        if room.bonus_chain:
            bonus_chain = BonusChainState(
                awarded_player_id=room.bonus_chain.awarded_player_id,
                source_question_id=room.bonus_chain.source_question_id,
                current_index=room.bonus_chain.current_index,
                total_questions=room.bonus_chain.total_questions,
                questions=[
                    BonusQuestionState(
                        id=item.id,
                        prompt=item.prompt,
                        grading_reason=item.grading_reason,
                        submitted_answer=item.submitted_answer,
                        result=item.result,
                    )
                    for item in room.bonus_chain.questions
                ],
                answer_deadline_at=room.bonus_chain.answer_deadline_at,
                completed=room.bonus_chain.completed,
            )
        score_reveal = None
        if room.phase in {"score_reveal", "finished"}:
            resolved_question = None
            if room.last_resolved_question:
                resolved_question = ResolvedQuestionState(
                    topic_label=room.last_resolved_question.question.topic_label,
                    prompt=room.last_resolved_question.question.prompt,
                    submitted_answer=room.last_resolved_question.submitted_answer,
                    correct_answer=room.last_resolved_question.question.answer,
                    grading_reason=room.last_resolved_question.grading_reason,
                    fact_card=room.last_resolved_question.question.fact_card,
                    result=room.last_resolved_question.result,
                    answering_player_id=room.last_resolved_question.answering_player_id,
                )
            score_reveal = ScoreRevealState(
                headline=room.score_headline or "Standings updated.",
                events=[
                    ScoreEventState(player_id=item.player_id, delta=item.delta, reason=item.reason)
                    for item in room.score_events
                ],
                standings=self.build_standings(room),
                resolved_question=resolved_question,
                next_topic_label=(
                    self.topic_label_by_id(room, room.progress.upcoming_topic_ids[0])
                    if room.progress and room.progress.upcoming_topic_ids
                    else None
                ),
                next_round_index=(room.progress.round_index + 1 if room.progress else None),
            )
        adjudication = AdjudicationState(
            status=room.adjudication.status,
            mode=room.adjudication.mode,
            subject_player_id=room.adjudication.subject_player_id,
            prompt=room.adjudication.prompt,
            eligible_voter_ids=room.adjudication.eligible_voter_ids,
            votes=[
                AdjudicationVoteState(
                    player_id=vote.player_id, decision=vote.decision, submitted_at=vote.submitted_at
                )
                for vote in room.adjudication.votes
            ],
            resolved_decision=room.adjudication.resolved_decision,
            reason=room.adjudication.reason,
        )
        snapshot = (
            GameConfigSnapshotState(
                model_preset_id=room.game_config_snapshot.model_preset_id,
                content_model_id=room.game_config_snapshot.content_model_id,
                grading_model_id=room.game_config_snapshot.grading_model_id,
                settings=self.serialize_settings(room.game_config_snapshot),
            )
            if room.game_config_snapshot
            else None
        )
        return RoomStateResponse(
            code=room.code,
            phase=room.phase,
            created_at=room.created_at,
            updated_at=room.updated_at,
            display_connected=room.display_connection_count > 0,
            settings_locked=room.settings_locked,
            vip_player_id=room.vip_player_id,
            players=players,
            settings=self.serialize_settings(room.settings),
            active_player_count=sum(1 for player in ordered_players if player.role != "spectator"),
            spectator_count=sum(1 for player in ordered_players if player.role == "spectator"),
            can_start=len(blockers) == 0,
            start_blockers=blockers,
            topic_voting=self.serialize_topic_voting(room),
            game_config_snapshot=snapshot,
            progress=progress,
            current_question=current_question,
            buzz_state=buzz_state,
            adjudication=adjudication,
            bonus_chain=bonus_chain,
            score_reveal=score_reveal,
            pause_state=room.pause_state,
            narration=room.narration,
            finished=room.finished,
            intro_deadline_at=room.intro_deadline_at,
        )

    def _generate_room_code(self) -> str:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        while True:
            code = "".join(
                secrets.choice(alphabet) for _ in range(self.app_config.room.code_length)
            )
            if code not in self.rooms:
                return code
