from __future__ import annotations

import base64
import os

from elevenlabs.client import ElevenLabs
from elevenlabs.core.request_options import RequestOptions

from .config import AppConfig
from .schemas import NarrationCueState


class ElevenLabsNarrationService:
    def __init__(self, app_config: AppConfig) -> None:
        self.app_config = app_config
        self.provider_config = app_config.providers.elevenlabs

    def build_disabled_cue(self, text: str) -> NarrationCueState:
        return NarrationCueState(status="disabled", text=text)

    def synthesize(self, text: str) -> NarrationCueState:
        api_key = os.getenv(self.provider_config.api_key_env, "").strip()
        if not api_key:
            return NarrationCueState(
                status="failed",
                text=text,
                error=f"Missing {self.provider_config.api_key_env}",
            )

        try:
            client = ElevenLabs(api_key=api_key)
            response = client.text_to_speech.convert_with_timestamps(
                voice_id=self.provider_config.voice_id,
                text=text,
                model_id=self.provider_config.model_id,
                output_format=self.provider_config.output_format,
                request_options=RequestOptions(
                    timeout_in_seconds=self.provider_config.timeout_seconds
                ),
            )
            alignment = response.normalized_alignment or response.alignment
            chunk_durations_ms: list[int] = []
            duration_ms = 0
            if alignment is not None:
                pairs = zip(
                    alignment.character_start_times_seconds,
                    alignment.character_end_times_seconds,
                    strict=False,
                )
                chunk_durations_ms = [max(int((end - start) * 1000), 0) for start, end in pairs]
                if alignment.character_end_times_seconds:
                    duration_ms = int(alignment.character_end_times_seconds[-1] * 1000)

            return NarrationCueState(
                status="ready",
                text=text,
                voice_id=self.provider_config.voice_id,
                model_id=self.provider_config.model_id,
                audio_base64=response.audio_base_64,
                mime_type=self._mime_type_for_format(self.provider_config.output_format),
                duration_ms=duration_ms or None,
                chunk_durations_ms=chunk_durations_ms,
            )
        except Exception as exc:
            return NarrationCueState(status="failed", text=text, error=str(exc))

    def _mime_type_for_format(self, output_format: str) -> str:
        if output_format.startswith("mp3"):
            return "audio/mpeg"
        if output_format.startswith("wav"):
            return "audio/wav"
        if output_format.startswith("opus"):
            return "audio/opus"
        if output_format.startswith("pcm"):
            return "audio/pcm"
        return "application/octet-stream"

    def to_bytes(self, cue: NarrationCueState) -> bytes:
        if not cue.audio_base64:
            return b""
        return base64.b64decode(cue.audio_base64)
