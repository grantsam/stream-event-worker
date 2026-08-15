import type { IncomingMessage } from '../../domain/events/incoming-message.js';
import type {
  MessageHandler,
  MessengerTransport,
  TransportHealth,
} from './messenger-transport.js';

export interface MockDispatch {
  threadId: string;
  text: string;
}

export class MockMessengerTransport implements MessengerTransport {
  readonly dispatches: MockDispatch[] = [];
  private handlers = new Set<MessageHandler>();
  private connected = false;
  private failNextSend = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.handlers.clear();
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async sendText(threadId: string, text: string): Promise<void> {
    if (!this.connected) throw new Error('Mock transport is disconnected');
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error('Simulated mock dispatch failure');
    }
    this.dispatches.push({ threadId, text });
  }

  health(): TransportHealth {
    return { connected: this.connected, adapter: 'mock' };
  }

  simulateSendFailure(): void {
    this.failNextSend = true;
  }

  simulateDisconnect(): void {
    this.connected = false;
  }

  async emit(event: IncomingMessage): Promise<void> {
    if (!this.connected) throw new Error('Mock transport is disconnected');
    await Promise.all([...this.handlers].map((handler) => handler(event)));
  }

  async emitDuplicate(event: IncomingMessage): Promise<void> {
    await Promise.all([this.emit(event), this.emit(event)]);
  }
}
