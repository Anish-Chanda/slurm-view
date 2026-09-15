import { addGpu } from './tres.js';
import type { GpuRequest } from '../../models/job.js';
import type { GpuInventory } from '../../models/node.js';

// Only `gpu` entries feed the inventory; shared GRES such as `shard`
// is skipped. MIG instances arrive as typed `gpu:<type>` entries.
function emptyInventory(): GpuInventory {
  return { total: 0, allocated: 0, byType: {} };
}

function parseNodeGresField(
  raw: string | null | undefined,
  target: 'total' | 'allocated',
  inventory: GpuInventory
): void {
  if (typeof raw !== 'string') {
    return;
  }
  const text = raw.trim();
  if (text.length === 0 || text === '(null)') {
    return;
  }

  for (const token of text.split(',')) {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      continue;
    }
    // `gpu:N` and `gpu:TYPE:N`, tolerating `(IDX:…)` suffixes.
    const match = trimmed.match(/^gpu(?::([^:(),]+))?:(\d+)/);
    if (!match) {
      continue;
    }
    const gpuType = match[1] ?? 'unknown';
    const count = Number(match[2]);
    if (!Number.isFinite(count) || count < 0) {
      continue;
    }
    const entry = inventory.byType[gpuType] ?? { total: 0, allocated: 0 };
    entry[target] += count;
    inventory.byType[gpuType] = entry;
    inventory[target] += count;
  }
}

function parseNodeGres(
  gres: string | null | undefined,
  gresUsed: string | null | undefined
): GpuInventory {
  const inventory = emptyInventory();
  parseNodeGresField(gres, 'total', inventory);
  parseNodeGresField(gresUsed, 'allocated', inventory);
  return inventory;
}

function mergeGpuRequest(target: GpuRequest, source: GpuRequest): GpuRequest {
  for (const [gpuType, count] of Object.entries(source.byType)) {
    addGpu(target, gpuType, count);
  }
  return target;
}

export { mergeGpuRequest, parseNodeGres };
