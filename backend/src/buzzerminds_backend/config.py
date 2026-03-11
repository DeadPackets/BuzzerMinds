from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator


RevealMode = Literal["progressive", "full"]
EndMode = Literal["rounds", "timer"]
TimerExpiryMode = Literal["finish_round", "finish_main_only", "stop_immediately"]
ModelRole = Literal["content", "grading"]


class AppInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    public_base_url: str


class ModelCatalogEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    label: str
    roles: list[ModelRole]
    experimental: bool = False


class ModelPreset(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    label: str
    description: str
    content_model: str
    grading_model: str
    visible: bool = True


class ModelsConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    default_preset: str
    catalog: list[ModelCatalogEntry]
    presets: list[ModelPreset]


class OpenRouterConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    api_key_env: str = "OPENROUTER_API_KEY"
    base_url: str = "https://openrouter.ai/api/v1"
    timeout_seconds: int = 20


class ElevenLabsConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    api_key_env: str = "ELEVENLABS_API_KEY"
    voice_id: str = "JBFqnCBsd6RMkjVDRZzb"
    model_id: str = "eleven_multilingual_v2"
    output_format: str = "mp3_44100_128"
    timeout_seconds: int = 20


class ProvidersConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    openrouter: OpenRouterConfig = Field(default_factory=OpenRouterConfig)
    elevenlabs: ElevenLabsConfig = Field(default_factory=ElevenLabsConfig)


class RoomConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    hard_max_players: int
    code_length: int = 6
    lobby_idle_ttl_minutes: int = 120
    finished_room_ttl_minutes: int = 30


class LobbyConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    min_players_to_start: int


class NumericRange(BaseModel):
    model_config = ConfigDict(extra="ignore")

    min: int
    max: int
    default: int

    @model_validator(mode="after")
    def validate_default(self) -> "NumericRange":
        if self.min > self.max:
            raise ValueError("Range min must be less than or equal to max.")
        if not self.min <= self.default <= self.max:
            raise ValueError("Range default must be within min/max.")
        return self


class SettingsDefaults(BaseModel):
    model_config = ConfigDict(extra="ignore")

    reveal_mode: RevealMode
    end_mode: EndMode
    timer_expiry_mode: TimerExpiryMode
    moderation_mode: Literal["off", "light", "family_safe"]
    narration_enabled: bool
    sound_effects_enabled: bool
    music_enabled: bool


class SettingsLimits(BaseModel):
    model_config = ConfigDict(extra="ignore")

    topic_pool_size: NumericRange
    rounds_count: NumericRange
    timer_minutes: NumericRange
    main_answer_seconds: NumericRange
    no_buzz_window_seconds: NumericRange
    bonus_answer_seconds: NumericRange


class SettingsConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    defaults: SettingsDefaults
    limits: SettingsLimits


class RetrievalConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    backend: str = "none"
    timeout_seconds: int = 5
    searxng_url_env: str = "SEARXNG_BASE_URL"


class PersistenceConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    backend: str = "postgres"
    postgres_url_env: str = "DATABASE_URL"


class TelemetryConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    structured_logs: bool = True


class RuntimeConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    room_tick_interval_ms: int = 500


class SecurityRateLimits(BaseModel):
    model_config = ConfigDict(extra="ignore")

    create_room_per_minute: int = 12
    join_room_per_minute: int = 60
    room_read_per_minute: int = 240
    room_action_per_minute: int = 180
    websocket_connect_per_minute: int = 60


class SecurityConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    trusted_hosts: list[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1"])
    allowed_origins: list[str] = Field(default_factory=list)
    enforce_https: bool = False
    bind_player_actions_to_client_id: bool = True
    rate_limits: SecurityRateLimits = Field(default_factory=SecurityRateLimits)


class TurnstileConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    secret_key_env: str = "TURNSTILE_SECRET_KEY"
    site_key_env: str = "NEXT_PUBLIC_TURNSTILE_SITE_KEY"
    verify_url: str = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    version: int = 1
    app: AppInfo
    providers: ProvidersConfig = Field(default_factory=ProvidersConfig)
    models: ModelsConfig
    room: RoomConfig
    lobby: LobbyConfig
    settings: SettingsConfig
    retrieval: RetrievalConfig = Field(default_factory=RetrievalConfig)
    persistence: PersistenceConfig = Field(default_factory=PersistenceConfig)
    telemetry: TelemetryConfig = Field(default_factory=TelemetryConfig)
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)
    security: SecurityConfig = Field(default_factory=SecurityConfig)
    turnstile: TurnstileConfig = Field(default_factory=TurnstileConfig)

    @model_validator(mode="after")
    def validate_model_references(self) -> "AppConfig":
        catalog_map = {entry.id: entry for entry in self.models.catalog}
        preset_ids = {preset.id for preset in self.models.presets}

        if self.models.default_preset not in preset_ids:
            raise ValueError(f"Unknown default model preset: {self.models.default_preset}")

        for preset in self.models.presets:
            content_model = catalog_map.get(preset.content_model)
            grading_model = catalog_map.get(preset.grading_model)

            if content_model is None:
                raise ValueError(
                    f"Unknown content model in preset {preset.id}: {preset.content_model}"
                )
            if grading_model is None:
                raise ValueError(
                    f"Unknown grading model in preset {preset.id}: {preset.grading_model}"
                )
            if "content" not in content_model.roles:
                raise ValueError(f"Model {preset.content_model} cannot be used as a content model.")
            if "grading" not in grading_model.roles:
                raise ValueError(f"Model {preset.grading_model} cannot be used as a grading model.")
        return self

    @property
    def visible_presets(self) -> list[ModelPreset]:
        return [preset for preset in self.models.presets if preset.visible]

    @property
    def default_preset(self) -> ModelPreset:
        for preset in self.models.presets:
            if preset.id == self.models.default_preset:
                return preset
        raise RuntimeError("Default preset is missing")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def load_dotenv_file() -> None:
    env_path = repo_root() / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        if key:
            os.environ.setdefault(key, value.strip())


def config_path() -> Path:
    load_dotenv_file()
    configured = os.getenv("BUZZERMINDS_CONFIG_PATH")
    if configured:
        return Path(configured).expanduser().resolve()
    return repo_root() / "config.yml"


@lru_cache(maxsize=1)
def get_app_config() -> AppConfig:
    path = config_path()
    with path.open("r", encoding="utf-8") as handle:
        raw = yaml.safe_load(handle) or {}
    return AppConfig.model_validate(raw)
