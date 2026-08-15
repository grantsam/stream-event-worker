export interface IncomingMessage {
  eventId: string;
  threadId: string;
  senderId: string;
  body: string;
  receivedAtEpochMs: number;
  sourceTimestampEpochMs: number;
}
