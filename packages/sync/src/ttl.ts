/**
 * Check if a sync should be skipped based on TTL.
 * Returns true if the last sync was within the TTL window and forceSync is not set.
 */
export function shouldSkipSync(
  lastSyncedAt: Date | null,
  ttlHours: number,
  forceSync = false,
): boolean {
  if (forceSync) return false;
  if (!lastSyncedAt) return false;
  const age = Date.now() - lastSyncedAt.getTime();
  return age <= ttlHours * 60 * 60 * 1000;
}
