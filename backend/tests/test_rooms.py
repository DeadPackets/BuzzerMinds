from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from buzzerminds_backend.app import app, room_manager
from buzzerminds_backend.security import InMemoryRateLimiter
from buzzerminds_backend.topic_generation import GeneratedTopicsPayload


@pytest.mark.asyncio
async def test_first_player_becomes_vip_and_room_can_start_when_all_ready() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_response = await client.post("/api/rooms", json={"turnstile_token": None})
        room_code = create_response.json()["room"]["code"]

        first_join = await client.post(
            f"/api/rooms/{room_code}/join",
            json={
                "client_id": "client-alpha-123",
                "name": "Alice",
                "color": "gold",
                "expertise": "Math olympiads and opera.",
            },
        )
        first_payload = first_join.json()
        first_player = first_payload["player_session"]
        assert first_player["role"] == "vip_player"

        second_join = await client.post(
            f"/api/rooms/{room_code}/join",
            json={
                "client_id": "client-bravo-456",
                "name": "Bob",
                "color": "teal",
                "expertise": "Arcade games and astronomy.",
            },
        )
        second_player = second_join.json()["player_session"]
        assert second_player["role"] == "player"

        await client.post(
            f"/api/rooms/{room_code}/players/{first_player['player_id']}/ready",
            json={
                "player_token": first_player["player_token"],
                "client_id": "client-alpha-123",
                "ready": True,
            },
        )
        ready_response = await client.post(
            f"/api/rooms/{room_code}/players/{second_player['player_id']}/ready",
            json={
                "player_token": second_player["player_token"],
                "client_id": "client-bravo-456",
                "ready": True,
            },
        )

        room = ready_response.json()
        assert room["can_start"] is True
        assert room["start_blockers"] == []


@pytest.mark.asyncio
async def test_game_start_makes_late_joiners_spectators() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_response = await client.post("/api/rooms", json={"turnstile_token": None})
        room_code = create_response.json()["room"]["code"]

        vip_join = await client.post(
            f"/api/rooms/{room_code}/join",
            json={
                "client_id": "client-charlie-789",
                "name": "Casey",
                "color": "amber",
                "expertise": "Broadway shows and world capitals.",
            },
        )
        vip = vip_join.json()["player_session"]

        player_join = await client.post(
            f"/api/rooms/{room_code}/join",
            json={
                "client_id": "client-delta-012",
                "name": "Devon",
                "color": "blue",
                "expertise": "Retro consoles and chemistry.",
            },
        )
        player = player_join.json()["player_session"]

        await client.post(
            f"/api/rooms/{room_code}/players/{vip['player_id']}/ready",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-charlie-789",
                "ready": True,
            },
        )
        await client.post(
            f"/api/rooms/{room_code}/players/{player['player_id']}/ready",
            json={
                "player_token": player["player_token"],
                "client_id": "client-delta-012",
                "ready": True,
            },
        )
        start_response = await client.post(
            f"/api/rooms/{room_code}/vip/{vip['player_id']}/start",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-charlie-789",
                "ready": True,
            },
        )

        assert start_response.json()["phase"] == "topic_voting"

        late_join = await client.post(
            f"/api/rooms/{room_code}/join",
            json={
                "client_id": "client-echo-345",
                "name": "Ellis",
                "color": "crimson",
                "expertise": "Post-war history and chess.",
            },
        )
        assert late_join.status_code == 201
        assert late_join.json()["player_session"]["role"] == "spectator"


