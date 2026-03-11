from __future__ import annotations

import os

import httpx

from .config import AppConfig


class RetrievalService:
    def __init__(self, app_config: AppConfig) -> None:
        self.app_config = app_config
        self._client = httpx.AsyncClient(
            timeout=self.app_config.retrieval.timeout_seconds,
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
            http2=True,
        )

    async def search(self, query: str, safesearch: int = 1) -> list[str]:
        if self.app_config.retrieval.backend != "searxng":
            return []
        base_url = os.getenv(self.app_config.retrieval.searxng_url_env, "").strip()
        if not base_url:
            return []

        response = await self._client.get(
            f"{base_url.rstrip('/')}/search",
            params={
                "q": query,
                "format": "json",
                "categories": "general",
                "engines": "wikipedia,wikidata,duckduckgo",
                "safesearch": safesearch,
            },
        )
        response.raise_for_status()
        payload = response.json()

        results = payload.get("results", [])
        urls: list[str] = []
        for item in results[:3]:
            url = item.get("url")
            if isinstance(url, str) and url:
                urls.append(url)
        return urls
