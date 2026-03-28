# Progress Tracker

## Production-Ready Update (2026-03-27)

### All Changes

1. **Backend Error Handling** (`backend/src/index.ts`):
   - Wrapped ALL database operations in try-catch blocks
   - All endpoints return proper HTTP error responses (500 with message)

2. **Input Validation** (`backend/src/index.ts`):
   - POST /api/runs/:id/step and POST /api/runs/:id/finish verify the run exists before operating
   - Returns 404 if run not found

3. **Pagination** (`backend/src/index.ts`):
   - GET /api/runs supports `?page=1&limit=50` query params
   - Returns `{ data: [...], total: number, page: number, limit: number }`
   - Default limit=50, max 200

4. **Filtering** (`backend/src/index.ts`):
   - GET /api/runs supports `?status=`, `?model=`, `?search=`, `?created_after=`, `?created_before=`
   - Search queries name, tags, and metadata fields

5. **API Key Auth** (`backend/src/index.ts`):
   - Optional middleware reads from `AFR_API_KEY` env var
   - If set, requires `Authorization: Bearer <key>` header on all /api routes
   - If not set, allows all requests
   - Both SDKs auto-read `AFR_API_KEY` from environment

6. **Health Check** (`backend/src/index.ts`):
   - GET /api/health returns `{ status: "ok", version: "1.0.0", runs_count: number }`

7. **Replay Endpoint** (`backend/src/index.ts`):
   - POST /api/runs/:id/replay copies run + steps into new run with status "replaying"
   - Stores original_run_id in metadata for linking
   - Returns new run_id, original_run_id, and steps_copied count

8. **Compare Endpoint** (`backend/src/index.ts`):
   - GET /api/runs/compare?left=ID&right=ID returns both runs, steps, structured diff summary
   - Includes step_diffs array with per-step status (same/changed/added/removed)
   - Summary includes step counts, models, durations, statuses, type counts

9. **Database Transactions** (`backend/src/db.ts`):
   - WAL mode enabled for better concurrent performance
   - Schema version table with migration system
   - All multi-statement operations wrapped in db.transaction()
   - Added indexes on status, model, and created_at columns

10. **UI Pagination** (`ui/src/app/page.tsx`):
    - Pagination controls (First/Prev/page numbers/Next/Last)
    - Uses the new paginated API with server-side pagination
    - Auto-resets to page 1 when filters change

11. **UI Time Range Filter** (`ui/src/app/page.tsx`):
    - Time range presets: All time, Last 1h, Last 24h, Last 7d, Last 30d
    - Sends created_after parameter to backend API

12. **Replay Button** (`ui/src/app/runs/[id]/page.tsx`):
    - "Replay this run" button calls POST /api/runs/:id/replay, navigates to new run
    - "Compare with original" button appears when run has original_run_id in metadata
    - "Compare with another run" link pre-fills the diff page
    - Info banner shows replay origin with link to original run

13. **Real Diff Algorithm** (`ui/src/app/diff/page.tsx`):
    - Replaced naive line split with Myers diff algorithm (proper LCS-based)
    - Uses compare API endpoint for structured server-side diff
    - Added lines shown in green, removed lines in red, with line numbers
    - Summary header shows step counts, models, durations, statuses
    - Per-step diff status badges (unchanged, changed, added, removed)
    - Identical steps collapsed by default
    - Supports URL params (?left=ID&right=ID) for deep linking
    - Falls back to simple diff for very large outputs (>10k lines)

14. **Tests Created**:
    - `backend/src/__tests__/api.test.ts` — 25+ tests covering: health check, full run lifecycle (start/step/finish), validation (400 errors), run-not-found (404), pagination, filtering (status/model/search/date), replay, and compare. Uses vitest + supertest.
    - `sdks/python/tests/test_sdk.py` — Tests for FlightRecorder (start/step/finish/context manager/error handling), wrap_openai (records calls, handles missing attrs), @record decorator (records success/error, preserves function name), graceful degradation (server down). Uses pytest + unittest.mock.
    - `sdks/typescript/src/__tests__/sdk.test.ts` — Tests for FlightRecorder (startRun/recordStep/finishRun/recordLlmCall/recordToolCall/withRun/wrap), API key auth, wrapOpenAI, wrapFetch (intercepts LLM calls, passes through non-LLM calls). Uses vitest with mocked fetch.

