# Agent Flight Recorder

A local-first black box recorder for LLM agents. Record every LLM call, tool invocation, and system event during an agent run, then inspect, search, replay, and diff runs through a web UI.

## Architecture

```
                         +------------------+
                         |    Web UI        |
                         |  (Next.js :3000) |
                         +--------+---------+
                                  |
                                  | HTTP
                                  v
+-------------+          +------------------+          +-----------+
| Python SDK  | -------> |    Backend API   | -------> |  SQLite   |
+-------------+   HTTP   | (Express :3001)  |          |  (WAL)    |
+-------------+          +------------------+          +-----------+
|   TS SDK    | -------> |                  |
+-------------+          +------------------+

Directory layout:
  backend/           Express + SQLite API server (port 3001)
  ui/                Next.js web dashboard (port 3000)
  sdks/
    python/          Python SDK (pip-installable)
    typescript/      TypeScript SDK (npm-publishable)
  examples/          Example agent scripts
```

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.8+ (for the Python SDK)

### Install dependencies

```bash
# From the project root:
npm run install:all
```

### Run everything

```bash
npm run dev
```

This starts both the backend (port 3001) and the UI (port 3000) concurrently.

Or run them individually:

```bash
# Terminal 1 - Backend
cd backend && npm run dev

# Terminal 2 - UI
cd ui && npm run dev
```

Then open http://localhost:3000 in your browser.

### Docker Setup

The simplest way to run both services:

```bash
# Copy and configure environment
cp .env.example .env

# Start both services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

Data is persisted in a Docker volume (`afr-data`).

### Run the example agent

```bash
cd examples
pip install requests
python simple_agent.py
```

Refresh the UI to see the recorded run.

## API Key Configuration

Authentication is optional. To enable it:

1. Set the `AFR_API_KEY` environment variable:
   ```bash
   export AFR_API_KEY=your-secret-key-here
   ```

2. All API requests must include the header:
   ```
   Authorization: Bearer your-secret-key-here
   ```

3. SDKs pick up `AFR_API_KEY` automatically from the environment.

If `AFR_API_KEY` is not set, all requests are allowed (suitable for local development).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check with version and run count |
| POST | `/api/runs/start` | Start a new run |
| POST | `/api/runs/:id/step` | Record a step (validates run exists) |
| POST | `/api/runs/:id/finish` | Finish a run (validates run exists) |
| GET | `/api/runs` | List runs (paginated, filterable) |
| GET | `/api/runs/:id` | Get a single run |
| GET | `/api/runs/:id/steps` | Get steps for a run |
| POST | `/api/runs/:id/replay` | Replay a run (copy into new run) |
| GET | `/api/runs/compare` | Compare two runs side-by-side |

### Pagination

`GET /api/runs` supports the following query parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | 1 | Page number |
| `limit` | 50 | Items per page (max 200) |

Response format:
```json
{
  "data": [...],
  "total": 142,
  "page": 1,
  "limit": 50
}
```

### Filtering

| Parameter | Description |
|-----------|-------------|
| `status` | Filter by run status (e.g., `running`, `success`, `error`) |
| `model` | Filter by model name |
| `search` | Search in name, tags, and metadata |
| `created_after` | ISO 8601 datetime lower bound |
| `created_before` | ISO 8601 datetime upper bound |

Example: `GET /api/runs?status=success&model=gpt-4&page=2&limit=10`

### Replay

`POST /api/runs/:id/replay` copies a run and all its steps into a new run with status `"replaying"`. The new run's metadata includes `original_run_id` linking back to the source.

Response:
```json
{
  "run_id": "new-uuid",
  "original_run_id": "original-uuid",
  "steps_copied": 5
}
```

### Compare / Diff

`GET /api/runs/compare?left=ID&right=ID` returns both runs with their steps and a structured diff:

```json
{
  "left": { "run": {...}, "steps": [...] },
  "right": { "run": {...}, "steps": [...] },
  "summary": {
    "left_steps_count": 3,
    "right_steps_count": 4,
    "steps_same": 2,
    "steps_changed": 1,
    "steps_added": 1,
    "steps_removed": 0,
    ...
  },
  "step_diffs": [
    { "index": 0, "status": "same", "left": {...}, "right": {...} },
    { "index": 1, "status": "changed", "left": {...}, "right": {...} },
    ...
  ]
}
```

## Python SDK

```bash
pip install -e sdks/python
```

### Basic usage

```python
from agent_flight_recorder import FlightRecorder

recorder = FlightRecorder("http://localhost:3001/api")