@pytest.mark.asyncio
async def test_topic_voting_collects_votes_and_locks_selected_pool() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_response = await client.post("/api/rooms", json={"turnstile_token": None})
        room_code = create_response.json()["room"]["code"]

        vip_join = await client.post(
            f"/api/rooms/{room_code}/join",
            json={
                "client_id": "client-foxtrot-678",
                "name": "Ava",
                "color": "orange",
                "expertise": "Broadway productions and silent cinema",
            },
        )
        vip = vip_join.json()["player_session"]

        player_join = await client.post(
            f"/api/rooms/{room_code}/join",
            json={
                "client_id": "client-golf-901",
                "name": "Noah",
                "color": "green",
                "expertise": "Retro arcades and chemistry facts",
            },
        )
        player = player_join.json()["player_session"]

        await client.post(
            f"/api/rooms/{room_code}/players/{vip['player_id']}/ready",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-foxtrot-678",
                "ready": True,
            },
        )
        await client.post(
            f"/api/rooms/{room_code}/players/{player['player_id']}/ready",
            json={
                "player_token": player["player_token"],
                "client_id": "client-golf-901",
                "ready": True,
            },
        )

        start_response = await client.post(
            f"/api/rooms/{room_code}/vip/{vip['player_id']}/start",
            json={"player_token": vip["player_token"], "client_id": "client-foxtrot-678"},
        )
        room = start_response.json()
        assert room["phase"] == "topic_voting"
        assert room["topic_voting"]["status"] == "collecting_votes"
        assert len(room["topic_voting"]["options"]) == 12

        first_vote_ids = [
            room["topic_voting"]["options"][0]["id"],
            room["topic_voting"]["options"][1]["id"],
        ]
        second_vote_ids = [
            room["topic_voting"]["options"][1]["id"],
            room["topic_voting"]["options"][2]["id"],
        ]

        first_vote = await client.post(
            f"/api/rooms/{room_code}/players/{vip['player_id']}/topic-votes",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-foxtrot-678",
                "topic_ids": first_vote_ids,
            },
        )
        assert first_vote.json()["topic_voting"]["status"] == "collecting_votes"

        second_vote = await client.post(
            f"/api/rooms/{room_code}/players/{player['player_id']}/topic-votes",
            json={
                "player_token": player["player_token"],
                "client_id": "client-golf-901",
                "topic_ids": second_vote_ids,
            },
        )
        locked_room = second_vote.json()

        assert locked_room["topic_voting"]["status"] == "locked"
        assert (
            len(locked_room["topic_voting"]["selected_topic_ids"])
            == locked_room["settings"]["topic_pool_size"]
        )
        assert locked_room["topic_voting"]["players_pending"] == []


@pytest.mark.asyncio
async def test_topic_generation_uses_openrouter_when_api_key_is_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ASGITransport(app=app)

    async def fake_request_topics(
        self,
        api_key: str,
        model_id: str,
        players: list[object],
        count: int,
        seed: int,
        soft_filter_enabled: bool,
    ) -> GeneratedTopicsPayload:
        assert api_key == "test-openrouter-key"
        assert model_id == "openai/gpt-5.4"
        assert count == 8
        assert seed == 0
        assert soft_filter_enabled is True
        assert len(players) == 2

        labels = [
            "Stage & Screen",
            "Arcade Physics",
            "Capital Cities",
            "Opera Houses",
            "Rocket Science",
            "Chess Openings",
            "Museum Masterpieces",
            "Ocean Expeditions",
        ]
        return GeneratedTopicsPayload.model_validate(
            {"topics": [{"label": label} for label in labels]}
        )

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")
    monkeypatch.setattr(
        "buzzerminds_backend.topic_generation.OpenRouterTopicGenerator._request_topics",
        fake_request_topics,
    )

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_response = await client.post("/api/rooms", json={"turnstile_token": None})
        room_code = create_response.json()["room"]["code"]

        vip_join = await client.post(
            f"/api/rooms/{room_code}/join",
            json={
                "client_id": "client-hotel-111",
                "name": "Riley",
                "color": "red",
                "expertise": "Broadway revivals and opera houses",
            },
        )
        vip = vip_join.json()["player_session"]

        player_join = await client.post(
            f"/api/rooms/{room_code}/join",
            json={
                "client_id": "client-india-222",
                "name": "Jordan",
                "color": "cyan",
                "expertise": "Arcade games, rocket science, and ocean travel",
            },
        )
        player = player_join.json()["player_session"]

        await client.post(
            f"/api/rooms/{room_code}/players/{vip['player_id']}/ready",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-hotel-111",
                "ready": True,
            },
        )
        await client.post(
            f"/api/rooms/{room_code}/players/{player['player_id']}/ready",
            json={
                "player_token": player["player_token"],
                "client_id": "client-india-222",
                "ready": True,
            },
        )

        start_response = await client.post(
            f"/api/rooms/{room_code}/vip/{vip['player_id']}/start",
            json={"player_token": vip["player_token"], "client_id": "client-hotel-111"},
        )
        options = start_response.json()["topic_voting"]["options"]

        assert [option["label"] for option in options[:8]] == [
            "Stage & Screen",
            "Arcade Physics",
            "Capital Cities",
            "Opera Houses",
            "Rocket Science",
            "Chess Openings",
            "Museum Masterpieces",
            "Ocean Expeditions",
        ]


