import login from 'ws3-fca';
import type { AppStateCookie } from './appstate-loader.js';
import type {
  MessengerSessionDriver,
  RawMessengerMessage,
} from './session-messenger-transport.js';

interface FcaApi {
  listenMqtt: (
    callback: (err: unknown, event: Record<string, unknown>) => void,
  ) => () => void;
  sendMessage: (
    msg: string | { body: string },
    threadID: string,
    replyToMessage?: string | null,
  ) => Promise<unknown>;
  sendTypingIndicator?: (typing: boolean, threadID: string) => Promise<unknown>;
  markAsSeen?: (timestamp?: number) => Promise<unknown>;
  logout?: (callback?: () => void) => Promise<unknown>;
}

export class Ws3FcaSessionDriver implements MessengerSessionDriver {
  private api: FcaApi | null = null;
  private connected = false;
  private messageCallback: ((message: RawMessengerMessage) => void) | null =
    null;
  private stopListening: (() => void) | null = null;

  async login(cookies: AppStateCookie[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const appState = cookies.map((c) => ({
        key: c.key,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
      }));

      type LoginFunction = (
        credentials: { appState: unknown[] },
        options: Record<string, unknown>,
        callback: (err: unknown, api: FcaApi) => void,
      ) => void;

      const mod = login as unknown as Record<string, unknown>;
      const loginFn = (
        typeof login === 'function'
          ? login
          : typeof mod?.login === 'function'
            ? mod.login
            : typeof (mod?.default as Record<string, unknown>)?.login ===
                'function'
              ? (mod.default as Record<string, unknown>).login
              : (mod?.default ?? login)
      ) as LoginFunction;

      if (typeof loginFn !== 'function') {
        return reject(
          new Error(
            'Failed to load ws3-fca login function. Check module exports.',
          ),
        );
      }

      loginFn(
        { appState },
        {
          listenEvents: true,
          selfListen: true,
          autoMarkRead: false,
          autoMarkDelivery: false,
          updatePresence: true,
        },
        (err: unknown, apiInstance: FcaApi) => {
          if (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reject(
              new Error(
                `Facebook MQTT Login failed: ${message}. Check your appstate.json tokens.`,
                { cause: err },
              ),
            );
          }

          this.api = apiInstance;
          this.connected = true;

          this.stopListening = apiInstance.listenMqtt(
            (listenErr: unknown, event: Record<string, unknown>) => {
              if (listenErr) {
                console.error('MQTT stream error:', listenErr);
                return;
              }

              if (
                event &&
                (event.type === 'message' || event.type === 'message_reply')
              ) {
                console.log(
                  `[LIVE MQTT MESSAGE] threadID="${event.threadID}" senderID="${event.senderID}" body="${event.body}"`,
                );

                if (this.messageCallback) {
                  let timestampMs = Number(event.timestamp) || Date.now();
                  if (timestampMs < 10_000_000_000) {
                    timestampMs *= 1000;
                  }
                  this.messageCallback({
                    messageID: String(event.messageID ?? ''),
                    threadID: String(event.threadID ?? ''),
                    senderID: String(event.senderID ?? ''),
                    body: String(event.body ?? ''),
                    timestamp: timestampMs,
                  });
                }
              }
            },
          );

          resolve();
        },
      );
    });
  }

  async logout(): Promise<void> {
    this.connected = false;
    if (this.stopListening) {
      try {
        this.stopListening();
      } catch {
        // ignore
      }
      this.stopListening = null;
    }
    if (this.api?.logout) {
      try {
        await new Promise<void>((resolve) => {
          this.api?.logout?.(() => resolve());
        });
      } catch {
        // ignore
      }
    }
    this.api = null;
    this.messageCallback = null;
  }

  onMessage(callback: (message: RawMessengerMessage) => void): () => void {
    this.messageCallback = callback;
    return () => {
      if (this.messageCallback === callback) {
        this.messageCallback = null;
      }
    };
  }

  async sendMessage(threadId: string, text: string): Promise<void> {
    if (!this.connected || !this.api) {
      throw new Error('Facebook MQTT session is not connected');
    }

    try {
      await this.api.sendMessage(text, String(threadId));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to send message to thread ${threadId}: ${message}`,
        { cause: err },
      );
    }
  }

  async sendTypingIndicator(threadId: string): Promise<void> {
    if (this.connected && this.api?.sendTypingIndicator) {
      try {
        await this.api.sendTypingIndicator(true, String(threadId));
      } catch {
        // Non-blocking anti-bot stealth
      }
    }
  }

  async markAsRead(_threadId: string): Promise<void> {
    if (this.connected && this.api?.markAsSeen) {
      try {
        await this.api.markAsSeen(Date.now());
      } catch {
        // Non-blocking anti-bot stealth
      }
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
