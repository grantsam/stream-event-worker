# Feasibility Evidence Matrix

## Target profile

| Field               | Value                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target              | Multi-participant Messenger group chat                                                                                                                          |
| Identity assumption | Personal Messenger identity unless official documentation explicitly establishes another supported model                                                        |
| Project owner       | User/project owner                                                                                                                                              |
| Capability status   | `NOT_ESTABLISHED`                                                                                                                                               |
| Decision status     | `BLOCKED`                                                                                                                                                       |
| Current conclusion  | Official support for this exact group-chat target has not been verified. A Page/business inbox API must not be extrapolated to a personal Messenger group chat. |

This repository remains a local mock-only/dry-run scaffold. Research tooling could not independently verify current official Meta documentation. That is neither proof of support nor non-support, but it is sufficient to block adapter work until exact official evidence is reviewed.

## Status values

- `NOT_STARTED`: no evidence has been collected.
- `LOCAL_ONLY_EVIDENCE`: mock-worker evidence exists but cannot demonstrate a real transport property.
- `NOT_ESTABLISHED`: official capability for the exact target profile is not proven.
- `BLOCKED`: required official evidence, owner decision, policy review, or approval is missing.
- `APPROVED`: reserved for a named approver after all stated evidence and policy requirements are met. No gate is approved.

## Official-source evidence register

Only official product documentation may establish capability. Record an exact URL, product/title, version/date, reviewed date, section heading and short quotation before relying on a claim. Page-only, business-inbox, or one-to-one material is **target-mismatched** unless it explicitly covers this target profile.

| Evidence ID  | Exact official URL | Product/title and version/date | Reviewed date | Section and quoted claim | Target alignment  | Identity, token, permission model | Group consent/policy | Source event and stable IDs | Send/ACK/idempotency | Cursor/replay/reconnect | E2EE boundary | Status    | Gap                                    | Owner              |
| ------------ | ------------------ | ------------------------------ | ------------- | ------------------------ | ----------------- | --------------------------------- | -------------------- | --------------------------- | -------------------- | ----------------------- | ------------- | --------- | -------------------------------------- | ------------------ |
| OFFICIAL-001 | Not yet verified   | Not yet verified               | —             | —                        | `NOT_ESTABLISHED` | —                                 | —                    | —                           | —                    | —                       | —             | `BLOCKED` | Official support has not been verified | User/project owner |

Do not add credentials, cookies, tokens, raw messages, private traces, or screenshots containing personal data to this register.

## Gate matrix

| Gate                                         | Status              | Current evidence                                        | Missing evidence / decision                                       | Required owner     |
| -------------------------------------------- | ------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- | ------------------ |
| Official API capability for this group chat  | BLOCKED             | None for this exact target                              | Official documentation explicitly supporting group conversations  | User/project owner |
| Target thread can be read reliably           | BLOCKED             | Synthetic target-thread equality test only              | Approved official source, stable read test, failure rate          | User/project owner |
| Sender and thread IDs verified               | BLOCKED             | Synthetic allowlist/equality checks                     | Official identity provenance and spoofing review                  | User/project owner |
| Participant consent and group/admin policy   | BLOCKED             | Requirement documented                                  | Consent, administrator controls, policy/legal review              | User/project owner |
| E2EE plaintext boundary established          | NOT_STARTED         | None                                                    | Official plaintext/event boundary and security review             | User/project owner |
| Official source events and stable IDs        | NOT_ESTABLISHED     | Local synthetic events only                             | Event payload, message/thread/sender IDs, ordering and duplicates | User/project owner |
| Send and acknowledgement                     | LOCAL_ONLY_EVIDENCE | Mock `sendText` records an in-process dispatch          | Official send semantics, ACK definition, retry/idempotency policy | User/project owner |
| Cursor, replay, reconnect, reconciliation    | NOT_STARTED         | Mock lifecycle only                                     | Official cursor/replay/reconnect/gap behavior                     | User/project owner |
| No event gaps in soak test                   | LOCAL_ONLY_EVIDENCE | Local benchmark/soak/regression counts synthetic events | Source sequence/cursor semantics and reconciliation               | User/project owner |
| Credential/account restriction risk accepted | BLOCKED             | Repository forbids credentials and sessions             | Risk decision, policy approval, incident/revocation plan          | User/project owner |
| Group/platform rules reviewed                | BLOCKED             | Requirement documented                                  | Written platform, group, and legal/policy review                  | User/project owner |

## Hard stops

No live adapter design, prototype, dependency, configuration, fixture, credential, login, or network test may proceed while any of these is true:

1. Official documentation does not explicitly support the exact group-chat target.
2. The documented identity model is unclear or only covers a Page/business identity rather than the target personal/group identity.
3. Required permissions, token type, app review, participant consent, administrator control, or group policy are unclear.
4. Inbound events, stable identifiers, ordering, duplicate behavior, send semantics, acknowledgement, rate limits, or moderation errors are undefined.
5. Cursor, replay, gap detection, reconciliation, reconnect, or session recovery behavior is absent.
6. The E2EE/plaintext boundary is unknown.
7. The apparent route needs password automation, cookie/session reuse, private endpoints, reverse-engineered protocol, or browser automation.
8. Official evidence is stale, inaccessible, contradictory, target-mismatched, or unreviewed.
9. Account-risk, policy, incident, rollback, and revocation ownership are absent.

## Required proof before reconsideration

The decision may move only after the project owner records official evidence for all of the following:

- exact product support for this multi-participant group-chat surface;
- supported account/identity, authorization, permissions, token issuance, and app-review model;
- group administrator and participant consent/policy model;
- inbound event delivery, stable message/thread/sender IDs, ordering, duplicate, rate-limit, and failure semantics;
- outbound send, API acknowledgement, retry, and idempotency semantics;
- cursor, replay, reconnect, gap detection, and reconciliation behavior;
- E2EE and official plaintext/event boundary;
- platform policy, account restrictions, data retention, revocation, rollback, and incident plan;
- exact official source URLs, review date, method, scope, result, remaining risk, and named approval.

User approval of a future review does not authorize credentials, login automation, cookies, app state, private protocols, browser automation, or live traffic.

## Local evidence that is valid

The following are supported only for local mock execution:

- strict dry-run/mock configuration;
- exact trigger, sender, thread, schedule, stale-event, dedupe, and cooldown decisions;
- SQLite persistence of hashed replay/cooldown metadata across restart;
- graceful shutdown, health/readiness, local JSONL, benchmark, soak, runtime metrics, and restart regression;
- absence of credentials, cookies, raw bodies, and live network dispatch in the project.

This evidence does not establish Messenger group capability, platform approval, delivery, acknowledgements, E2EE handling, reconnect recovery, source reliability, or end-to-end latency.
