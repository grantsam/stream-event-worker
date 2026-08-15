import type { IncomingMessage } from '../../domain/events/incoming-message.js';

export type MessageHandler = (event: IncomingMessage) => Promise<void>;

export interface TransportHealth {
  connected: boolean;
  adapter: string;
}

export interface MessengerTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(handler: MessageHandler): () => void;
  sendText(threadId: string, text: string): Promise<void>;
  health(): TransportHealth;
}
