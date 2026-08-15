# Architecture

```text
Transport Adapter
→ Normalized Event
→ Rule Engine
→ Atomic Dedupe
→ Response Coordinator
→ Transport Dispatch
→ Metrics
```

The mock adapter emits transport-independent `IncomingMessage` values. The rule engine evaluates metadata, target thread, sender authorization, age, Jakarta schedule, normalized exact trigger, fingerprint, and cooldown in that order. The daemon uses synchronous SQLite conditional upserts for atomic, restart-safe dedupe and cooldown claims; fixture, stream, benchmark, and soak modes explicitly use in-memory state. The response coordinator records only a dry-run mock dispatch.

JSONL stream replay feeds validated lines sequentially through the same application processor and shared in-memory rule state. Its health listener uses an ephemeral port and closes on EOF or abort. This is local simulation, not a Messenger transport or end-to-end delivery path.

The daemon also maintains bounded runtime counters and latency aggregates. `/metrics` is disabled unless explicitly configured, returns only allowlisted operational data, and shares the existing loopback deployment policy. SQLite expiry cleanup occurs at startup and opportunistically during claims; file-size reclamation is deliberately not performed in the event path.

## Why one process

This is a small realtime worker with one event source, tiny in-memory state, and no horizontal-scale requirement. A single process minimizes serialization, network hops, operational state, and latency. Kafka, Redis, cloud databases, and microservices would add failure modes without solving a current requirement. Persistence can later be introduced behind the existing idempotency/session interfaces if feasibility is established.

## Dependency boundaries

Composition occurs explicitly in `src/app/bootstrap.ts`. Clock, transport, logger, idempotency, and session behavior remain replaceable at narrow interfaces. `UnsupportedLiveTransport` exists only to fail closed; it contains no network implementation. The current transport contract intentionally cannot prove source identity, group classification, platform message IDs, acknowledgements, cursor continuity, reconnect recovery, or E2EE/plaintext behavior for a Messenger group chat.
