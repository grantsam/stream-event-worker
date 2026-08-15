import type {
  MessageHandler,
  MessengerTransport,
  TransportHealth,
} from './messenger-transport.js';

const MESSAGE =
  'Live transport is not configured and requires a separate feasibility and security review.';

export class UnsupportedLiveTransport implements MessengerTransport {
  async connect(): Promise<void> {
    throw new Error(MESSAGE);
  }
  async disconnect(): Promise<void> {
    throw new Error(MESSAGE);
  }
  subscribe(_handler: MessageHandler): () => void {
    throw new Error(MESSAGE);
  }
  async sendText(_threadId: string, _text: string): Promise<void> {
    throw new Error(MESSAGE);
  }
  health(): TransportHealth {
    return { connected: false, adapter: 'unsupported-live' };
  }
}
