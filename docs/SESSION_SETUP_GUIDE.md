# Live Messenger Session Setup Guide

This guide walks you through extracting your Facebook/Messenger session cookies into `appstate.json` to enable live automation.

---

## 1. Export Session Cookies (`appstate.json`)

To authenticate your personal Messenger account without exposing your password, the worker reads an `appstate.json` cookie bundle containing session keys like `c_user`, `xs`, `datr`, and `sb`.

### Recommended Method: Browser Extension

1. Install a trusted cookie export extension in your Chrome/Firefox browser (e.g., **c3c-fbstate**, **Cookie-Editor**, or **EditThisCookie**).
2. Log into [Messenger.com](https://www.messenger.com) or [Facebook.com](https://www.facebook.com).
3. Open the extension while on the Messenger/Facebook tab.
4. Export cookies as **JSON**.
5. Save the file to `./data/appstate.json` in your project root.

> **Format Check:** The file must contain a JSON array with at least `c_user` and `xs` cookie entries:
>
> ```json
> [
>   {
>     "key": "c_user",
>     "value": "1000123456789",
>     "domain": ".facebook.com",
>     "path": "/"
>   },
>   {
>     "key": "xs",
>     "value": "2:abcdef...",
>     "domain": ".facebook.com",
>     "path": "/"
>   }
> ]
> ```

---

## 2. Configure `.env`

Update your `.env` file with live mode and the target thread/sender IDs:

```ini
APP_MODE=live
TRANSPORT_ADAPTER=live-session

# Your Target Group Chat & Whitelist Senders
TARGET_THREAD_ID=1234567890123456
AUTHORIZED_SENDER_IDS=9876543210987654

# Triggers & Response
TRIGGER_PHRASES=open book
RESPONSE_TEXT=Me down

# Anti-Bot / Stealth Protection
APP_STATE_PATH=./data/appstate.json
SIMULATE_TYPING=true
TYPING_DELAY_MS=150

# Active Schedule
TIMEZONE=Asia/Jakarta
ACTIVE_WINDOWS=MON-SUN@00:00-23:59
```

---

## 3. Anti-Bot Safety Best Practices

1. **Run on your local residential network:**
   Never host this worker with your personal cookies on a datacenter server (AWS/DigitalOcean/Hetzner), as Meta's automated security flags sudden IP geolocations.
2. **Keep `SIMULATE_TYPING=true`:**
   The worker automatically sends a read receipt and a typing indicator with randomized micro-jitter (`100ms - 200ms`) before sending the message, defeating 0ms robotic heuristic flags.
3. **Session Refresh:**
   Facebook session cookies expire periodically or when you click "Log out on all devices". If you see authentication errors on startup, simply re-export your fresh `appstate.json`.
