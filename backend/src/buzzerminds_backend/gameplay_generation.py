from __future__ import annotations

import logging
import os
import re
import secrets
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_ai import Agent
from pydantic_ai.models.openrouter import OpenRouterModel
from pydantic_ai.providers.openrouter import OpenRouterProvider

from .config import AppConfig
from .retrieval import RetrievalService
from .schemas import FactCardState

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class QuestionGenerationInput:
    topic_id: str
    topic_label: str
    reveal_mode: str
    soft_filter_enabled: bool


class GeneratedQuestionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=20, max_length=500)
    answer: str = Field(min_length=1, max_length=160)
    acceptable_answers: list[str] = Field(min_length=1, max_length=6)
    fact_headline: str = Field(min_length=3, max_length=120)
    fact_detail: str = Field(min_length=10, max_length=220)

    @field_validator("acceptable_answers")
    @classmethod
    def normalize_answers(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in value:
            normalized = " ".join(item.split())
            key = normalized.casefold()
            if normalized and key not in seen:
                cleaned.append(normalized)
                seen.add(key)
        if not cleaned:
            raise ValueError("At least one acceptable answer is required.")
        return cleaned


class GeneratedBonusPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=10, max_length=220)
    answer: str = Field(min_length=1, max_length=120)
    acceptable_answers: list[str] = Field(min_length=1, max_length=4)


class GradingPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: str = Field(pattern="^(correct|incorrect)$")
    reason: str = Field(min_length=4, max_length=180)


