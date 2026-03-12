from __future__ import annotations

import logging
import os
import time

import httpx

from .config import AppConfig

logger = logging.getLogger(__name__)


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
            logger.warning(
                "SearXNG search skipped: no base URL configured",
                extra={"event": "searxng_search", "outcome": "skipped_no_url"},
            )
            return []

        t0 = time.monotonic()
        try:
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

            duration_ms = int((time.monotonic() - t0) * 1000)
            logger.info(
                "SearXNG search completed",
                extra={
                    "event": "searxng_search",
                    "duration_ms": duration_ms,
                    "outcome": "success",
                    "query": query[:120],
                    "result_count": len(urls),
                    "http_status": response.status_code,
                },
            )
            return urls
        except Exception as exc:
            duration_ms = int((time.monotonic() - t0) * 1000)
            logger.warning(
                "SearXNG search failed: %s",
                exc,
                extra={
                    "event": "searxng_search",
                    "duration_ms": duration_ms,
                    "outcome": "error",
                    "query": query[:120],
                    "error": str(exc),
                },
            )
            return []
