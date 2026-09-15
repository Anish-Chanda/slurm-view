// Cooldown for refresh-on-contradiction: one refresh per key per window.
const CONTRADICTION_COOLDOWN_MS = 45_000;

const lastRefreshMsByKey = new Map<string, number>();

function contradictionRefreshAllowed(key: string, nowMs: number): boolean {
  const last = lastRefreshMsByKey.get(key);
  if (last === undefined) {
    return true;
  }
  return nowMs - last >= CONTRADICTION_COOLDOWN_MS;
}

function markContradictionRefresh(key: string, nowMs: number): void {
  lastRefreshMsByKey.set(key, nowMs);
}

function clearContradictionCooldownForTests(): void {
  lastRefreshMsByKey.clear();
}

export {
  CONTRADICTION_COOLDOWN_MS,
  clearContradictionCooldownForTests,
  contradictionRefreshAllowed,
  markContradictionRefresh,
};
