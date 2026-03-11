# Production Notes

## Single-instance deployment model

- Each deployment instance is self-contained and owns its own rooms.
- Rooms are not globally shared across unrelated instances.
- `nginx` proxies traffic to the frontend and backend containers.
- Cloudflare sits in front for DNS, caching, TLS termination, and edge protection.

## Active runtime

- Active games run in process memory. A server restart will lose all in-progress games.
- Postgres stores durable finished-game summaries via SQLModel and Alembic migrations.
- There is no Redis or distributed coordination layer; this is by design for the single-instance model.

## Public protection model

- No user accounts are required.
- The display creates a room and receives a private display token.
- Players join by room code and receive a device-bound player session token.
- Turnstile is used on room creation and room join when enabled.
- Request rate limiting is enforced server-side.

## Rate limiting

- The rate limiter is in-memory (`InMemoryRateLimiter` in `security.py`).
- All rate limit counters reset on server restart. This is acceptable for the single-instance model.
- Limits are configured per-action in `config.yml` under `security.rate_limits`.

## Deployment steps

1. **Clone and configure:**
   ```bash
   git clone <repo-url> buzzerminds && cd buzzerminds
   cp .env.example .env
   # Edit .env — at minimum set OPENROUTER_API_KEY and change POSTGRES_PASSWORD.
   ```

2. **Generate audio placeholders** (requires ffmpeg):
   ```bash
   bash scripts/fetch-audio-assets.sh
   ```

3. **Start all services:**
   ```bash
   docker compose up -d
   ```
   This starts Postgres, SearXNG, the backend (with auto Alembic migration), the frontend, nginx, and Prometheus.

4. **DNS setup:**
   - Point `quiz.deadpackets.pw` (or your domain) to the server's public IP.
   - In Cloudflare, set the DNS record to **Proxied** (orange cloud).
   - Set Cloudflare SSL/TLS mode to **Full** (not Full Strict, since the origin serves plain HTTP).

5. **Verify:**
   ```bash
   curl https://quiz.deadpackets.pw/api/health
   ```

## Remaining operational recommendations

- Run load tests before launch.
- Monitor provider spend and latency for OpenRouter and ElevenLabs.
- Rotate any exposed credentials immediately.
- Prometheus is accessible at `http://127.0.0.1:9091` on the host machine (not publicly exposed).