@pytest.mark.asyncio
async def test_topic_generation_falls_back_when_openrouter_call_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ASGITransport(app=app)

    async def fake_request_topics(
        self,
        api_key: str,
        model_id: str,
        players: list[object],
        count: int,
        seed: int,
        soft_filter_enabled: bool,
    ) -> GeneratedTopicsPayload:
        raise RuntimeError("network down")

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")
    monkeypatch.setattr(
        "buzzerminds_backend.topic_generation.OpenRouterTopicGenerator._request_topics",
        fake_request_topics,
    )

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_response = await client.post("/api/rooms", json={"turnstile_token": None})
        room_code = create_response.json()["room"]["code"]

        vip_join = await client.post(
            f"/api/rooms/{room_code}/join",
            json={
                "client_id": "client-juliet-333",
                "name": "Mina",
                "color": "magenta",
                "expertise": "Retro arcades and chemistry facts",
            },
        )
        vip = vip_join.json()["player_session"]

        player_join = await client.post(
            f"/api/rooms/{room_code}/join",
            json={
                "client_id": "client-kilo-444",
                "name": "Leo",
                "color": "navy",
                "expertise": "World capitals and silent cinema",
            },
        )
        player = player_join.json()["player_session"]

        await client.post(
            f"/api/rooms/{room_code}/players/{vip['player_id']}/ready",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-juliet-333",
                "ready": True,
            },
        )
        await client.post(
            f"/api/rooms/{room_code}/players/{player['player_id']}/ready",
            json={
                "player_token": player["player_token"],
                "client_id": "client-kilo-444",
                "ready": True,
            },
        )

        start_response = await client.post(
            f"/api/rooms/{room_code}/vip/{vip['player_id']}/start",
            json={"player_token": vip["player_token"], "client_id": "client-juliet-333"},
        )
        options = start_response.json()["topic_voting"]["options"]

        assert len(options) == 12
        assert any(option["label"] == "Retro Arcades" for option in options[:8])
        assert any(option["label"] == "World Capitals" for option in options[:8])


