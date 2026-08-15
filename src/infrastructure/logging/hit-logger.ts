import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { HitRecord } from '../../domain/events/hit-record.js';

export class HitLogger {
  constructor(private readonly logPath: string) {
    const fullPath = resolve(logPath);
    mkdirSync(dirname(fullPath), { recursive: true });
  }

  recordHit(record: HitRecord): void {
    const fullPath = resolve(this.logPath);
    const line = JSON.stringify(record) + '\n';
    try {
      appendFileSync(fullPath, line, 'utf8');
    } catch (err) {
      console.error(`Failed to append hit record to ${fullPath}:`, err);
    }

    this.printHitBanner(record);
  }

  updateHit(record: HitRecord): void {
    const hits = this.readHits();
    const index = hits.findIndex((h) => h.id === record.id);
    if (index >= 0) {
      hits[index] = record;
    } else {
      hits.push(record);
    }
    this.writeAllHits(hits);
  }

  updateVerdict(
    id: string,
    decision: HitRecord['adminDecision'],
    slotNumber?: number | null,
    notes?: string,
  ): boolean {
    const hits = this.readHits();
    let updated = false;
    for (const hit of hits) {
      if (hit.id === id) {
        if (decision !== undefined) {
          hit.adminDecision = decision;
        }
        if (slotNumber !== undefined) {
          hit.adminSlotNumber = slotNumber;
        }
        if (notes !== undefined) {
          hit.adminNotes = notes;
        }
        updated = true;
      }
    }

    if (updated) {
      this.writeAllHits(hits);
      return true;
    }
    return false;
  }

  deleteHit(id: string): boolean {
    const hits = this.readHits();
    const initialLen = hits.length;
    const filtered = hits.filter((h) => h.id !== id);
    if (filtered.length !== initialLen) {
      this.writeAllHits(filtered);
      return true;
    }
    return false;
  }

  private writeAllHits(records: HitRecord[]): void {
    const fullPath = resolve(this.logPath);
    const content =
      records.map((r) => JSON.stringify(r)).join('\n') +
      (records.length > 0 ? '\n' : '');
    writeFileSync(fullPath, content, 'utf8');
  }

  printHitBanner(record: HitRecord): void {
    const banner = [
      '╔══════════════════════════════════════════════════════════════════════╗',
      '║                       ⚡ WINNER / HIT RECORDED                        ║',
      '╠══════════════════════════════════════════════════════════════════════╣',
      `║ Client:          ${record.clientName.padEnd(52)}║`,
      `║ Trigger:         ${`"${record.triggerPhrase}"`.padEnd(52)}║`,
      `║ Thread ID:       ${record.threadId.padEnd(52)}║`,
      `║ Sender ID:       ${record.senderId.padEnd(52)}║`,
      `║ Response Sent:   ${`"${record.responseText}"`.padEnd(52)}║`,
      `║ REACTION TIME:   ${(record.reactionTimeMs.toFixed(2) + ' ms').padEnd(52)}║`,
      `║ Timestamp:       ${record.timestamp.padEnd(52)}║`,
      '╚══════════════════════════════════════════════════════════════════════╝',
    ].join('\n');

    console.log('\n' + banner + '\n');
  }

  readHits(): HitRecord[] {
    const fullPath = resolve(this.logPath);
    if (!existsSync(fullPath)) {
      return [];
    }

    try {
      const content = readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      const records: HitRecord[] = [];
      for (const line of lines) {
        try {
          records.push(JSON.parse(line));
        } catch {
          // Ignore corrupted lines
        }
      }
      return records;
    } catch {
      return [];
    }
  }

  static formatLeaderboard(records: HitRecord[], limit = 10): string {
    if (records.length === 0) {
      return 'No recorded hits found.';
    }

    // Sort by fastest reaction time ascending
    const sorted = [...records].sort(
      (a, b) => a.reactionTimeMs - b.reactionTimeMs,
    );
    const top = sorted.slice(0, limit);

    const rows = [
      '┌──────┬──────────────────────┬──────────────────────┬─────────────┬──────────────────────────┐',
      '│ Rank │ Client Name          │ Trigger Phrase       │ Speed (ms)  │ Recorded Time            │',
      '├──────┼──────────────────────┼──────────────────────┼─────────────┼──────────────────────────┤',
    ];

    top.forEach((hit, idx) => {
      const rank = `#${idx + 1}`.padEnd(4);
      const client = hit.clientName.slice(0, 20).padEnd(20);
      const trigger = hit.triggerPhrase.slice(0, 20).padEnd(20);
      const speed = `${hit.reactionTimeMs.toFixed(1)} ms`.padEnd(11);
      const time = hit.timestamp.slice(0, 24).padEnd(24);
      rows.push(`│ ${rank} │ ${client} │ ${trigger} │ ${speed} │ ${time} │`);
    });

    rows.push(
      '└──────┴──────────────────────┴──────────────────────┴─────────────┴──────────────────────────┘',
    );
    return rows.join('\n');
  }
}
