# Multi-Client Management & Hit Leaderboard Guide

This guide explains how to manage multiple client accounts simultaneously, run them in parallel on your Alibaba Cloud server, and track sub-millisecond reaction speeds.

---

## 1. Quick Commands Cheat Sheet

| Command                         | Purpose                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| `npm run client:create <name>`  | Scaffold a new client directory and configuration          |
| `npm run client:list`           | View all configured clients, cookie status, and win counts |
| `npm run client -- <name>`      | Run a single client worker in production                   |
| `npm run client:dev -- <name>`  | Run a single client worker in local auto-reload dev mode   |
| `npm run client:hits`           | View the global top fastest reaction leaderboard           |
| `npm run client:hits -- <name>` | View the hit history for a specific client                 |
| `npm run client:pm2`            | Generate `ecosystem.config.cjs` to run all clients in PM2  |

---

## 2. Directory Architecture

Each client has an isolated profile in `clients/<name>/`:

```text
clients/
 ├── client_alpha/
 │    ├── appstate.json         # Client's Facebook session cookies
 │    ├── client.env            # Thread ID, triggers, custom response text
 │    └── data/
 │         ├── worker.sqlite    # Isolated dedupe / cooldown database
 │         └── hits.jsonl       # Proof-of-win hit logs
 └── client_bravo/
      ├── appstate.json
      ├── client.env
      └── data/
           ├── worker.sqlite
           └── hits.jsonl
```

---

## 3. Step-by-Step Onboarding a New Client

### Step 1: Create the Client Profile

```bash
npm run client:create client_alpha
```

### Step 2: Add the Client's Facebook Cookies

Open `clients/client_alpha/appstate.json` and paste their exported cookie array:

```bash
nano clients/client_alpha/appstate.json
```

### Step 3: Customize Their Triggers and Target Chat

Open `clients/client_alpha/client.env`:

```ini
TARGET_THREAD_ID=28798413846428584
AUTHORIZED_SENDER_IDS=100005890597158
TRIGGER_PHRASES=open book, book now
RESPONSE_TEXT=Me down (Client Alpha)
HEALTH_PORT=3001
```

### Step 4: Verify the Setup

```bash
npm run client:list
```

Output:

```text
┌──────────────────────┬─────────────┬─────────────┬────────────────────┬──────────┬───────────┐
│ Client Name          │ Cookies OK? │ Config OK?  │ Target Thread ID   │ Port     │ Hits Won  │
├──────────────────────┼─────────────┼─────────────┼────────────────────┼──────────┼───────────┤
│ client_alpha         │ ✔ Ready     │ ✔ Ready     │ 28798413846428584  │ 3001     │ 0         │
└──────────────────────┴─────────────┴─────────────┴────────────────────┴──────────┴───────────┘
```

---

## 4. Running Multi-Client on Alibaba Cloud (PM2)

To run all clients concurrently in the background on your server:

```bash
# 1. Generate the PM2 ecosystem config
npm run client:pm2

# 2. Launch all client workers simultaneously
pm2 start ecosystem.config.cjs

# 3. Save PM2 processes for auto-reboot
pm2 save
```

To view live logs from all clients at once:

```bash
pm2 logs
```

---

## 5. Viewing Proof-of-Win & Speed Leaderboards

Whenever any client's bot catches a slot, it prints an instant confirmation badge and records the exact millisecond speed to `data/hits.jsonl`.

To view the top fastest reaction times:

```bash
npm run client:hits
```

Output:

```text
⚡ FASTEST WIN / HIT LEADERBOARD
┌──────┬──────────────────────┬──────────────────────┬─────────────┬──────────────────────────┐
│ Rank │ Client Name          │ Trigger Phrase       │ Speed (ms)  │ Recorded Time            │
├──────┼──────────────────────┼──────────────────────┼─────────────┼──────────────────────────┤
│ #1   │ client_alpha         │ open book            │ 18.4 ms     │ 2026-08-16T03:55:12.438Z │
│ #2   │ client_bravo         │ open book            │ 23.1 ms     │ 2026-08-16T03:55:12.443Z │
└──────┴──────────────────────┴──────────────────────┴─────────────┴──────────────────────────┘
```