@pytest.mark.asyncio
async def test_full_question_buzz_answer_and_bonus_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = ASGITransport(app=app)
    current_time = datetime(2026, 3, 10, 12, 0, tzinfo=UTC)

    def fake_now() -> datetime:
        nonlocal current_time
        current_time += timedelta(seconds=1)
        return current_time

    async def fake_question(*args, **kwargs):
        from buzzerminds_backend.gameplay_generation import GeneratedQuestionPayload

        return GeneratedQuestionPayload(
            prompt="Which city is known as the City of Light?",
            answer="Paris",
            acceptable_answers=["Paris"],
            fact_headline="Paris nickname",
            fact_detail="Paris has long been called the City of Light.",
        )

    async def fake_bonus(*args, **kwargs):
        from buzzerminds_backend.gameplay_generation import GeneratedBonusPayload

        return [
            GeneratedBonusPayload(
                prompt="Name the river running through Paris.",
                answer="Seine",
                acceptable_answers=["Seine"],
            ),
            GeneratedBonusPayload(
                prompt="Which tower is Paris famous for?",
                answer="Eiffel Tower",
                acceptable_answers=["Eiffel Tower", "Eiffel"],
            ),
            GeneratedBonusPayload(
                prompt="Which museum houses the Mona Lisa in Paris?",
                answer="Louvre",
                acceptable_answers=["The Louvre", "Louvre"],
            ),
        ]

    monkeypatch.setattr(room_manager.gameplay_generator, "generate_question", fake_question)
    monkeypatch.setattr(room_manager.gameplay_generator, "generate_bonus_questions", fake_bonus)
    monkeypatch.setattr(
        room_manager.narration_service,
        "synthesize",
        lambda text: room_manager.narration_service.build_disabled_cue(text),
    )
    monkeypatch.setattr("buzzerminds_backend.room_manager.utc_now", fake_now)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        room_code = (await client.post("/api/rooms", json={"turnstile_token": None})).json()[
            "room"
        ]["code"]

        vip = (
            await client.post(
                f"/api/rooms/{room_code}/join",
                json={
                    "client_id": "client-lima-555",
                    "name": "Ari",
                    "color": "red",
                    "expertise": "European capitals",
                },
            )
        ).json()["player_session"]
        player = (
            await client.post(
                f"/api/rooms/{room_code}/join",
                json={
                    "client_id": "client-mike-666",
                    "name": "Bea",
                    "color": "blue",
                    "expertise": "Art and geography",
                },
            )
        ).json()["player_session"]

        await client.post(
            f"/api/rooms/{room_code}/players/{vip['player_id']}/ready",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-lima-555",
                "ready": True,
            },
        )
        await client.post(
            f"/api/rooms/{room_code}/players/{player['player_id']}/ready",
            json={
                "player_token": player["player_token"],
                "client_id": "client-mike-666",
                "ready": True,
            },
        )

        started = await client.post(
            f"/api/rooms/{room_code}/vip/{vip['player_id']}/start",
            json={"player_token": vip["player_token"], "client_id": "client-lima-555"},
        )
        options = started.json()["topic_voting"]["options"]
        chosen = [options[0]["id"], options[1]["id"]]
        await client.post(
            f"/api/rooms/{room_code}/players/{vip['player_id']}/topic-votes",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-lima-555",
                "topic_ids": chosen,
            },
        )
        locked = await client.post(
            f"/api/rooms/{room_code}/players/{player['player_id']}/topic-votes",
            json={
                "player_token": player["player_token"],
                "client_id": "client-mike-666",
                "topic_ids": chosen,
            },
        )
        room = locked.json()
        assert room["phase"] in {"question_loading", "question_reveal_full", "buzz_open"}

        while room["phase"] != "buzz_open":
            room = (await client.post(f"/api/rooms/{room_code}/tick")).json()

        buzzed = await client.post(
            f"/api/rooms/{room_code}/players/{vip['player_id']}/buzz",
            json={"player_token": vip["player_token"], "client_id": "client-lima-555"},
        )
        assert buzzed.json()["phase"] == "answering"

        graded = await client.post(
            f"/api/rooms/{room_code}/players/{vip['player_id']}/answer",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-lima-555",
                "answer": "Paris",
            },
        )
        room = graded.json()
        assert room["phase"] in {"bonus_answering", "bonus_loading"}
        assert next(p for p in room["players"] if p["id"] == vip["player_id"])["score"] == 10

        while room["phase"] != "bonus_answering":
            room = (await client.post(f"/api/rooms/{room_code}/tick")).json()

        for answer in ["Seine", "Eiffel Tower", "Louvre"]:
            room = (
                await client.post(
                    f"/api/rooms/{room_code}/players/{vip['player_id']}/answer",
                    json={
                        "player_token": vip["player_token"],
                        "client_id": "client-lima-555",
                        "answer": answer,
                    },
                )
            ).json()

        assert room["phase"] in {"score_reveal", "finished", "question_loading"}
        vip_state = next(p for p in room["players"] if p["id"] == vip["player_id"])
        assert vip_state["score"] >= 25