class OpenRouterGameplayGenerator:
    def __init__(self, app_config: AppConfig) -> None:
        self.app_config = app_config
        self.provider_config = app_config.providers.openrouter
        self.retrieval = RetrievalService(app_config)

    async def generate_question(
        self,
        model_id: str,
        input_data: QuestionGenerationInput,
    ) -> GeneratedQuestionPayload:
        api_key = os.getenv(self.provider_config.api_key_env, "").strip()
        if not api_key:
            return self._fallback_question(input_data)

        try:
            provider = self._provider(api_key)
            agent = Agent(
                OpenRouterModel(model_id, provider=provider),
                output_type=GeneratedQuestionPayload,
                system_prompt=(
                    "You write polished quiz-show trivia questions. Return a single precise answer, short "
                    "acceptable alternatives, and a factual explanation."
                ),
            )
            result = await agent.run(
                self._question_prompt(input_data),
            )
            return result.output
        except Exception as exc:
            logger.warning("Question generation failed; falling back: %s", exc)
            return self._fallback_question(input_data)

    async def grade_answer(
        self,
        model_id: str,
        question_prompt: str,
        canonical_answer: str,
        acceptable_answers: list[str],
        player_answer: str,
    ) -> GradingPayload:
        api_key = os.getenv(self.provider_config.api_key_env, "").strip()
        if not api_key:
            return self._fallback_grade(canonical_answer, acceptable_answers, player_answer)

        try:
            provider = self._provider(api_key)
            agent = Agent(
                OpenRouterModel(model_id, provider=provider),
                output_type=GradingPayload,
                system_prompt=(
                    "You are a strict but fair quiz grader. Decide only correct or incorrect. "
                    "Be lenient on minor formatting differences, but do not reward meaningfully wrong answers."
                ),
            )
            result = await agent.run(
                "Question: "
                f"{question_prompt}\n"
                f"Canonical answer: {canonical_answer}\n"
                f"Acceptable alternatives: {', '.join(acceptable_answers)}\n"
                f"Player answer: {player_answer}"
            )
            return result.output
        except Exception as exc:
            logger.warning("Grading failed; falling back: %s", exc)
            return self._fallback_grade(canonical_answer, acceptable_answers, player_answer)

    async def generate_bonus_questions(
        self,
        model_id: str,
        topic_label: str,
        main_answer: str,
        count: int = 3,
    ) -> list[GeneratedBonusPayload]:
        api_key = os.getenv(self.provider_config.api_key_env, "").strip()
        fallback = self._fallback_bonus_questions(topic_label, main_answer, count)
        if not api_key:
            return fallback

        try:
            provider = self._provider(api_key)
            agent = Agent(
                OpenRouterModel(model_id, provider=provider),
                output_type=list[GeneratedBonusPayload],
                system_prompt=(
                    "Generate short follow-up bonus trivia questions that branch naturally from the main answer."
                ),
            )
            result = await agent.run(
                f"Generate exactly {count} bonus questions for topic {topic_label}. "
                f"The main answer that earned the bonus was: {main_answer}. "
                "Make each bonus same difficulty or slightly easier, direct-answer only."
            )
            bonuses = result.output
            return bonuses[:count] if bonuses else fallback
        except Exception as exc:
            logger.warning("Bonus generation failed; falling back: %s", exc)
            return fallback

    async def build_fact_card(self, payload: GeneratedQuestionPayload) -> FactCardState:
        citations = await self.retrieval.search(payload.answer, safesearch=1)
        return FactCardState(
            headline=payload.fact_headline,
            detail=payload.fact_detail,
            citations=citations,
        )

    def _provider(self, api_key: str) -> OpenRouterProvider:
        return OpenRouterProvider(
            api_key=api_key,
            app_url=self.app_config.app.public_base_url,
            app_title=self.app_config.app.name,
        )

    def _question_prompt(self, input_data: QuestionGenerationInput) -> str:
        safety = (
            "Keep the question suitable for a mixed audience."
            if input_data.soft_filter_enabled
            else "Avoid unsafe or abusive content."
        )
        return (
            f"Write one trivia question for the topic '{input_data.topic_label}'.\n"
            f"Reveal mode: {input_data.reveal_mode}.\n"
            "Rules:\n"
            "- Make it answerable from general knowledge, not a trick.\n"
            "- Use one clear canonical answer.\n"
            "- Keep the question theatrical and punchy.\n"
            f"- {safety}\n"
            "- Include a short fact headline and short explanatory fact detail."
        )

    def _fallback_question(self, input_data: QuestionGenerationInput) -> GeneratedQuestionPayload:
        label = input_data.topic_label
        normalized = re.sub(r"[^A-Za-z0-9 ]+", "", label).strip() or "General Knowledge"
        answer = normalized.split()[0]
        return GeneratedQuestionPayload(
            prompt=f"In a round about {label}, what single word from the topic title best represents this fallback question?",
            answer=answer,
            acceptable_answers=[answer],
            fact_headline=f"About {label}",
            fact_detail=f"This fallback question keeps the game moving while richer generation is unavailable for {label}.",
        )

    def _fallback_grade(
        self,
        canonical_answer: str,
        acceptable_answers: list[str],
        player_answer: str,
    ) -> GradingPayload:
        normalized_player = self._normalize_answer(player_answer)
        options = {
            self._normalize_answer(canonical_answer),
            *(self._normalize_answer(item) for item in acceptable_answers),
        }
        correct = normalized_player in options
        return GradingPayload(
            decision="correct" if correct else "incorrect",
            reason="Matches an accepted answer."
            if correct
            else "Does not match the accepted answer.",
        )

    def _fallback_bonus_questions(
        self,
        topic_label: str,
        main_answer: str,
        count: int,
    ) -> list[GeneratedBonusPayload]:
        base = self._normalize_answer(main_answer).title() or "Answer"
        bonuses: list[GeneratedBonusPayload] = []
        for index in range(count):
            bonuses.append(
                GeneratedBonusPayload(
                    prompt=f"Bonus {index + 1}: type the keyword '{base}' to bank a fallback bonus on {topic_label}.",
                    answer=base,
                    acceptable_answers=[base],
                )
            )
        return bonuses

    def _normalize_answer(self, value: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def make_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_urlsafe(6)}"
