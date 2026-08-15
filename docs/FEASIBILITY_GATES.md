# Live Transport Feasibility Gates

Target profile: **multi-participant Messenger group chat**. This profile must not be treated as equivalent to a Facebook Page/business inbox or a one-to-one conversation unless official documentation explicitly says so.

A real transport must not be developed or enabled until all gates below have official evidence and named approval:

1. Official API capability explicitly supports this exact group-chat target.
2. Supported account/identity, authorization, token, permission, and app-review model are verified.
3. Group administrator and participant consent plus platform/group policy are reviewed.
4. Target thread and sender IDs can be read and verified from an official source.
5. Event ordering, duplicates, cursor/replay, reconnect, gap detection, and reconciliation are defined.
6. E2EE/plaintext boundary is explicitly documented and approved.
7. Send, API acknowledgement, retry, idempotency, rate limits, and moderation errors are defined.
8. Account-restriction, data retention, revocation, rollback, and incident risk are accepted.

Passing this local scaffold is not evidence that any gate above has passed. The current fact-based status and required proof are maintained in [FEASIBILITY_EVIDENCE.md](FEASIBILITY_EVIDENCE.md); no gate is approved.

Do not substitute private endpoints, reverse-engineered protocols, password automation, cookies, account sessions, or browser automation for missing official support.
