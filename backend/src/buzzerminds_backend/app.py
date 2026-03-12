from __future__ import annotations

import logging
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from .config import get_app_config
from .logging_config import configure_logging
from .metrics import add_metrics_middleware, start_metrics_server
from .realtime import RealtimeHub
from .room_manager import RoomManager
from .runtime import RoomRuntime
from .schemas import (
    AdjudicationDecisionRequest,
    BuzzRequest,
    CreateRoomRequest,
    CreateRoomResponse,
    DisplayAuthRequest,
    DisplaySessionResponse,
    GameSummaryResponse,
    JoinRoomRequest,
    JoinRoomResponse,
    KickPlayerRequest,
    PublicConfigResponse,
    ReadyUpdateRequest,
    ResetRoomRequest,
    RoomStateResponse,
    SkipIntroRequest,
    StartGameRequest,
    SubmitAnswerRequest,
    SubmitTopicVotesRequest,
    TopicVotingActionRequest,
    UpdateSettingsRequest,
)
from .security import client_ip_from_headers
from .turnstile import TurnstileVerifier

logger = logging.getLogger(__name__)

app_config = get_app_config()
room_manager = RoomManager(app_config)
realtime_hub = RealtimeHub()
room_runtime = RoomRuntime(room_manager, realtime_hub)
turnstile_verifier = TurnstileVerifier(app_config)


