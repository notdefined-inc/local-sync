import type { Engine, LocalChange, OfflineQueue, QueuedChange } from '../types';
import { StorageError } from '../types';

export type OfflineQueueOptions = {
  warnBytes?: number;
  maxBytes?: number;
  pruneAfterMs?: number;
};

const DEFAULT_WARN_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

function generateQueueId(): string {
  const cryptoRef = (globalThis as any)?.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeNumber(value: unknown): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export class SQLiteOfflineQueue implements OfflineQueue {
  private warnBytes: number;
  private maxBytes: number;
  private pruneAfterMs: number;

  constructor(private engine: Engine, options: OfflineQueueOptions = {}) {
    this.warnBytes = options.warnBytes ?? DEFAULT_WARN_BYTES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.pruneAfterMs = options.pruneAfterMs ?? DEFAULT_PRUNE_AFTER_MS;
  }

  async enqueue(change: LocalChange): Promise<void> {
    const id = generateQueueId();
    await this.engine.run(
      `INSERT INTO _ls_outbound_queue (
        id, replicaId, counter, spaceId, tableName, operation, rowJson, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        change.replicaId,
        change.counter,
        change.spaceId,
        change.tableName,
        change.operation,
        change.rowJson,
        change.createdAt
      ]
    );

    await this.checkQueueSize();
  }

  async peek(limit: number = 100): Promise<QueuedChange[]> {
    const result = await this.engine.exec(
      `SELECT id, replicaId, counter, spaceId, tableName, operation, rowJson, createdAt, sentAt, ackedAt
       FROM _ls_outbound_queue
       WHERE ackedAt IS NULL
       ORDER BY createdAt ASC, counter ASC
       LIMIT ?`,
      [limit]
    );

    return result.rows.map(row => ({
      id: (row as any).id as string,
      replicaId: (row as any).replicaId as string,
      counter: normalizeNumber((row as any).counter),
      spaceId: (row as any).spaceId as string,
      tableName: (row as any).tableName as string,
      operation: (row as any).operation as LocalChange['operation'],
      rowJson: (row as any).rowJson as string,
      createdAt: normalizeNumber((row as any).createdAt),
      sentAt: (row as any).sentAt != null ? normalizeNumber((row as any).sentAt) : undefined,
      ackedAt: (row as any).ackedAt != null ? normalizeNumber((row as any).ackedAt) : undefined
    }));
  }

  async markSent(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = Date.now();
    const placeholders = ids.map(() => '?').join(', ');
    await this.engine.run(
      `UPDATE _ls_outbound_queue SET sentAt = ? WHERE id IN (${placeholders})`,
      [now, ...ids]
    );
  }

  async markAcked(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = Date.now();
    const placeholders = ids.map(() => '?').join(', ');
    await this.engine.run(
      `UPDATE _ls_outbound_queue SET ackedAt = ? WHERE id IN (${placeholders})`,
      [now, ...ids]
    );
  }

  async prune(): Promise<number> {
    const cutoff = Date.now() - this.pruneAfterMs;
    const countResult = await this.engine.exec(
      'SELECT COUNT(*) as count FROM _ls_outbound_queue WHERE ackedAt IS NOT NULL AND ackedAt < ?',
      [cutoff]
    );
    const count = normalizeNumber((countResult.rows[0] as any)?.count);
    if (count === 0) {
      return 0;
    }
    await this.engine.run(
      'DELETE FROM _ls_outbound_queue WHERE ackedAt IS NOT NULL AND ackedAt < ?',
      [cutoff]
    );
    return count;
  }

  private async checkQueueSize(): Promise<void> {
    const result = await this.engine.exec(
      'SELECT SUM(LENGTH(rowJson)) as bytes FROM _ls_outbound_queue WHERE ackedAt IS NULL'
    );
    const bytes = normalizeNumber((result.rows[0] as any)?.bytes);
    if (bytes >= this.warnBytes) {
      console.warn(`[OfflineQueue] Queue size warning: ${bytes} bytes`);
    }
    if (bytes >= this.maxBytes) {
      throw new StorageError(
        'OFFLINE_QUEUE_FULL',
        `Offline queue exceeds max size (${bytes} bytes)`,
        false,
        { bytes, maxBytes: this.maxBytes }
      );
    }
  }
}

export function createOfflineQueue(engine: Engine, options?: OfflineQueueOptions): OfflineQueue {
  return new SQLiteOfflineQueue(engine, options);
}
