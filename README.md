# Open Book Event Worker

Environment/feasibility scaffold for a low-latency, single-process event worker. It accepts synthetic events through a mock transport, validates the configured `open book` rule, and records a mock dry-run dispatch of `Me down`.

> There is no live Messenger integration. This project does not log in to Facebook, store account sessions, call private endpoints, or send real messages.

## Requirements

- Node.js 24 LTS (`.nvmrc` is included)
- npm
- Docker (optional)

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

The development script uses Node 24's optional env-file support and `tsx`. For a compiled run:

```bash
npm run build
node --env-file=.env dist/src/index.js
```

The worker starts the mock transport and exposes `GET /healthz` and `GET /readyz`. With no CLI arguments it stays running as a daemon.

## Replay a mock event

```bash
npm run fixture -- tests/fixtures/fixture-valid.json
```

Fixture JSON must contain exactly the six `IncomingMessage` fields. Timestamp fields accept finite epoch-millisecond numbers or the synthetic `"$now"` sentinel. Fixture mode uses an ephemeral health port, shuts down after one event, and remains mock-only with no network dispatch.

## Replay a JSONL stream

```powershell
Get-Content tests/fixtures/events.jsonl | npm run stream
```

Successful lines include `line`, `ok`, `eventId`, `decision`, `status`, and `reasonCode`. Invalid JSON/schema emits an `ok:false` record while later lines continue. Events are sequential, so order, dedupe, and cooldown persist through the stream. EOF or `Ctrl+C` shuts down gracefully.

## Local benchmark and soak

```powershell
npm run benchmark -- --events 10000
npm run soak -- --duration 10m
```

These commands report only local worker/mock-dispatch throughput, correctness, memory samples, and latency percentiles. They exclude Messenger, network, E2EE, queues, and acknowledgements.

## Durable local state

The daemon uses SQLite at `STATE_DB_PATH` (default `./data/worker.sqlite`) to preserve active dedupe and cooldown claims across restarts. It stores only fingerprints, hashed thread scopes, and expiry timestamps—never raw bodies, account credentials, cookies, tokens, or session data.

Fixture, stream, benchmark, and soak commands intentionally use ephemeral in-memory state. Docker stores daemon state at `/data/worker.sqlite` on its `worker-state` named volume.

## Operations and local regression

Runtime metrics are disabled by default. Set `METRICS_ENABLED=true` only for local, loopback-bound `GET /metrics`; it returns allowlisted counters and aggregates, not event/message/session data.

```powershell
npm run regression
```

The restart regression uses temporary SQLite and synthetic mock events. It verifies local dedupe persistence after one controlled restart; it is not proof of real source delivery or Messenger recovery.

## Validation

```bash
npm run check
npm test
```

## Docker

```bash
docker compose up --build
curl http://127.0.0.1:3000/healthz
curl http://127.0.0.1:3000/readyz
```

The final image runs as the built-in non-root `node` user. Only the health port is published.

## Status and limitations

The target under feasibility review is a multi-participant Messenger group chat. This scaffold proves local processing, boundaries, failure behavior, persistence, and observability only. It does **not** prove official group-chat support, Messenger event delivery, E2EE reconstruction, acknowledgements, reconnect behavior, account safety, platform policy compliance, or end-to-end latency. No Facebook login, credential, cookie, session, private endpoint/protocol, browser automation, or live adapter is included. See `docs/FEASIBILITY_EVIDENCE.md`: no live-transport gate is approved.
