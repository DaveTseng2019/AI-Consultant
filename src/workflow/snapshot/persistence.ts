import { host } from '../../host';
import { eventFromSnapshotPersistenceFailure } from '../../diagnostics/eventLog';
import { recordEventLog } from '../../diagnostics/eventLogStore';
import { redactSnapshot } from './redact';
import { isSnapshotRedactionTier, type ExecutionSnapshot, type SnapshotRedactionTier } from './types';

export interface SnapshotPersistenceOptions {
  enabled?: boolean;
  tier?: SnapshotRedactionTier;
}

export async function persistSnapshotIfEnabled(
  snapshot: ExecutionSnapshot,
  options: SnapshotPersistenceOptions | undefined,
): Promise<void> {
  if (options?.enabled !== true) return;
  try {
    await writeSnapshot(snapshot, options.tier);
  } catch (reason) {
    recordEventLog(eventFromSnapshotPersistenceFailure(snapshot.snapshotId, reason));
  }
}

/**
 * Writes one snapshot at `tier`, letting a failure through. The archive path needs the file on disk
 * before the script reads it, so swallowing the failure there would surface as "snapshot not found".
 */
export async function writeSnapshot(
  snapshot: ExecutionSnapshot,
  tier: SnapshotRedactionTier | undefined,
): Promise<void> {
  const resolved = isSnapshotRedactionTier(tier) ? tier : 'metadata-only';
  const redacted = await redactSnapshot(snapshot, resolved);
  await host.snapshot.save(redacted.snapshotId, JSON.stringify(redacted));
}
