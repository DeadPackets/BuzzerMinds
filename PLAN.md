# BuzzerMinds Plan

## Vision

BuzzerMinds is a live trivia party game inspired by BBC's University Challenge and Jackbox Games.
Players join a shared room from their phones, the room display shows the game to everyone, and the first player to join becomes the VIP who configures the game before it starts.

The product should feel fast, theatrical, and trustworthy:

- fast enough for party play, even with live AI generation
- theatrical with narration, sound effects, and dramatic reveals
- trustworthy despite AI involvement, with fact cards, strict schemas, and adjudication fallbacks

## Core Product Model

### Roles

- `display`: creates the room, shows the room code, renders the public gameboard, and never acts as the main controller
- `vip_player`: the first player to join; still competes normally, but owns pregame controls and fallback adjudication controls
- `player`: normal participant
- `spectator`: late joiner after the game starts; view-only on phone, cannot buzz or score

### Control Rules

- the display starts the room
- the first player to join becomes the VIP automatically
- the VIP can configure settings only before the game starts
- settings lock when gameplay starts
- the VIP is allowed to compete like everyone else
- if the VIP disconnects mid-game, the game pauses for 90 seconds waiting for them to return
- if the VIP does not return in time, the game ends with current scores
- if the grading model fails on the VIP's own answer, connected non-answering active players vote by simple majority; spectators are excluded and ties resolve to incorrect

## Locked Gameplay Rules

### Lobby

- at least 2 players are required to start
- every joined player must be marked ready before the VIP can start
- duplicate player names are rejected
- player colors must be unique
- the VIP can kick players at any time
- kicked players cannot rejoin the same room
- if the VIP starts a new game in the same room, the roster stays, but scores and readiness reset
- spectators remain spectators across room resets

### Topic Setup

- each player submits one natural-language expertise field, max 250 characters
- AI generates a 12-topic shortlist
- default shortlist mix is 8 AI-derived topics and 4 built-in standard topics
- the VIP gets one reroll before voting
- no topic removal or editing before voting
- players use approval voting with a max of 3 approvals each
- ties around the pool cutoff are resolved with an animated random tiebreak
- the VIP chooses the game topic pool size from 1 to 10
- the selected topic pool is used randomly without replacement first, then reshuffled if needed

### Questions and Buzzing

- reveal modes supported: `progressive` and `full`
- in `progressive`, visual reveal syncs to ElevenLabs narration timing when available; otherwise it falls back to semantic chunks every 2 seconds
- in `full`, buzzing opens only after the full question is shown
- the no-buzz window after full reveal is configurable from 5 to 15 seconds, default 8
- if nobody buzzes, the game reveals the answer, shows a fact card, and moves on automatically
- if a player interrupts early in progressive mode and is wrong, they lose 5 points
- there is no wrong-answer penalty in full reveal mode by default
- after an incorrect interruption, the question resumes from the interruption point
- a player who gets a question wrong cannot buzz again on that same question
- questions generate on demand
- if a topic fails to produce a usable question 3 times in a row, that topic is skipped for the current game

### Answers and Grading

- live gameplay answers are typed only in the MVP
- main answer max length is 160 characters
- main answer timer is configurable from 10 to 30 seconds, default 15
- the submitted answer appears on the public display before or during grading
- grading must resolve to `correct` or `incorrect`
- if grading fails because of timeout, schema failure, or provider error, retry once and then hand control to adjudication
- normal adjudication fallback is VIP binary `accept` / `reject`
- if adjudication is needed for the VIP's own answer, non-answering active players vote by simple majority
- players see a short grading reason; the display shows the correct answer and a short fact card

### Bonus Questions

- a correct main answer awards 3 solo bonus questions to that player
- bonus questions are semantic branches from the main answer and do not consume the shared topic pool
- bonus questions are same difficulty or slightly easier than the main question
- each bonus answer is a direct typed response from the awarded player
- bonus question timer is configurable from 10 to 30 seconds, default 15
- the full 3-question bonus chain always continues even after a miss

### Scoring and Ending

- main correct: +10
- incorrect progressive interruption: -5
- bonus correct: +5 each
- standings are shown after each main question or completed bonus chain
- shared winners are allowed on ties
- game end modes supported: `rounds` and `timer`
- default rounds mode: 10 rounds
- default timer mode: 15 minutes
- in rounds mode, one round means one main question plus its earned bonus chain
- timer expiry behaviors supported: `finish_round`, `finish_main_only`, `stop_immediately`
- default timer expiry behavior: `finish_round`

## AI, Trust, and Safety

### LLM Providers

