// Scope association queries to the local controller's cluster.
import { runCommand } from './command-runner.js';
import type { SlurmContext, SlurmRunFn } from './context.js';
import { UpstreamInvalidError } from './errors.js';

const CLUSTER_CONFIG_TIMEOUT_MS = 10_000;
const CLUSTER_CONFIG_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

const CLUSTER_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

function parseClusterName(stdout: string): string | null {
  const match = stdout.match(/^ClusterName\s*=\s*(\S+)\s*$/m);
  if (!match) {
    return null;
  }
  const name = (match[1] ?? '').trim();
  return CLUSTER_NAME_PATTERN.test(name) ? name : null;
}

async function fetchLocalClusterName(
  context: SlurmContext,
  options: { signal?: AbortSignal } = {}
): Promise<string> {
  const run: SlurmRunFn = context.run ?? runCommand;
  const { stdout } = await run('scontrol', ['show', 'config'], {
    timeoutMs: CLUSTER_CONFIG_TIMEOUT_MS,
    maxBufferBytes: CLUSTER_CONFIG_MAX_BUFFER_BYTES,
    signal: options.signal,
  });
  const name = parseClusterName(stdout);
  if (name === null) {
    throw new UpstreamInvalidError('scontrol show config is missing ClusterName');
  }
  return name;
}

export {
  CLUSTER_CONFIG_MAX_BUFFER_BYTES,
  CLUSTER_CONFIG_TIMEOUT_MS,
  fetchLocalClusterName,
  parseClusterName,
};
