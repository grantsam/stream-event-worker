# 100% Free 24/7 Render Cloud Deployment Guide

This guide walks you through deploying the Open Book Event Worker to **Render.com** on the free tier (750 hours/month) and keeping it running 24/7 for **$0.00**.

---

## Step 1: Push Your Code to GitHub

Make sure your latest code is pushed to a private GitHub repository:

```powershell
git add .
git commit -m "feat: render deployment ready"
git push origin main
```

_(Note: `.gitignore` already protects your `.env` and `./data/` directories so your private Facebook tokens are never pushed to GitHub)._

---

## Step 2: Create a Web Service on Render

1. Go to [dashboard.render.com](https://dashboard.render.com) and log in.
2. Click **New +** (top right) -> **Web Service**.
3. Select your `Automation-Chat` repository.
4. Fill in the settings:
   - **Name:** `open-book-worker`
   - **Region:** `Singapore` (Asia) or `Frankfurt` (Europe)
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`

---

## Step 3: Configure Environment Variables on Render

In the **Environment Variables** section on Render, add:

| Key                     | Value                                 |
| ----------------------- | ------------------------------------- |
| `NODE_ENV`              | `production`                          |
| `APP_MODE`              | `live`                                |
| `TRANSPORT_ADAPTER`     | `live-session`                        |
| `TARGET_THREAD_ID`      | `28798413846428584` _(your group ID)_ |
| `AUTHORIZED_SENDER_IDS` | `100005890597158` _(your admin UID)_  |
| `TRIGGER_PHRASES`       | `open book`                           |
| `RESPONSE_TEXT`         | `Me down`                             |
| `ACTIVE_WINDOWS`        | `MON-SUN@00:00-23:59`                 |
| `COOLDOWN_MS`           | `5000`                                |
| `MAX_EVENT_AGE_MS`      | `10000`                               |
| `STATE_DB_PATH`         | `/tmp/worker.sqlite`                  |
| `APP_STATE_PATH`        | `./data/appstate.json`                |
| `SIMULATE_TYPING`       | `true`                                |
| `TYPING_DELAY_MS`       | `150`                                 |

---

## Step 4: Add Your `appstate.json` as a Secret File

Because `appstate.json` contains your private session tokens:

1. Scroll down to the **Secret Files** section on Render.
2. Click **Add Secret File**.
3. **Filename:** `data/appstate.json`
4. **Contents:** Open your local `./data/appstate.json` file, copy everything, and paste it into the box.
5. Click **Save Changes**.

Click **Create Web Service** (or **Deploy**). Render will build your TypeScript code and launch the worker!

---

## Step 5: Keep Free Render Awake 24/7 (Prevent 15-Min Sleep)

Render's free tier sleeps after 15 minutes of inactivity. To keep your worker connected to Facebook MQTT 24/7 without spending money:

1. Copy your Render web service URL (e.g. `https://open-book-worker.onrender.com`).
2. Go to [UptimeRobot.com](https://uptimerobot.com) (100% Free, no credit card).
3. Click **Add New Monitor**:
   - **Monitor Type:** `HTTP(s)`
   - **Friendly Name:** `Open Book Worker Health`
   - **URL (or IP):** `https://open-book-worker.onrender.com/healthz`
   - **Monitoring Interval:** `Every 5 minutes`
4. Click **Create Monitor**.

🎉 **Your bot is now running 24/7/365 in the cloud with zero hosting costs on god!**