@pytest.mark.asyncio
async def test_room_snapshot_does_not_leak_canonical_answers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ASGITransport(app=app)
    current_time = datetime(2026, 3, 10, 14, 0, tzinfo=UTC)

    def fake_now() -> datetime:
        nonlocal current_time
        current_time += timedelta(seconds=1)
        return current_time

    async def fake_question(*args, **kwargs):
        from buzzerminds_backend.gameplay_generation import GeneratedQuestionPayload

        return GeneratedQuestionPayload(
            prompt="Which city is known as the City of Light?",
            answer="Paris",
            acceptable_answers=["Paris"],
            fact_headline="Paris nickname",
            fact_detail="Paris has long been called the City of Light.",
        )

    monkeypatch.setattr(room_manager.gameplay_generator, "generate_question", fake_question)
    monkeypatch.setattr(
        room_manager.narration_service,
        "synthesize",
        lambda text: room_manager.narration_service.build_disabled_cue(text),
    )
    monkeypatch.setattr("buzzerminds_backend.room_manager.utc_now", fake_now)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        room_code = (await client.post("/api/rooms", json={"turnstile_token": None})).json()[
            "room"
        ]["code"]
        vip = (
            await client.post(
                f"/api/rooms/{room_code}/join",
                json={
                    "client_id": "client-november-777",
                    "name": "Ari",
                    "color": "red",
                    "expertise": "Capitals",
                },
            )
        ).json()["player_session"]
        player = (
            await client.post(
                f"/api/rooms/{room_code}/join",
                json={
                    "client_id": "client-oscar-888",
                    "name": "Bea",
                    "color": "blue",
                    "expertise": "Museums",
                },
            )
        ).json()["player_session"]
        await client.post(
            f"/api/rooms/{room_code}/players/{vip['player_id']}/ready",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-november-777",
                "ready": True,
            },
        )
        await client.post(
            f"/api/rooms/{room_code}/players/{player['player_id']}/ready",
            json={
                "player_token": player["player_token"],
                "client_id": "client-oscar-888",
                "ready": True,
            },
        )
        started = await client.post(
            f"/api/rooms/{room_code}/vip/{vip['player_id']}/start",
            json={"player_token": vip["player_token"], "client_id": "client-november-777"},
        )
        options = started.json()["topic_voting"]["options"]
        selected = [options[0]["id"]]
        await client.post(
            f"/api/rooms/{room_code}/players/{vip['player_id']}/topic-votes",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-november-777",
                "topic_ids": selected,
            },
        )
        room = (
            await client.post(
                f"/api/rooms/{room_code}/players/{player['player_id']}/topic-votes",
                json={
                    "player_token": player["player_token"],
                    "client_id": "client-oscar-888",
                    "topic_ids": selected,
                },
            )
        ).json()
        room = (await client.get(f"/api/rooms/{room_code}")).json()

        assert room["current_question"] is not None
        assert "answer" not in room["current_question"]["question"]
        assert "acceptable_answers" not in room["current_question"]["question"]


