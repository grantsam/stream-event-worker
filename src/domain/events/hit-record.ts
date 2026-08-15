export interface ContenderEntry {
  senderId: string;
  senderName?: string;
  body: string;
  deltaMs: number;
  timestamp: string;
  isUs: boolean;
}

export type AdminDecision = 'PENDING' | 'CONFIRMED_WIN' | 'MISSED' | 'DISPUTED';

export interface HitRecord {
  id: string;
  clientName: string;
  timestamp: string;
  epochMs: number;
  threadId: string;
  senderId: string;
  triggerPhrase: string;
  responseText: string;
  reactionTimeMs: number;
  status: 'SUCCESS' | 'FAILED';

  // Side A: Race & Competitor Analysis
  ourRankInQueue?: number; // 1 = 1st to reply in chat queue
  totalContenders?: number; // Total contenders who replied
  timeAheadOfNextMs?: number | null; // Milliseconds ahead of the 2nd contender
  contenders?: ContenderEntry[]; // Chronological list of who replied and when

  // Side B: Official Admin Verdict
  adminDecision?: AdminDecision;
  adminSlotNumber?: number | null; // e.g. Slot 1, 2, 3, 4, 5
  adminNotes?: string;
}
