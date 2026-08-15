# ADR 0001: Single-process event-driven worker

- Status: Accepted
- Date: 2026-08-04

## Context

The feasibility scaffold processes one low-volume event stream and needs deterministic low local latency.

## Decision

Use one Node.js process with adapter interfaces and in-memory atomic dedupe/session state. Use built-in HTTP only for health endpoints.

## Consequences

This minimizes network hops and operations. The daemon persists only hashed replay/cooldown metadata in SQLite across restart; explicit fixture, stream, benchmark, and soak modes remain ephemeral. The process is not horizontally scalable. If future feasibility requires multiple workers, first define delivery and claim semantics, then evolve the existing interfaces rather than splitting into microservices by default.