- OpenRouter is the LLM provider
- model access is defined in `config.yml`
- a model preset contains exactly one `content_model` and one `grading_model`
- content model handles topic generation, main questions, and bonus questions
- grading model handles answer evaluation only
- the VIP chooses a model preset before the game starts
- each game stores a resolved snapshot of the chosen preset so future config changes do not affect active or historical games

### Retrieval and Grounding

- retrieval is optional, not mandatory for MVP
- the configuration must support a future SearXNG backend
- fact cards should show a short explanation always
- citations are shown when retrieval is available

### Safety

- the VIP may toggle soft filtering on or off before the game starts
- even if soft filtering is off, the system must always hard-block the worst abusive or unsafe content
- names and expertise text are treated as untrusted input
- structured schemas are required for all LLM outputs

## Audio Direction

- ElevenLabs powers the judge/commentator narration
- narration, sound effects, and music are controlled independently by the VIP before game start
- default audio state: narration on, sound effects on, music off
- gameplay waits up to 5 seconds for narration; if audio is not ready in time, the game falls back for that moment
- sound effects and music come from bundled open-licensed local assets
- narration scope is configurable per game

## Technical Architecture

### Frontend

- `frontend/` is a Next.js App Router app in TypeScript
- the display and phone UI live in the same frontend codebase
- the frontend uses the backend for room creation, joining, settings updates, and live room-state updates

Key routes planned:

- `/`: landing page with create-display and join-room flows
- `/display/[roomCode]`: public room display
- `/player/[roomCode]`: phone join, lobby, VIP controls, and gameplay controls later

### Backend

- `backend/` is a FastAPI app managed by `uv`
- FastAPI owns room state, player identity, VIP permissions, and room broadcasts
- WebSockets push authoritative room snapshots to the display and phones
- REST endpoints handle room creation, joining, readiness, settings changes, and game start
- early MVP room state is in-memory; later phases should move to Redis/Postgres-backed state

### Future Persistence

Planned later, not required for the current in-memory MVP foundation:

- PostgreSQL for durable game history, prompt versions, model usage, and analytics
- Redis for pub/sub, reconnect handling, buzzer locking, and room timers

## Config Strategy

`config.yml` is the main operator-facing configuration file.

It should define:

- app metadata and public URLs
- provider credentials via environment variable names
- retrieval backends and timeouts
- model catalog and player-visible presets
- gameplay defaults and allowed ranges
- VIP rules
- lobby and room lifecycle rules
- moderation defaults
- audio defaults
- runtime persistence and telemetry knobs

Every created game should store a resolved `game_config_snapshot` that includes:

- chosen model preset id
- resolved content model id
- resolved grading model id
- all locked gameplay settings
- all locked audio settings
- moderation choices

## State Machine

Planned canonical room phases:

- `lobby`
- `topic_voting`
- `question_loading`
- `question_reveal_progressive`
- `question_reveal_full`
- `buzz_open`
- `answering`
- `grading`
- `bonus_loading`
- `bonus_answering`
- `score_reveal`
- `paused_waiting_for_vip`
- `finished`

The current MVP foundation will fully implement:

- `lobby`
- `topic_voting` as a placeholder phase after start

## Realtime Event Direction

The MVP should prefer server-broadcast full room snapshots for simplicity.
Later, it can layer richer event streams on top.

Planned client intents:

- create room
- join room
- set ready
- update settings
- start game
- kick player

Planned server broadcasts:

- `room_state`
- `player_joined`
- `player_updated`
- `phase_changed`
- `room_error`

## MVP Scope Being Built Now

### Immediate MVP Foundation

- root-level project plan and configuration
- FastAPI backend scaffold with config loading
- in-memory room manager
- display room creation
- player join flow
- automatic VIP assignment
- VIP-only pregame settings updates
- ready-state management
- start-game validation
- room state broadcasting over WebSockets
- Next.js landing page
- Next.js display page
- Next.js player page with join form, ready control, and VIP settings panel

### Deferred Until Next MVP Slice

- topic generation and voting UI
- OpenRouter integrations
- grading and adjudication flows
- ElevenLabs integration
- sound effect playback system
- gameplay state machine beyond pregame and start transition
- persistence, reconnect timers, Redis locks, analytics, and moderation pipelines

## Current Repository Layout

- `backend/`: Python FastAPI service managed with `uv`
- `frontend/`: Next.js application
- `config.yml`: operator configuration
- `PLAN.md`: living product and architecture plan

## Build Order After This Scaffold

1. Finish room creation, joining, VIP assignment, settings locking, and lobby broadcast flow.
2. Add topic-shortlist generation contract and player voting state.
3. Add question generation, reveal-mode timing, and buzz windows.
4. Add grading, adjudication, and score progression.
5. Add audio orchestration, narration sync, and bundled sound packs.
6. Move state from in-memory to durable infrastructure.