with recorder.run(name="My Agent", model="gpt-4", tags=["prod"]):
    recorder.record_llm_call(
        prompt="What is 2+2?",
        response="4",
        model="gpt-4",
        duration=320
    )
    recorder.record_tool_call(
        name="calculator",
        args={"expression": "2+2"},
        result={"answer": 4},
        duration=15
    )
```

### OpenAI auto-instrumentation

```python
from openai import OpenAI
from agent_flight_recorder import FlightRecorder, wrap_openai

client = OpenAI()
recorder = FlightRecorder()
wrap_openai(client, recorder)

with recorder.run(name="OpenAI Agent", model="gpt-4"):
    # All chat.completions.create calls are automatically recorded
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": "Hello"}]
    )
```

### @record decorator for tools

```python
from agent_flight_recorder import record

@record(name="fetch_weather")
def fetch_weather(city: str) -> dict:
    return {"temp": 72, "city": city}

# Calls are automatically recorded as TOOL_CALL steps
result = fetch_weather("London")
```

### Module-level convenience functions

```python
from agent_flight_recorder import run, record_llm_call

with run(name="Quick Run", model="gpt-4"):
    record_llm_call(prompt="Hello", response="Hi there!", duration=200)
```

## TypeScript SDK

```bash
cd sdks/typescript && npm install && npm run build
```

### Basic usage

```typescript
import { FlightRecorder } from "agent-flight-recorder";

const recorder = new FlightRecorder("http://localhost:3001/api");

await recorder.withRun(
  { name: "My Agent", model: "gpt-4", tags: ["test"] },
  async (rec) => {
    await rec.recordLlmCall({
      prompt: "What is 2+2?",
      response: "4",
      model: "gpt-4",
      duration: 320,
    });
    await rec.recordToolCall({
      name: "calculator",
      args: { expression: "2+2" },
      result: { answer: 4 },
      duration: 15,
    });
  }
);
```

### OpenAI auto-instrumentation

```typescript
import OpenAI from "openai";
import { FlightRecorder, wrapOpenAI } from "agent-flight-recorder";

const client = new OpenAI();
const recorder = new FlightRecorder();
wrapOpenAI(client, recorder);

await recorder.withRun({ name: "TS Agent", model: "gpt-4" }, async () => {
  // Automatically recorded
  const completion = await client.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: "Hello" }],
  });
});
```

### Fetch wrapper

```typescript
import { FlightRecorder, wrapFetch } from "agent-flight-recorder";

const recorder = new FlightRecorder();
const cleanup = wrapFetch(recorder);

await recorder.withRun({ name: "Fetch Agent" }, async () => {
  // Calls to OpenAI, Anthropic, etc. are auto-recorded
  await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-4", messages: [...] }),
  });
});

cleanup(); // Restore original fetch
```

### Wrapper pattern

```typescript
const myTool = recorder.wrap("TOOL_CALL", "fetchWeather", async (city: string) => {
  const res = await fetch(`https://api.weather.com/${city}`);
  return res.json();
});

const weather = await myTool("London"); // Automatically recorded
```

## Web UI Pages

- **/** -- Runs list with search, status filter, time range filter, and pagination
- **/runs/[id]** -- Run detail with vertical timeline, replay button, and compare buttons
- **/diff** -- Side-by-side comparison with Myers diff algorithm, color-coded changes, and summary header

## Step Types

| Type | Description |
|------|-------------|
| `LLM_CALL` | A call to a language model (prompt + response) |
| `TOOL_CALL` | An agent tool invocation (name, args, result) |
| `TOOL_RESULT` | A tool result received asynchronously |
| `SYSTEM_EVENT` | Any other system-level event |

## Running Tests

```bash
# Backend API tests
cd backend && npm test

# TypeScript SDK tests
cd sdks/typescript && npm test

# Python SDK tests
cd sdks/python && pip install pytest && pytest tests/
```

## Data Storage

All data is stored in a local SQLite database (WAL mode for concurrent performance) at `backend/data.db`. No external services required. The schema is versioned and auto-migrates on startup.

## Deployment Guide

### Local development
```bash
npm run install:all && npm run dev
```

### Docker (recommended for production)
```bash
cp .env.example .env
# Edit .env to set AFR_API_KEY
docker-compose up -d
```

### Manual production setup
1. Build: `cd backend && npm run build && cd ../ui && npm run build`
2. Set environment variables (see `.env.example`)
3. Run backend: `cd backend && node dist/index.js`
4. Run UI: `cd ui && npm start`
5. Put behind a reverse proxy (nginx/Caddy) for TLS

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes with tests
4. Run all tests: `cd backend && npm test && cd ../sdks/typescript && npm test`
5. Submit a pull request

Please follow the existing code style and include tests for new functionality.

## License

MIT
