# Environment

Copy `.env.example` and replace only synthetic test IDs. Required values are validated with Zod at startup.

- `APP_MODE`: only `dry-run`
- `TRANSPORT_ADAPTER`: only `mock`
- `TIMEZONE`: IANA timezone, default example `Asia/Jakarta`
- `TARGET_THREAD_ID`: one synthetic target thread
- `AUTHORIZED_SENDER_IDS`: comma-separated synthetic IDs
- `TRIGGER_PHRASES`: comma-separated exact-match whitelist
- `ACTIVE_WINDOWS`: comma-separated `DAY[-DAY]@HH:mm-HH:mm` windows
- `COOLDOWN_MS`, `MAX_EVENT_AGE_MS`: positive integers
- `HEALTH_HOST`, `HEALTH_PORT`: built-in HTTP listener
- `STATE_DB_PATH`: daemon SQLite state path; defaults to `./data/worker.sqlite` and contains only hashed replay/cooldown keys plus timestamps.
- `METRICS_ENABLED`: defaults to `false`; when `true`, enables the loopback-bound JSON `GET /metrics` snapshot with allowlisted counters only.

## Fixture replay

`npm run fixture -- <path>`, `npm run stream`, `npm run benchmark`, and `npm run soak` load the same fail-closed dry-run/mock configuration but use ephemeral in-memory state and override `HEALTH_PORT` to `0`. They never create or modify `STATE_DB_PATH`. Fixtures and JSONL lines must use synthetic data and exactly match the documented `IncomingMessage` shape. `"$now"` is accepted only for synthetic timestamps. Stream mode reuses one in-memory rule engine so dedupe and cooldown persist until EOF or shutdown.

No email, password, account cookie, access token, app-state, or session setting is supported. `.env` is ignored by Git and Docker. Do not place real Facebook identifiers, messages, credentials, sessions, private endpoints, or browser-automation settings in fixtures. The only supported runtime remains `APP_MODE=dry-run` and `TRANSPORT_ADAPTER=mock`; a Messenger group-chat target has no established official integration in this project.
