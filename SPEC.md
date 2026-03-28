
You are a senior full‑stack engineer building a developer tool.

PROJECT
Build “Agent Flight Recorder”: a local‑first “black box recorder” for LLM agents that captures every tool call, state change, and prompt so developers can replay, diff, and debug runs.

HIGH‑LEVEL OBJECTIVE
Deliver a minimal but robust, open‑source MVP that:
- Exposes a simple HTTP/CLI ingestion API and thin language SDKs (Python + TypeScript) to log structured traces of agent runs.
- Stores traces locally (SQLite or JSONL) with a schema that can support many runs without over‑engineering.
- Provides a small web UI (Next.js) that lets a developer:
  - List recent runs with filters.
  - Inspect a single run’s step‑by‑step timeline (prompts, responses, tool calls, intermediate state).
  - Replay a run (re‑execute the same LLM + tools through a stub interface) and compare outputs vs the original.
  - Diff two runs side‑by‑side, highlighting changed prompts and outputs.

TARGET USER / UX CONSTRAINTS
- Target user: individual devs or small teams hacking on agents (LangChain, OpenAI agents, custom frameworks, etc.).
- Integration time must feel “one‑line”: they should be able to wrap their existing LLM client or agent step function in minutes.
- Local‑first by default: no cloud account, no login, just run a server and attach SDKs.
- The UI should still be usable on a laptop with hundreds of traces.

TECH STACK
- Backend: Node.js (TypeScript, Express/Fastify) or Python (FastAPI). Pick one and stay consistent.
- Storage: SQLite for trace data, using a simple migration system. Avoid ORMs that slow you down; a thin query layer is fine.
- UI: Next.js (React, TypeScript, Tailwind or minimal CSS).
- SDKs: 
  - Python package (pip‑installable).
  - TypeScript/Node package (npm‑publishable).
- LLM calls for replay: don’t hard‑code OpenAI; call a generic HTTP endpoint described by the user in config.

CORE FUNCTIONAL REQUIREMENTS

1) Trace data model
- Define a schema that can represent:
  - Run: id, created_at, updated_at, status, model, temperature, metadata (JSON), labels/tags.
  - Steps: ordered list per run with type (LLM_CALL, TOOL_CALL, TOOL_RESULT, SYSTEM_EVENT), timestamps, duration.
  - LLM call payloads: prompt/system messages, parameters, model version, response text, token counts if provided.
  - Tool calls: tool name, arguments, result payload, success/error, duration.
  - Custom “state snapshots”: optional JSON blobs users can attach for debugging.
- Provide a simple migration/init script so “first run” creates the SQLite schema.

2) Ingestion service
- HTTP API endpoints:
  - POST /api/runs/start → create a run, return run_id.
  - POST /api/runs/:id/step → append a step (LLM call, tool call, result, etc.).
  - POST /api/runs/:id/finish → mark run as completed with status (success/failure).
  - GET /api/runs, GET /api/runs/:id, GET /api/runs/:id/steps → used by the UI.
- Accept a shared API key from env or config; but keep auth minimal for local use.
- Ensure idempotency where reasonable (e.g., replayed logs should not corrupt existing runs).

3) Language SDKs
- Python SDK:
  - Provide a context manager / decorator like:

      with flight_recorder.run(name="my_agent_run") as run:
          # wrap LLM calls and tool calls
          result = my_agent()
  
  - A small LLM client wrapper (e.g., for OpenAI or generic HTTP) that:
    - Logs request/response payloads as steps.
    - Lets users log tool calls with `record_tool_call(name, args, result)`.
  - Good defaults but non‑blocking: if the server is down, the agent should still function (maybe log warnings).

- TypeScript SDK:
  - Similar API for Node.js agents, including a wrapper around fetch‑based LLM calls.
  - Provide a simple middleware pattern to wrap a function and automatically log its steps.

4) Web UI
- Runs list page:
  - Table of recent runs with id, created_at, model, status, duration, and tags.
  - Filters: by status, model, time range, search by substring in metadata.
- Run detail / timeline:
  - Vertical timeline view of steps (LLM calls, tool calls/results, system events).
  - For an LLM step: show prompt and response in collapsible panels.
  - For a tool call: show arguments and result in JSON viewer.
- Diff view:
  - Choose two runs.
  - Show:
    - Summary: models, status, durations.
    - Step‑wise comparison where positions match by index.
    - Text diff (line‑based) for prompts and outputs.

5) Replay + diff functionality
- Provide an abstract “replay adapter”:
  - For the MVP, assume the user can provide a replay function that:
    - Takes the original step data and re‑executes the LLM/tool with the same inputs.
  - Store re‑execution outputs separately to compare with original.
- UI:
  - Button “Replay this run” on run detail page that triggers backend replay for supported steps.
  - Show any differences in outputs highlighted.

NON‑GOALS FOR MVP
- Multi‑tenant auth, teams, RBAC.
- Hosted SaaS.
- Heavy analytics dashboards.
- Vendor‑specific instrumentation (keep generic, but provide minimal LangChain/OpenAI examples).

QUALITY BAR
- Production‑grade code structure but minimal: clear modules, no over‑engineering.
- Basic tests for:
  - Trace insertion/retrieval.
  - SDK logging a simple mock agent run.
  - UI builds and hits backend APIs.
- Developer documentation:
  - README explaining how to run the server and UI locally via one command (e.g., docker‑compose or `pnpm dev`).
  - Quick integration examples for Python and TypeScript agents.

DELIVERABLES
- Backend service with working HTTP API and SQLite persistence.
- Next.js UI for runs list, run detail/timeline, and diff view.
- Python and TypeScript SDKs ready for local `pip install -e .` / `npm link`.
- Example project:
  - Tiny sample agent script that uses the SDK, runs a few steps, and produces traces visible in the UI.

WORKFLOW
- Start by sketching the data model and API contract.
- Implement backend + DB migrations.
- Implement Python SDK first with a minimal example agent.
- Implement UI over the API.
- Add replay/diff minimally but correctly.
- Then implement the TypeScript SDK and finalize docs.