@pytest.mark.asyncio
async def test_kick_player_blocks_rejoin() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        room_code = (await client.post("/api/rooms", json={"turnstile_token": None})).json()[
            "room"
        ]["code"]

        vip = (
            await client.post(
                f"/api/rooms/{room_code}/join",
                json={
                    "client_id": "client-papa-001",
                    "name": "VIPKicker",
                    "color": "red",
                    "expertise": "Kicking expertise",
                },
            )
        ).json()["player_session"]

        target = (
            await client.post(
                f"/api/rooms/{room_code}/join",
                json={
                    "client_id": "client-quebec-002",
                    "name": "KickTarget",
                    "color": "blue",
                    "expertise": "Being kicked expertise",
                },
            )
        ).json()["player_session"]

        kick_response = await client.post(
            f"/api/rooms/{room_code}/vip/{vip['player_id']}/kick",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-papa-001",
                "target_player_id": target["player_id"],
            },
        )
        assert kick_response.status_code == 200

        rejoin = await client.post(
            f"/api/rooms/{room_code}/join",
            json={
                "client_id": "client-quebec-002",
                "name": "KickTargetReturn",
                "color": "green",
                "expertise": "Returning expertise",
            },
        )
        assert rejoin.status_code == 403


@pytest.mark.asyncio
async def test_settings_update_validates_ranges() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        room_code = (await client.post("/api/rooms", json={"turnstile_token": None})).json()[
            "room"
        ]["code"]

        vip = (
            await client.post(
                f"/api/rooms/{room_code}/join",
                json={
                    "client_id": "client-romeo-003",
                    "name": "SettingsVIP",
                    "color": "gold",
                    "expertise": "Settings expertise",
                },
            )
        ).json()["player_session"]

        # topic_pool_size max is 10 — 999 should fail
        bad_response = await client.post(
            f"/api/rooms/{room_code}/vip/{vip['player_id']}/settings",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-romeo-003",
                "settings": {"topic_pool_size": 999},
            },
        )
        assert bad_response.status_code == 400

        # Valid update should succeed
        good_response = await client.post(
            f"/api/rooms/{room_code}/vip/{vip['player_id']}/settings",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-romeo-003",
                "settings": {"topic_pool_size": 5},
            },
        )
        assert good_response.status_code == 200
        assert good_response.json()["settings"]["topic_pool_size"] == 5


@pytest.mark.asyncio
async def test_reset_room_preserves_roster_resets_scores(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ASGITransport(app=app)
    current_time = datetime(2026, 3, 10, 16, 0, tzinfo=UTC)

    def fake_now() -> datetime:
        nonlocal current_time
        current_time += timedelta(seconds=1)
        return current_time

    monkeypatch.setattr("buzzerminds_backend.room_manager.utc_now", fake_now)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        room_code = (await client.post("/api/rooms", json={"turnstile_token": None})).json()[
            "room"
        ]["code"]

        vip = (
            await client.post(
                f"/api/rooms/{room_code}/join",
                json={
                    "client_id": "client-sierra-004",
                    "name": "ResetVIP",
                    "color": "gold",
                    "expertise": "Reset expertise",
                },
            )
        ).json()["player_session"]

        player = (
            await client.post(
                f"/api/rooms/{room_code}/join",
                json={
                    "client_id": "client-tango-005",
                    "name": "ResetPlayer",
                    "color": "teal",
                    "expertise": "Reset player expertise",
                },
            )
        ).json()["player_session"]

        # Ready up and start
        await client.post(
            f"/api/rooms/{room_code}/players/{vip['player_id']}/ready",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-sierra-004",
                "ready": True,
            },
        )
        await client.post(
            f"/api/rooms/{room_code}/players/{player['player_id']}/ready",
            json={
                "player_token": player["player_token"],
                "client_id": "client-tango-005",
                "ready": True,
            },
        )
        start_resp = await client.post(
            f"/api/rooms/{room_code}/vip/{vip['player_id']}/start",
            json={"player_token": vip["player_token"], "client_id": "client-sierra-004"},
        )
        assert start_resp.json()["phase"] == "topic_voting"

        # Reset
        reset_resp = await client.post(
            f"/api/rooms/{room_code}/vip/{vip['player_id']}/reset",
            json={"player_token": vip["player_token"], "client_id": "client-sierra-004"},
        )
        room = reset_resp.json()
        assert room["phase"] == "lobby"
        assert len(room["players"]) == 2
        for p in room["players"]:
            assert p["score"] == 0
            assert p["ready"] is False