def create_app() -> FastAPI:
    application = FastAPI(title=app_config.app.name, version=str(app_config.version))
    application.add_middleware(
        TrustedHostMiddleware, allowed_hosts=app_config.security.trusted_hosts
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=app_config.security.allowed_origins or [app_config.app.public_base_url],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    add_metrics_middleware(application)

    def rate_limit(request: Request, action: str, limit: int) -> None:
        subject = client_ip_from_headers(
            dict(request.headers), request.client.host if request.client else "unknown"
        )
        room_manager.apply_rate_limit(action, subject, limit)

    @application.get("/api/health")
    async def healthcheck() -> dict[str, str]:
        persistence = room_manager.persistence.status()
        return {
            "status": "ok",
            "persistence": persistence.backend,
            "durable": str(persistence.durable).lower(),
        }

    @application.get("/api/config", response_model=PublicConfigResponse)
    async def get_public_config() -> PublicConfigResponse:
        return room_manager.public_config()

    @application.post("/api/rooms", response_model=CreateRoomResponse, status_code=201)
    async def create_room(request: Request, body: CreateRoomRequest) -> CreateRoomResponse:
        rate_limit(request, "create_room", app_config.security.rate_limits.create_room_per_minute)
        await turnstile_verifier.verify(
            body.turnstile_token,
            request.client.host if request.client else None,
        )
        room = await room_manager.create_room()
        return CreateRoomResponse(
            room=room,
            display_session=DisplaySessionResponse(
                room_code=room.code,
                display_token=room_manager.create_display_session(room.code),
            ),
        )

    @application.get("/api/summaries/{summary_id}", response_model=GameSummaryResponse)
    async def get_summary(summary_id: str) -> GameSummaryResponse:
        summary = await room_manager.get_summary(summary_id)
        if summary is None:
            raise HTTPException(status_code=404, detail="Summary not found")
        return summary

    @application.get("/api/rooms/{room_code}", response_model=RoomStateResponse)
    async def get_room(room_code: str, request: Request) -> RoomStateResponse:
        rate_limit(request, "room_read", app_config.security.rate_limits.room_read_per_minute)
        return await room_manager.get_room_state(room_code)

    @application.post("/api/rooms/{room_code}/tick", response_model=RoomStateResponse)
    async def tick_room(room_code: str, request: Request) -> RoomStateResponse:
        rate_limit(request, "room_read", app_config.security.rate_limits.room_read_per_minute)
        room = await room_manager.tick_room(room_code)
        await realtime_hub.broadcast_room_state(room.code, room)
        return room

    @application.post(
        "/api/rooms/{room_code}/join", response_model=JoinRoomResponse, status_code=201
    )
    async def join_room(
        room_code: str, request: JoinRoomRequest, http_request: Request
    ) -> JoinRoomResponse:
        rate_limit(http_request, "join_room", app_config.security.rate_limits.join_room_per_minute)
        await turnstile_verifier.verify(
            request.turnstile_token,
            http_request.client.host if http_request.client else None,
        )
        result = await room_manager.join_room(
            room_code=room_code,
            client_id=request.client_id,
            name=request.name,
            color=request.color,
            expertise=request.expertise,
        )
        await realtime_hub.broadcast_room_state(result.room.code, result.room)
        return result

    @application.post(
        "/api/rooms/{room_code}/players/{player_id}/ready", response_model=RoomStateResponse
    )
    async def update_ready(
        room_code: str, player_id: str, request: ReadyUpdateRequest, http_request: Request
    ) -> RoomStateResponse:
        rate_limit(
            http_request, "room_action", app_config.security.rate_limits.room_action_per_minute
        )
        room = await room_manager.set_ready(
            room_code=room_code,
            player_id=player_id,
            player_token=request.player_token,
            ready=request.ready,
            client_id=request.client_id,
        )
        await realtime_hub.broadcast_room_state(room.code, room)
        return room

    @application.post(
        "/api/rooms/{room_code}/vip/{player_id}/settings", response_model=RoomStateResponse
    )
    async def update_settings_for_vip(
        room_code: str, player_id: str, request: UpdateSettingsRequest, http_request: Request
    ) -> RoomStateResponse:
        rate_limit(
            http_request, "room_action", app_config.security.rate_limits.room_action_per_minute
        )
        room = await room_manager.update_settings(
            room_code=room_code,
            player_id=player_id,
            player_token=request.player_token,
            patch=request.settings,
            client_id=request.client_id,
        )
        await realtime_hub.broadcast_room_state(room.code, room)
        return room

    @application.post(
        "/api/rooms/{room_code}/vip/{player_id}/start", response_model=RoomStateResponse
    )
    async def start_game(
        room_code: str, player_id: str, request: StartGameRequest, http_request: Request
    ) -> RoomStateResponse:
        rate_limit(
            http_request, "room_action", app_config.security.rate_limits.room_action_per_minute
        )
        room = await room_manager.start_game(
            room_code=room_code,
            player_id=player_id,
            player_token=request.player_token,
            client_id=request.client_id,
        )
        await realtime_hub.broadcast_room_state(room.code, room)
        return room

    @application.post(
        "/api/rooms/{room_code}/vip/{player_id}/skip-intro", response_model=RoomStateResponse
    )
    async def skip_intro(
        room_code: str, player_id: str, request: SkipIntroRequest, http_request: Request
    ) -> RoomStateResponse:
        rate_limit(
            http_request, "room_action", app_config.security.rate_limits.room_action_per_minute
        )
        room = await room_manager.skip_intro(
            room_code=room_code,
            player_id=player_id,
            player_token=request.player_token,
            client_id=request.client_id,
        )
        await realtime_hub.broadcast_room_state(room.code, room)
        return room

    @application.post(
        "/api/rooms/{room_code}/vip/{player_id}/kick", response_model=RoomStateResponse
    )
    async def kick_player(
        room_code: str, player_id: str, request: KickPlayerRequest, http_request: Request
    ) -> RoomStateResponse:
        rate_limit(
            http_request, "room_action", app_config.security.rate_limits.room_action_per_minute
        )
        room = await room_manager.kick_player(
            room_code=room_code,
            player_id=player_id,
            player_token=request.player_token,
            target_player_id=request.target_player_id,
            client_id=request.client_id,
        )
        await realtime_hub.broadcast_room_state(room.code, room)
        return room

    @application.post(
        "/api/rooms/{room_code}/players/{player_id}/topic-votes", response_model=RoomStateResponse
    )
    async def submit_topic_votes(
        room_code: str, player_id: str, request: SubmitTopicVotesRequest, http_request: Request
    ) -> RoomStateResponse:
        rate_limit(
            http_request, "room_action", app_config.security.rate_limits.room_action_per_minute
        )
        room = await room_manager.submit_topic_votes(
            room_code=room_code,
            player_id=player_id,
            player_token=request.player_token,
            topic_ids=request.topic_ids,
            client_id=request.client_id,
        )
        await realtime_hub.broadcast_room_state(room.code, room)
        return room

    @application.post(
        "/api/rooms/{room_code}/vip/{player_id}/topic-voting/reroll",
        response_model=RoomStateResponse,
    )
    async def reroll_topics(
        room_code: str, player_id: str, request: TopicVotingActionRequest, http_request: Request
    ) -> RoomStateResponse:
        rate_limit(
            http_request, "room_action", app_config.security.rate_limits.room_action_per_minute
        )
        room = await room_manager.reroll_topics(
            room_code=room_code,
            player_id=player_id,
            player_token=request.player_token,
            client_id=request.client_id,
        )
        await realtime_hub.broadcast_room_state(room.code, room)
        return room

    @application.post(
        "/api/rooms/{room_code}/vip/{player_id}/topic-voting/lock", response_model=RoomStateResponse
    )
    async def lock_topic_voting(
        room_code: str, player_id: str, request: TopicVotingActionRequest, http_request: Request
    ) -> RoomStateResponse:
        rate_limit(
            http_request, "room_action", app_config.security.rate_limits.room_action_per_minute
        )
        room = await room_manager.lock_topic_voting(
            room_code=room_code,
            player_id=player_id,
            player_token=request.player_token,
            client_id=request.client_id,
        )
        await realtime_hub.broadcast_room_state(room.code, room)
        return room

    @application.post(
        "/api/rooms/{room_code}/players/{player_id}/buzz", response_model=RoomStateResponse
    )
    async def buzz_in(
        room_code: str, player_id: str, request: BuzzRequest, http_request: Request
    ) -> RoomStateResponse:
        rate_limit(
            http_request, "room_action", app_config.security.rate_limits.room_action_per_minute
        )
        room = await room_manager.buzz_in(
            room_code=room_code,
            player_id=player_id,
            player_token=request.player_token,
            client_id=request.client_id,
        )
        await realtime_hub.broadcast_room_state(room.code, room)
        return room

    @application.post(
        "/api/rooms/{room_code}/players/{player_id}/answer", response_model=RoomStateResponse
    )
    async def submit_answer(
        room_code: str, player_id: str, request: SubmitAnswerRequest, http_request: Request
    ) -> RoomStateResponse:
        rate_limit(
            http_request, "room_action", app_config.security.rate_limits.room_action_per_minute
        )
        room = await room_manager.submit_answer(
            room_code=room_code,
            player_id=player_id,
            player_token=request.player_token,
            answer=request.answer,
            client_id=request.client_id,
        )
        await realtime_hub.broadcast_room_state(room.code, room)
        return room

    @application.post(
        "/api/rooms/{room_code}/players/{player_id}/adjudication", response_model=RoomStateResponse
    )
    async def submit_adjudication_decision(
        room_code: str,
        player_id: str,
        request: AdjudicationDecisionRequest,
        http_request: Request,
    ) -> RoomStateResponse:
        rate_limit(
            http_request, "room_action", app_config.security.rate_limits.room_action_per_minute
        )
        room = await room_manager.submit_adjudication_decision(
            room_code=room_code,
            player_id=player_id,
            player_token=request.player_token,
            decision=request.decision,
            client_id=request.client_id,
        )
        await realtime_hub.broadcast_room_state(room.code, room)
        return room

    @application.post(
        "/api/rooms/{room_code}/vip/{player_id}/reset", response_model=RoomStateResponse
    )
    async def reset_room(
        room_code: str, player_id: str, request: ResetRoomRequest, http_request: Request
    ) -> RoomStateResponse:
        rate_limit(
            http_request, "room_action", app_config.security.rate_limits.room_action_per_minute
        )
        room = await room_manager.reset_room(
            room_code=room_code,
            player_id=player_id,
            player_token=request.player_token,
            client_id=request.client_id,
        )
        await realtime_hub.broadcast_room_state(room.code, room)
        return room

    @application.post("/api/rooms/{room_code}/display/reset", response_model=RoomStateResponse)
    async def reset_room_from_display(
        room_code: str, request: DisplayAuthRequest, http_request: Request
    ) -> RoomStateResponse:
        rate_limit(
            http_request, "room_action", app_config.security.rate_limits.room_action_per_minute
        )
        room = await room_manager.load_room(room_code)
        room_manager.require_display_token(room, request.display_token)
        vip_player_id = room.vip_player_id
        if vip_player_id is None:
            raise HTTPException(status_code=400, detail="Cannot reset room without a VIP session.")
        vip = room.players[vip_player_id]
        room_state = await room_manager.reset_room(
            room_code=room_code,
            player_id=vip_player_id,
            player_token=vip.token,
            client_id=vip.client_id,
        )
        await realtime_hub.broadcast_room_state(room_state.code, room_state)
        return room_state

    @application.websocket("/ws/rooms/{room_code}")
    async def room_updates(
        websocket: WebSocket,
        room_code: str,
        client_type: str,
        player_id: str | None = None,
        player_token: str | None = None,
        client_id: str | None = None,
    ) -> None:
        normalized_room_code = room_code.strip().upper()

        if client_type not in {"display", "player"}:
            await websocket.close(code=4400, reason="Invalid client_type")
            return

        if client_type == "player":
            if not player_id or not player_token:
                await websocket.close(code=4401, reason="Missing player credentials")
                return
            try:
                await room_manager.verify_player_credentials(
                    normalized_room_code, player_id, player_token
                )
            except Exception:
                await websocket.close(code=4401, reason="Invalid player credentials")
                return

        await realtime_hub.register(normalized_room_code, websocket)
        if client_type == "display":
            room_state = await room_manager.set_display_connected(normalized_room_code, True)
        else:
            room_state = await room_manager.set_player_connected(
                normalized_room_code,
                player_id or "",
                player_token or "",
                True,
                client_id,
            )
        await realtime_hub.broadcast_room_state(normalized_room_code, room_state)

        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await realtime_hub.unregister(normalized_room_code, websocket)
            room_state: RoomStateResponse | None = None
            try:
                if client_type == "display":
                    room_state = await room_manager.set_display_connected(
                        normalized_room_code, False
                    )
                else:
                    room_state = await room_manager.set_player_connected(
                        normalized_room_code,
                        player_id or "",
                        player_token or "",
                        False,
                        client_id,
                    )
            except Exception:
                room_state = None
            if room_state is not None:
                await realtime_hub.broadcast_room_state(normalized_room_code, room_state)

    return application


app = create_app()


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(json_output=app_config.telemetry.structured_logs)
    start_metrics_server(port=9090)
    logger.info("BuzzerMinds starting up")
    await room_manager.persistence.connect()
    await realtime_hub.start()
    await room_runtime.start()
    try:
        yield
    finally:
        logger.info("BuzzerMinds shutting down")
        await room_runtime.stop()
        await realtime_hub.shutdown()
        await realtime_hub.stop()
        await room_manager.persistence.db.dispose()
        logger.info("Shutdown complete")


app.router.lifespan_context = lifespan


def main() -> None:
    uvicorn.run("buzzerminds_backend:app", host="0.0.0.0", port=8000)
