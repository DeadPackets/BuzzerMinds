from __future__ import annotations

import os

import httpx
from fastapi import HTTPException, status

from .config import AppConfig


class TurnstileVerifier:
    def __init__(self, app_config: AppConfig) -> None:
        self.app_config = app_config

    async def verify(self, token: str | None, remote_ip: str | None) -> None:
        if not self.app_config.turnstile.enabled:
            return
        if not token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Turnstile verification is required.",
            )

        secret = os.getenv(self.app_config.turnstile.secret_key_env, "").strip()
        if not secret:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Turnstile is enabled but not configured.",
            )

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                self.app_config.turnstile.verify_url,
                data={
                    "secret": secret,
                    "response": token,
                    "remoteip": remote_ip or "",
                },
            )
            response.raise_for_status()
            payload = response.json()

        if not payload.get("success"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Turnstile verification failed."
            )