@pytest.mark.asyncio
async def test_vip_disconnect_pauses_active_game(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = ASGITransport(app=app)
    current_time = datetime(2026, 3, 10, 18, 0, tzinfo=UTC)

    def fake_now() -> datetime:
        nonlocal current_time
        current_time += timedelta(seconds=1)
        return current_time

    monkeypatch.setattr("buzzerminds_backend.room_manager.utc_now", fake_now)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        room_code = (await client.post("/api/rooms", json={"turnstile_token": None})).json()[
            "room"
        ]["code"]

        vip = (
            await client.post(
                f"/api/rooms/{room_code}/join",
                json={
                    "client_id": "client-uniform-006",
                    "name": "PauseVIP",
                    "color": "red",
                    "expertise": "Pause expertise",
                },
            )
        ).json()["player_session"]

        player = (
            await client.post(
                f"/api/rooms/{room_code}/join",
                json={
                    "client_id": "client-victor-007",
                    "name": "PausePlayer",
                    "color": "blue",
                    "expertise": "Pause player expertise",
                },
            )
        ).json()["player_session"]

        await client.post(
            f"/api/rooms/{room_code}/players/{vip['player_id']}/ready",
            json={
                "player_token": vip["player_token"],
                "client_id": "client-uniform-006",
                "ready": True,
            },
        )
        await client.post(
            f"/api/rooms/{room_code}/players/{player['player_id']}/ready",
            json={
                "player_token": player["player_token"],
                "client_id": "client-victor-007",
                "ready": True,
            },
        )
        start_resp = await client.post(
            f"/api/rooms/{room_code}/vip/{vip['player_id']}/start",
            json={"player_token": vip["player_token"], "client_id": "client-uniform-006"},
        )
        assert start_resp.json()["phase"] == "topic_voting"

        # Simulate VIP disconnect
        paused_state = await room_manager.set_player_connected(
            room_code,
            vip["player_id"],
            vip["player_token"],
            False,
            "client-uniform-006",
        )
        assert paused_state.phase == "paused_waiting_for_vip"

        # Simulate VIP reconnect
        resumed_state = await room_manager.set_player_connected(
            room_code,
            vip["player_id"],
            vip["player_token"],
            True,
            "client-uniform-006",
        )
        assert resumed_state.phase != "paused_waiting_for_vip"
        assert resumed_state.phase == "topic_voting"


def test_rate_limiting_blocks_excessive_requests() -> None:
    limiter = InMemoryRateLimiter()
    bucket = "test_rate_limit_bucket"

    # First 5 should pass
    for _ in range(5):
        limiter.check(bucket, limit=5)

    # 6th should raise 429
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        limiter.check(bucket, limit=5)
    assert exc_info.value.status_code == 429


@pytest.mark.asyncio
async def test_display_reset_requires_valid_token() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_resp = (await client.post("/api/rooms", json={"turnstile_token": None})).json()
        room_code = create_resp["room"]["code"]
        valid_display_token = create_resp["display_session"]["display_token"]

        # Need at least a VIP for reset to work
        vip = (
            await client.post(
                f"/api/rooms/{room_code}/join",
                json={
                    "client_id": "client-whiskey-008",
                    "name": "DisplayResetVIP",
                    "color": "gold",
                    "expertise": "Display reset expertise",
                },
            )
        ).json()["player_session"]
        assert vip["role"] == "vip_player"

        # Bad token should get 403
        bad_response = await client.post(
            f"/api/rooms/{room_code}/display/reset",
            json={"display_token": "totally-invalid-token"},
        )
        assert bad_response.status_code == 403

        # Valid token should succeed
        good_response = await client.post(
            f"/api/rooms/{room_code}/display/reset",
            json={"display_token": valid_display_token},
        )
        assert good_response.status_code == 200
        assert good_response.json()["phase"] == "lobby"