15. **Python SDK - OpenAI Wrapper** (`sdks/python/agent_flight_recorder/__init__.py`):
    - `wrap_openai(client, recorder)` monkey-patches chat.completions.create to auto-record LLM_CALL steps
    - Extracts response content, role, finish_reason, and token usage
    - Handles errors gracefully (records error in payload)
    - `@record(name="...")` decorator auto-records function calls as TOOL_CALL steps
    - Both support custom recorder or use default singleton
    - Added API key support via `AFR_API_KEY` env var

16. **TypeScript SDK - Fetch Wrapper** (`sdks/typescript/src/index.ts`):
    - `wrapFetch(recorder)` wraps globalThis.fetch to auto-record known LLM API calls
    - Recognizes OpenAI, Anthropic, Google, Cohere, Mistral URLs
    - Returns cleanup function to restore original fetch
    - `wrapOpenAI(client, recorder)` patches chat.completions.create
    - Added API key support via constructor parameter or `AFR_API_KEY` env var

17. **Created .gitignore**: Covers node_modules, dist, .next, *.db, __pycache__, *.pyc, .env, *.log, IDE files, OS files

18. **Created docker-compose.yml**: Backend (port 3001) and UI (port 3000) services with data volume for SQLite persistence, health checks, environment configuration

19. **Created .env.example**: Documents AFR_API_KEY, PORT, DATABASE_URL, NEXT_PUBLIC_API_URL

20. **Updated README.md**: Architecture diagram, Docker setup, API key configuration, pagination/filtering docs, replay/diff docs, deployment guide (local/Docker/manual), contributing guidelines, test instructions

21. **Updated PROGRESS.md**: This file

### Files Modified
- `backend/src/index.ts` — Complete rewrite with all endpoints, error handling, auth, pagination, filtering, replay, compare
- `backend/src/db.ts` — WAL mode, schema versioning, migration system, indexes
- `backend/package.json` — Added vitest, supertest dev dependencies
- `ui/src/lib/api.ts` — Added PaginatedRuns, CompareResult types, fetchRunsPaginated, replayRun, compareRuns, fetchHealth
- `ui/src/app/page.tsx` — Server-side pagination, time range filter, updated to use paginated API
- `ui/src/app/runs/[id]/page.tsx` — Replay button, compare buttons, replay origin banner
- `ui/src/app/diff/page.tsx` — Myers diff algorithm, compare API, summary header, colored diff, URL param support
- `sdks/python/agent_flight_recorder/__init__.py` — wrap_openai, @record decorator, API key support
- `sdks/typescript/src/index.ts` — wrapFetch, wrapOpenAI, API key support
- `sdks/typescript/package.json` — Added vitest dev dependency
- `README.md` — Complete documentation rewrite
- `PROGRESS.md` — This file

### Files Created
- `backend/src/__tests__/api.test.ts` — Backend API tests
- `backend/vitest.config.ts` — Vitest configuration for backend
- `backend/Dockerfile` — Docker build for backend
- `sdks/python/tests/test_sdk.py` — Python SDK tests
- `sdks/typescript/src/__tests__/sdk.test.ts` — TypeScript SDK tests
- `sdks/typescript/vitest.config.ts` — Vitest configuration for TS SDK
- `.gitignore` — Project-wide ignore rules
- `.env.example` — Environment variable documentation
- `docker-compose.yml` — Multi-service Docker setup
- `ui/Dockerfile` — Docker build for UI

## Previous Session (2026-03-27)

### Completed
1. Bug fix: Fixed steps endpoint parameter
2. Next.js Web UI with runs list, run detail timeline, diff view
3. TypeScript SDK with FlightRecorder class
4. Root README.md and package.json

## Architecture Decisions
- UI uses Next.js App Router with client components for data fetching
- TypeScript SDK uses native fetch (no dependencies) for maximum compatibility
- Myers diff algorithm for proper LCS-based diffing in the UI
- WAL mode SQLite for concurrent read/write performance
- Schema versioning for safe database migrations
- Optional API key auth (local-first, no auth required by default)
- Docker support with volume-based SQLite persistence
