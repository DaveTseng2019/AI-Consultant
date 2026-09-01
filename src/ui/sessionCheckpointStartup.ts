import { host, type StoredSnapshotInfo } from '../host';
import { parseSessionCheckpoint, type SessionCheckpoint } from '../workflow/sessionCheckpoint';

export interface StartupSessionCheckpointNotice {
  checkpoint: SessionCheckpoint;
  replaySnapshot?: StoredSnapshotInfo;
}

export async function loadStartupSessionCheckpointNotice(): Promise<StartupSessionCheckpointNotice | undefined> {
  const raw = await host.sessionCheckpoint.load();
  if (!raw) return undefined;

  const checkpoint = parseSessionCheckpoint(raw);
  if (!checkpoint) return undefined;

  return {
    checkpoint,
    replaySnapshot: await matchingSnapshot(checkpoint),
  };
}

export async function clearStartupSessionCheckpointNotice(): Promise<void> {
  try {
    await host.sessionCheckpoint.clear();
  } catch {
    // Startup checkpoint dismissal is best-effort.
  }
}

/** The snapshot the interrupted run itself wrote, or nothing.
 *
 *  Matching on graphId alone offered the previous run of the same graph, because a run killed with
 *  the app never reaches the executor's finally block and so leaves no snapshot of its own. The
 *  checkpoint is opened one line before the snapshot is, so anything this run wrote carries a
 *  createdAt at or after startedAt -- both plain UTC ISO strings, which compare in order. The list
 *  arrives newest first, so the first survivor is the right one. */
async function matchingSnapshot(checkpoint: SessionCheckpoint): Promise<StoredSnapshotInfo | undefined> {
  try {
    const snapshots = await host.snapshot.list();
    return snapshots.find(
      (snapshot) =>
        snapshot.graphId === checkpoint.graphId &&
        snapshot.createdAt !== undefined &&
        snapshot.createdAt >= checkpoint.startedAt,
    );
  } catch {
    return undefined;
  }
}
