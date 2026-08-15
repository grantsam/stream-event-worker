import { setTimeout as sleep } from 'node:timers/promises';
import type { IncomingMessage } from '../../domain/events/incoming-message.js';
import {
  loadAppState,
  type AppStateCookie,
  type AppStateValidationResult,
} from './appstate-loader.js';
import type {
  MessageHandler,
  MessengerTransport,
  TransportHealth,
} from './messenger-transport.js';
import { Ws3FcaSessionDriver } from './ws3-fca-driver.js';

export interface RawMessengerMessage {
  messageID: string;
  threadID: string;
  senderID: string;
  body: string;
  timestamp: number | string;
}

export interface MessengerSessionDriver {
  login(cookies: AppStateCookie[]): Promise<void>;
  logout(): Promise<void>;
  onMessage(callback: (message: RawMessengerMessage) => void): () => void;
  sendMessage(threadId: string, text: string): Promise<void>;
  sendTypingIndicator?(threadId: string): Promise<void>;
  markAsRead?(threadId: string): Promise<void>;
  isConnected(): boolean;
}

export interface SessionTransportOptions {
  appStatePath: string;
  typingDelayMs?: number;
  simulateTyping?: boolean;
  driver?: MessengerSessionDriver;
}

export class SessionMessengerTransport implements MessengerTransport {
  private handlers = new Set<MessageHandler>();
  private connected = false;
  private appState?: AppStateValidationResult;
  private readonly driver: MessengerSessionDriver;
  private readonly typingDelayMs: number;
  private readonly simulateTyping: boolean;
  private unsubscribeDriver: () => void = () => {};

  constructor(private readonly options: SessionTransportOptions) {
    this.typingDelayMs = options.typingDelayMs ?? 150;
    this.simulateTyping = options.simulateTyping ?? true;
    this.driver = options.driver ?? new Ws3FcaSessionDriver();
  }

  async connect(): Promise<void> {
    this.appState = loadAppState(this.options.appStatePath);

    await this.driver.login(this.appState.cookies);
    this.connected = true;

    this.unsubscribeDriver = this.driver.onMessage((raw) => {
      this.handleIncoming(raw);
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.unsubscribeDriver();
    this.handlers.clear();
    await this.driver.logout();
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async sendText(threadId: string, text: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Session transport is disconnected');
    }

    if (this.simulateTyping) {
      if (this.driver.markAsRead) {
        try {
          await this.driver.markAsRead(threadId);
        } catch {
          // Non-blocking anti-bot enhancement
        }
      }

      if (this.driver.sendTypingIndicator) {
        try {
          await this.driver.sendTypingIndicator(threadId);
        } catch {
          // Non-blocking anti-bot enhancement
        }
      }

      // Human-like micro jitter: +/- 20%
      const variance = (Math.random() * 0.4 - 0.2) * this.typingDelayMs;
      const effectiveDelay = Math.max(
        20,
        Math.round(this.typingDelayMs + variance),
      );
      await sleep(effectiveDelay);
    }

    await this.driver.sendMessage(threadId, text);
  }

  health(): TransportHealth {
    const isDriverConnected = this.driver.isConnected();
    return {
      connected: this.connected && isDriverConnected,
      adapter: 'live-session',
    };
  }

  getUserId(): string | undefined {
    return this.appState?.userId;
  }

  private handleIncoming(raw: RawMessengerMessage): void {
    if (!this.connected) return;

    const event: IncomingMessage = {
      eventId: String(raw.messageID || `event-${Date.now()}`),
      threadId: String(raw.threadID || ''),
      senderId: String(raw.senderID || ''),
      body: String(raw.body || ''),
      sourceTimestampEpochMs: Number(raw.timestamp) || Date.now(),
      receivedAtEpochMs: Date.now(),
    };

    for (const handler of this.handlers) {
      void handler(event);
    }
  }
}

export class DefaultSessionDriver implements MessengerSessionDriver {
  private connected = false;
  private messageCallback: ((message: RawMessengerMessage) => void) | null =
    null;

  async login(_cookies: AppStateCookie[]): Promise<void> {
    this.connected = true;
  }

  async logout(): Promise<void> {
    this.connected = false;
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

  async sendMessage(_threadId: string, _text: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Default session driver is not connected');
    }
  }

  async sendTypingIndicator(_threadId: string): Promise<void> {
    // No-op for default driver
  }

  async markAsRead(_threadId: string): Promise<void> {
    // No-op for default driver
  }

  isConnected(): boolean {
    return this.connected;
  }

  // Helper for tests/simulation
  emitRaw(message: RawMessengerMessage): void {
    if (this.connected && this.messageCallback) {
      this.messageCallback(message);
    }
  }
}
