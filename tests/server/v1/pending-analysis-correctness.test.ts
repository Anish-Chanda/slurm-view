// Regression tests for pending-analysis.
import { parseTargetedJobStdout } from '../../../src/server/adapters/slurm/targeted-job.js';
import type { MemoryRequirement } from '../../../src/server/adapters/slurm/targeted-job.js';
import { fetchAssocSnapshot, parseAssocStdout } from '../../../src/server/adapters/slurm/sacctmgr-assoc.js';
import { normalizeJob } from '../../../src/server/adapters/slurm/jobs.js';
import { fetchLocalClusterName, parseClusterName } from '../../../src/server/adapters/slurm/cluster-name.js';
import { UpstreamInvalidError } from '../../../src/server/adapters/slurm/errors.js';
import { parseReservationJson, parseReservationText } from '../../../src/server/adapters/slurm/reservation.js';
import { parseQosStdout } from '../../../src/server/adapters/slurm/sacctmgr-qos.js';
import { fetchReservationDetail } from '../../../src/server/adapters/slurm/reservation.js';
import { CommandError } from '../../../src/server/adapters/slurm/command-runner.js';
import { SlurmUpstreamError } from '../../../src/server/adapters/slurm/errors.js';
import { JobsCache } from '../../../src/server/cache/jobs-cache.js';
import { AssocCache } from '../../../src/server/cache/assoc-cache.js';
import { QosCache } from '../../../src/server/cache/qos-cache.js';
import { SprioWeightsCache } from '../../../src/server/cache/sprio-weights-cache.js';
import type { SlurmRunFn } from '../../../src/server/adapters/slurm/context.js';
import { PendingAnalysisService } from '../../../src/server/services/pending-analysis-service.js';
import { clearContradictionCooldownForTests } from '../../../src/server/services/pending-analysis/contradiction-cooldown.js';
import { analyzeResources } from '../../../src/server/services/pending-analysis/analyzers/resources.js';
import { analyzeAssocLimits } from '../../../src/server/services/pending-analysis/analyzers/association-limits.js';
import { analyzeQosLimits } from '../../../src/server/services/pending-analysis/analyzers/qos-limits.js';
import { analyzePriority } from '../../../src/server/services/pending-analysis/analyzers/priority.js';
import { analyzeDependency } from '../../../src/server/services/pending-analysis/analyzers/dependency.js';
import { analyzeRequiredNodes } from '../../../src/server/services/pending-analysis/analyzers/scope.js';
import { createJobSnapshot } from '../../../src/server/cache/jobs-cache.js';
import { createNodeSnapshot } from '../../../src/server/cache/nodes-cache.js';
import { buildAssociationStore, ancestorChainById, normalizeAssociationId, normalizeParentAssociationId, parsePolicyTresLimit, resolveAssociation } from '../../../src/server/models/association.js';
import type { AssociationEntry } from '../../../src/server/models/association.js';
import { buildQosStore, emptyQosEntry } from '../../../src/server/models/qos.js';
import {
  remainingSeconds,
  sumRunMinutes,
} from '../../../src/server/services/pending-analysis/usage.js';
import { effectiveAssocTresLimit } from '../../../src/server/services/pending-analysis/policy.js';
import type { Job } from '../../../src/server/models/job.js';
import type { ClusterNode } from '../../../src/server/models/node.js';
import type { AnalyzerContext } from '../../../src/server/services/pending-analysis/types.js';

const PARSER = 'v0.0.45' as const;

function makeJob(partial: Partial<Job> & { id: string }): Job {
  return {
    jobId: partial.id,
    arrayJobId: null,
    arrayTaskId: null,
    partition: 'debug',
    name: 'job',
    user: 'alice',
    account: 'research',
    qos: 'normal',
    state: 'RUNNING',
    stateFlags: [],
    stateReason: null,
    timeLimit: { kind: 'finite', seconds: 3600 },
    submitTime: new Date('2026-01-01T00:00:00Z'),
    eligibleTime: null,
    startTime: new Date('2026-01-01T00:00:00Z'),
    endTime: null,
    priority: 100,
    taskCount: null,
    cpusPerTask: null,
    constraints: null,
    reservation: null,
    nodeCount: 1,
    nodeExpression: null,
    requested: { cpus: 4, memoryMiB: 8192, nodes: 1, gpus: { total: 0, byType: {} } },
    allocated: { cpus: 4, memoryMiB: 8192, nodes: 1, gpus: { total: 0, byType: {} }, gpuPresent: true },
    workdir: null,
    command: null,
    stdoutPath: null,
    stderrPath: null,
    dependency: null,
    exitCode: null,
    derivedExitCode: null,
    wckey: null,
    batchHost: null,
    flags: [],
    ...partial,
  };
}

function makeNode(partial: Partial<ClusterNode> & { name: string }): ClusterNode {
  return {
    partitions: ['debug'],
    state: 'IDLE',
    stateFlags: [],
    reason: null,
    cpus: 8,
    effectiveCpus: 8,
    allocCpus: 0,
    allocIdleCpus: 0,
    cpuLoad: null,
    totalMemoryMiB: 16384,
    allocMemoryMiB: 0,
    freeMemoryMiB: 16384,
    gresRaw: null,
    gresUsedRaw: null,
    gpu: { total: 0, allocated: 0, byType: {} },
    ...partial,
  };
}

function makeCtx(
  pending: Job,
  opts: {
    jobs?: Job[];
    nodes?: ClusterNode[];
    assocEntries?: AssociationEntry[];
    memory?: MemoryRequirement;
    partitionTable?: AnalyzerContext['partitionTable'];
    run?: SlurmRunFn;
  } = {}
): AnalyzerContext {
  return {
    jobId: pending.id,
    slurmContext: {
      parser: PARSER,
      run:
        opts.run ??
        jest.fn(async (_exe: string, args: readonly string[]) => {
          // Models a cleanly absent live job for any unit-test lookup.
          const id = String(args[args.length - 1] ?? '');
          throw new CommandError({
            kind: 'non-zero-exit',
            executable: 'scontrol',
            args: [...args],
            exitCode: 1,
            stderrSnippet: `scontrol: Invalid job id specified: ${id}`,
            message: 'exit 1',
          });
        }),
    },
    targeted: {
      job: pending,
      schedNodeList: null,
      reqNodeList: null,
      arrayThrottle: null,
      memory: opts.memory ?? { kind: 'unknown', memoryMiB: null },
      minMemoryMiB: null,
      requestedNodes: pending.requested.nodes,
      capturedAt: new Date(),
    },
    job: pending,
    jobsSnapshot: createJobSnapshot([pending, ...(opts.jobs ?? [])]),
    nodesSnapshot: createNodeSnapshot(opts.nodes ?? [makeNode({ name: 'node01' })]),
    assoc:
      opts.assocEntries === undefined
        ? null
        : { store: buildAssociationStore(opts.assocEntries), capturedAt: new Date() },
    qos: null,
    sprioWeights: null,
    partitionDetail: null,
    partitionQosName: null,
    partitionTable: opts.partitionTable ?? null,
  };
}

function assocEntry(partial: Partial<AssociationEntry> & { account: string }): AssociationEntry {
  return {
    id: null,
    parentId: null,
    user: null,
    partition: null,
    parentAccount: null,
    cluster: null,
    grpTres: { cpu: null, memMiB: null, node: null, gres: {} },
    grpTresRunMins: { cpu: null, memMiB: null, node: null, gres: {} },
    grpJobs: null,
    maxJobs: null,
    ...partial,
  };
}

describe('Resources request semantics', () => {
  test('single-node CPU request compares against effectiveCpus, not cpus', async () => {
    const pending = makeJob({
      id: '1', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: 12, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
    });
    const ctx = makeCtx(pending, { nodes: [makeNode({ name: 'node01', cpus: 16, effectiveCpus: 8 })] });
    const result = await analyzeResources(ctx);
    expect(result?.insufficientNodes).toBe(1);
    expect(result?.nodes[0]?.shortages).toEqual([
      { resource: 'cpus', requested: 12, currentlyUnallocated: 8 },
    ]);
  });

  test('multi-node aggregate CPU is excluded, never evenly split', async () => {
    const pending = makeJob({
      id: '2', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: 64, memoryMiB: null, nodes: 4, gpus: { total: 0, byType: {} } },
    });
    const ctx = makeCtx(pending);
    await expect(analyzeResources(ctx)).resolves.toBeNull();
  });

  test('multi-node --mem still evaluates per-node memory', async () => {
    const pending = makeJob({
      id: '3', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: 64, memoryMiB: null, nodes: 4, gpus: { total: 0, byType: {} } },
    });
    const ctx = makeCtx(pending, {
      memory: { kind: 'perNode', memoryMiB: 100000 },
      nodes: [makeNode({ name: 'node01' })],
    });
    const result = await analyzeResources(ctx);
    expect(result?.insufficientNodes).toBe(1);
    expect(result?.nodes[0]?.shortages).toEqual([
      { resource: 'memoryMiB', requested: 100000, currentlyUnallocated: 16384 },
    ]);
  });

  test('aggregate GPU without per-node placement is excluded', async () => {
    const pending = makeJob({
      id: '4', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: null, memoryMiB: null, nodes: 2, gpus: { total: 4, byType: { unknown: 4 } } },
    });
    await expect(analyzeResources(makeCtx(pending))).resolves.toBeNull();
  });

  test('typed single-node GPU request evaluates per type', async () => {
    const pending = makeJob({
      id: '5', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: null, memoryMiB: null, nodes: 1, gpus: { total: 2, byType: { a100: 2 } } },
    });
    const ctx = makeCtx(pending, {
      nodes: [makeNode({
        name: 'node01',
        gresRaw: 'gpu:a100:4',
        gresUsedRaw: 'gpu:a100:3',
        gpu: { total: 4, allocated: 3, byType: { a100: { total: 4, allocated: 3 } } },
      })],
    });
    const result = await analyzeResources(ctx);
    expect(result?.nodes[0]?.shortages).toEqual([
      { resource: 'gpus', gpuType: 'a100', requested: 2, currentlyUnallocated: 1 },
    ]);
  });

  test('perCpu single-node converts via total CPUs', async () => {
    const pending = makeJob({
      id: '6', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: 4, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
    });
    const ctx = makeCtx(pending, { memory: { kind: 'perCpu', memoryMiB: 5000 } });
    const result = await analyzeResources(ctx);
    expect(result?.nodes[0]?.shortages).toEqual([
      { resource: 'memoryMiB', requested: 20000, currentlyUnallocated: 16384 },
    ]);
  });

  test('perGpu single-node converts via total GPUs', async () => {
    const pending = makeJob({
      id: '6b', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: null, memoryMiB: null, nodes: 1, gpus: { total: 2, byType: {} } },
    });
    const ctx = makeCtx(pending, {
      memory: { kind: 'perGpu', memoryMiB: 9000 },
      nodes: [makeNode({ name: 'node01', gpu: { total: 4, allocated: 0, byType: {} } })],
    });
    const result = await analyzeResources(ctx);
    expect(result?.nodes[0]?.shortages).toEqual([
      { resource: 'memoryMiB', requested: 18000, currentlyUnallocated: 16384 },
    ]);
  });

  test('perCpu multi-node is excluded', async () => {
    const pending = makeJob({
      id: '7', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: 8, memoryMiB: null, nodes: 2, gpus: { total: 0, byType: {} } },
    });
    const ctx = makeCtx(pending, { memory: { kind: 'perCpu', memoryMiB: 1000 } });
    await expect(analyzeResources(ctx)).resolves.toBeNull();
  });

  test('targeted adapter preserves memory mode incl. per-gpu, normalizes num_nodes wrappers', () => {
    const stdout = JSON.stringify({
      errors: [],
      jobs: [{
        job_id: 11,
        job_state: ['PENDING'],
        tres_req_str: 'cpu=4,mem=8000M,node=2',
        min_memory_per_gpu: '2000M',
        num_nodes: { number: '2', set: true },
      }],
    });
    const targeted = parseTargetedJobStdout(PARSER, stdout, '11');
    expect(targeted?.memory).toEqual({ kind: 'perGpu', memoryMiB: 2000 });
    expect(targeted?.requestedNodes).toBe(2);
    const str = parseTargetedJobStdout(
      PARSER,
      JSON.stringify({ errors: [], jobs: [{ job_id: 12, job_state: ['PENDING'], num_nodes: '3' }] }),
      '12'
    );
    expect(str?.requestedNodes).toBe(3);
  });
});

describe('partition-QOS usage cohorts', () => {
  const table = [
    { name: 'debug', state: 'UP', maxTimeSeconds: null, maxNodes: null, totalNodes: 4, qos: 'shared' },
    { name: 'gpu', state: 'UP', maxTimeSeconds: null, maxNodes: null, totalNodes: 2, qos: 'shared' },
    { name: 'other', state: 'UP', maxTimeSeconds: null, maxNodes: null, totalNodes: 2, qos: null },
  ] as AnalyzerContext['partitionTable'];

  function qosCtx(pending: Job, jobs: Job[]): AnalyzerContext {
    const ctx = makeCtx(pending, { jobs, partitionTable: table });
    return {
      ...ctx,
      qos: {
        store: buildQosStore([
          { ...emptyQosEntry('shared'), grpTres: { cpu: 100, memMiB: null, node: null, gres: {} } },
          { ...emptyQosEntry('normal') },
        ]),
        capturedAt: new Date(),
      },
    };
  }

  test('partition-QOS usage spans member partitions, ignores job.qos equality', async () => {
    const pending = makeJob({
      id: '20', state: 'PENDING', stateReason: 'QOSGrpCpuLimit', partition: 'debug', qos: 'normal',
      requested: { cpus: 1, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
    });
    const jobs = [
      makeJob({ id: '21', partition: 'debug', qos: 'normal' }),
      makeJob({ id: '22', partition: 'gpu', qos: 'unrelated' }),
      makeJob({ id: '23', partition: 'other', qos: 'shared' }),
    ];
    const result = await analyzeQosLimits(qosCtx(pending, jobs));
    expect(result?.used).toBe(8);
    expect(result?.qos).toBe('shared');
  });

  test('partition QOS job running under a different job QOS still counts (no zero-usage lie)', async () => {
    const pending = makeJob({
      id: '24', state: 'PENDING', stateReason: 'QOSGrpCpuLimit', partition: 'debug', qos: 'normal',
      requested: { cpus: 1, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
    });
    const jobs = [makeJob({ id: '25', partition: 'debug', qos: 'normal' })];
    const result = await analyzeQosLimits(qosCtx(pending, jobs));
    expect(result).not.toBeNull();
    expect(result?.used).toBe(4);
  });

  test('missing partition table declines partition-QOS numerics', async () => {
    const pending = makeJob({
      id: '26', state: 'PENDING', stateReason: 'QOSGrpCpuLimit', partition: 'debug', qos: 'normal',
      requested: { cpus: 1, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
    });
    // Leave job QOS without the metric so partition QOS is selected.
    const ctx = makeCtx(pending, { jobs: [makeJob({ id: '27', partition: 'debug', qos: 'normal' })] });
    const withQos: AnalyzerContext = {
      ...ctx,
      partitionDetail: { name: 'debug', state: 'UP', maxTimeSeconds: null, maxNodes: null, totalNodes: 4, qos: 'shared' },
      qos: {
        store: buildQosStore([
          { ...emptyQosEntry('shared'), grpTres: { cpu: 100, memMiB: null, node: null, gres: {} } },
          { ...emptyQosEntry('normal') },
        ]),
        capturedAt: new Date(),
      },
    };
    await expect(analyzeQosLimits(withQos)).resolves.toBeNull();
  });
});

describe('QOS per-user source resolution', () => {
  function perUserCtx(opts: { jobQos: string | null; partitionQos: string | null; overPart?: boolean }): AnalyzerContext {
    const pending = makeJob({
      id: '30', state: 'PENDING', stateReason: 'QOSMaxJobsPerUserLimit',
      qos: opts.jobQos, user: 'alice',
    });
    const jobEntry = opts.jobQos === null ? null : {
      ...emptyQosEntry(opts.jobQos),
      flags: new Set(opts.overPart === true ? ['OverPartQOS'] : []),
      maxJobsPerUser: opts.jobQos === 'jobq' ? 5 : null,
    };
    const partEntry = opts.partitionQos === null ? null : {
      ...emptyQosEntry(opts.partitionQos),
      maxJobsPerUser: 2,
    };
    const entries = [jobEntry, partEntry].filter((e) => e !== null);
    return {
      ...makeCtx(pending),
      partitionDetail:
        opts.partitionQos === null
          ? null
          : { name: 'debug', state: 'UP', maxTimeSeconds: null, maxNodes: null, totalNodes: 4, qos: opts.partitionQos },
      qos: { store: buildQosStore(entries), capturedAt: new Date() },
    };
  }

  test('job QOS used when partition QOS lacks the metric', async () => {
    const pending = makeJob({
      id: '30', state: 'PENDING', stateReason: 'QOSMaxJobsPerUserLimit',
      qos: 'jobq', user: 'alice',
    });
    const ctx: AnalyzerContext = {
      ...makeCtx(pending),
      partitionDetail: { name: 'debug', state: 'UP', maxTimeSeconds: null, maxNodes: null, totalNodes: 4, qos: 'partq' },
      qos: {
        store: buildQosStore([
          { ...emptyQosEntry('jobq'), maxJobsPerUser: 5 },
          { ...emptyQosEntry('partq') },
        ]),
        capturedAt: new Date(),
      },
    };
    const result = await analyzeQosLimits(ctx);
    expect(result?.qos).toBe('jobq');
    expect(result?.limit).toBe(5);
  });

  test('OverPartQOS reversal prefers the job QOS even when partition defines first', async () => {
    const result = await analyzeQosLimits(
      perUserCtx({ jobQos: 'jobq', partitionQos: 'partq', overPart: true })
    );
    expect(result?.qos).toBe('jobq');
  });

  test('partition-sourced per-user limit declines numerics', async () => {
    await expect(analyzeQosLimits(perUserCtx({ jobQos: 'jobq', partitionQos: 'partq' }))).resolves.toBeNull();
    const pending = makeJob({
      id: '31', state: 'PENDING', stateReason: 'QOSMaxJobsPerUserLimit', qos: 'bare', user: 'alice',
    });
    const ctx: AnalyzerContext = {
      ...makeCtx(pending),
      partitionDetail: { name: 'debug', state: 'UP', maxTimeSeconds: null, maxNodes: null, totalNodes: 4, qos: 'partq' },
      qos: {
        store: buildQosStore([
          { ...emptyQosEntry('bare') },
          { ...emptyQosEntry('partq'), maxJobsPerUser: 2 },
        ]),
        capturedAt: new Date(),
      },
    };
    await expect(analyzeQosLimits(ctx)).resolves.toBeNull();
  });
});

describe('association scoping by entry', () => {
  const baseEntries = [
    assocEntry({ id: '1', parentId: null, account: 'root' }),
    assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root', grpTres: { cpu: 100, memMiB: null, node: null, gres: {} } }),
    assocEntry({ id: '4', parentId: '2', account: 'research', user: 'alice' }),
    assocEntry({ id: '5', parentId: '3', account: 'child', user: 'alice' }),
    assocEntry({ id: '3', parentId: '2', account: 'child', parentAccount: 'research' }),
  ];

  test('partition-specific association ignores other partitions', async () => {
    const entries = [
      assocEntry({ id: '1', parentId: null, account: 'root' }),
      assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root', partition: 'debug', grpTres: { cpu: 10, memMiB: null, node: null, gres: {} } }),
      assocEntry({ id: '9', parentId: '2', account: 'research', user: 'alice', partition: 'debug' }),
      assocEntry({ id: '10', parentId: '1', account: 'research', user: 'alice', partition: 'other' }),
    ];
    const pending = makeJob({
      id: '40', state: 'PENDING', stateReason: 'AssocGrpCpuLimit', account: 'research', partition: 'debug',
      requested: { cpus: 9, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
    });
    const jobs = [
      makeJob({ id: '41', account: 'research', partition: 'other' }), // must not count
      makeJob({ id: '42', account: 'research', partition: 'debug' }), // counts: 4
    ];
    const result = await analyzeAssocLimits({ ...makeCtx(pending, { jobs }), assoc: { store: buildAssociationStore(entries), capturedAt: new Date() } });
    expect(result?.used).toBe(4);
  });

  test('user association never aggregates other users', async () => {
    const entries = [
      assocEntry({ id: '1', parentId: null, account: 'root' }),
      assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root' }),
      assocEntry({ id: '3', parentId: '2', account: 'research', user: 'bob', maxJobs: 1 }),
    ];
    const pending = makeJob({
      id: '43', state: 'PENDING', stateReason: 'AssocMaxJobsLimit', account: 'research', user: 'bob',
    });
    const jobs = [
      makeJob({ id: '44', account: 'research', user: 'alice' }),
      makeJob({ id: '45', account: 'research', user: 'bob' }),
    ];
    const result = await analyzeAssocLimits({ ...makeCtx(pending, { jobs }), assoc: { store: buildAssociationStore(entries), capturedAt: new Date() } });
    expect(result?.limitingAccount).toBe('research');
    expect(result?.used).toBe(1);
  });

  test('inherited account MaxJobs counts only the pending user, never siblings', async () => {
    const entries = [
      assocEntry({ id: '1', parentId: null, account: 'root' }),
      assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root', maxJobs: 1 }),
      assocEntry({ id: '9', parentId: '2', account: 'research', user: 'alice' }),
    ];
    const pending = makeJob({
      id: '46', state: 'PENDING', stateReason: 'AssocMaxJobsLimit', account: 'research', user: 'alice',
    });
    const jobs = [makeJob({ id: '47', account: 'research', user: 'bob' })];
    const result = await analyzeAssocLimits({ ...makeCtx(pending, { jobs }), assoc: { store: buildAssociationStore(entries), capturedAt: new Date() } });
    expect(result?.used).toBe(0);
    expect(result?.limit).toBe(1);
  });

  test('first-defined MaxJobs wins up the chain', async () => {
    const entries = [
      assocEntry({ id: '1', parentId: null, account: 'root', maxJobs: 10 }),
      assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root', maxJobs: 3 }),
      assocEntry({ id: '3', parentId: '2', account: 'research', user: 'alice' }),
    ];
    const pending = makeJob({
      id: '46b', state: 'PENDING', stateReason: 'AssocMaxJobsLimit', account: 'research', user: 'alice',
    });
    const withUserLimit = await analyzeAssocLimits({
      ...makeCtx(pending, { jobs: [makeJob({ id: '48', account: 'research', user: 'bob' })] }),
      assoc: {
        store: buildAssociationStore(
          entries.map((entry) => (entry.id === '3' ? { ...entry, maxJobs: 2 } : entry))
        ),
        capturedAt: new Date(),
      },
    });
    expect(withUserLimit?.limit).toBe(2);
    expect(withUserLimit?.used).toBe(0);
    const inherited = await analyzeAssocLimits({
      ...makeCtx(pending, {}),
      assoc: { store: buildAssociationStore(entries), capturedAt: new Date() },
    });
    expect(inherited?.limitingAccount).toBe('research');
    expect(inherited?.limit).toBe(3);
  });

  test('descendant accounts roll up, unrelated accounts excluded', async () => {
    const entries = [...baseEntries];
    const pending = makeJob({
      id: '48', state: 'PENDING', stateReason: 'AssocGrpCpuLimit', account: 'research',
      requested: { cpus: 1, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
    });
    const jobs = [
      makeJob({ id: '49', account: 'child' }),
      makeJob({ id: '50', account: 'unrelated' }),
    ];
    const result = await analyzeAssocLimits({ ...makeCtx(pending, { jobs }), assoc: { store: buildAssociationStore(entries), capturedAt: new Date() } });
    expect(result?.used).toBe(4);
  });
});

describe('run-minute conservatism', () => {
  function runMinutesCtx(qosFlags: string[] = [], jobs?: Job[]): AnalyzerContext {
    const pending = makeJob({
      id: '60', state: 'PENDING', stateReason: 'AssocGrpCPURunMinutesLimit', account: 'research', qos: 'normal',
      requested: { cpus: 4, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
      timeLimit: { kind: 'finite', seconds: 3600 },
    });
    const base = makeCtx(pending, {
      jobs: jobs ?? [makeJob({ id: '61', account: 'research', qos: 'normal' })],
      assocEntries: [
        assocEntry({ id: '1', parentId: null, account: 'root' }),
        assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root', grpTresRunMins: { cpu: 100000, memMiB: null, node: null, gres: {} } }),
        assocEntry({ id: '9', parentId: '2', account: 'research', user: 'alice' }),
      ],
    });
    return {
      ...base,
      qos: {
        store: buildQosStore([{ ...emptyQosEntry('normal'), flags: new Set(qosFlags) }]),
        capturedAt: new Date(),
      },
    };
  }

  function bigCpuJob(id: string): Job {
    return makeJob({
      id, account: 'research', qos: 'normal',
      startTime: new Date(Date.now() - 60_000),
      allocated: { cpus: 2000, memoryMiB: null, nodes: null, gpus: { total: 0, byType: {} }, gpuPresent: true },
    });
  }

  test('independently exceeded run-minute level reports with requested null', async () => {
    const result = await analyzeAssocLimits(runMinutesCtx([], [bigCpuJob('61')]));
    expect(result?.kind).toBe('limit');
    expect(result?.limit).toBe(100000);
    expect(result?.requested).toBeNull();
    expect(result?.used).not.toBeNull();
    expect(result?.limitingAccount).toBe('research');
  });

  test('run-minute levels below the limit establish no limiter', async () => {
    const result = await analyzeAssocLimits(runMinutesCtx([], [
      makeJob({ id: '62', account: 'research', qos: 'normal', startTime: new Date(Date.now() - 60_000) }),
    ]));
    expect(result).toBeNull();
  });

  test('Safe-adjacent QOS flags do not change used math or fabricate requested', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-01T12:00:00Z'));
    try {
      const plain = await analyzeAssocLimits(runMinutesCtx([], [bigCpuJob('63')]));
      const safe = await analyzeAssocLimits(runMinutesCtx(['Safe'], [bigCpuJob('64')]));
      expect(safe?.used).toBe(plain?.used);
      expect(safe?.requested).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('node-count limits decline numerics', () => {
  test('QOSGrpNodeLimit returns null', async () => {
    const pending = makeJob({ id: '70', state: 'PENDING', stateReason: 'QOSGrpNodeLimit', qos: 'normal' });
    const ctx: AnalyzerContext = {
      ...makeCtx(pending),
      qos: { store: buildQosStore([{ ...emptyQosEntry('normal'), grpTres: { cpu: null, memMiB: null, node: 10, gres: {} } }]), capturedAt: new Date() },
    };
    await expect(analyzeQosLimits(ctx)).resolves.toBeNull();
  });

  test('QOSMaxNodePerUserLimit returns null', async () => {
    const pending = makeJob({ id: '71', state: 'PENDING', stateReason: 'QOSMaxNodePerUserLimit', qos: 'normal', user: 'alice' });
    const ctx: AnalyzerContext = {
      ...makeCtx(pending),
      qos: {
        store: buildQosStore([{ ...emptyQosEntry('normal'), maxTresPerUser: { cpu: null, memMiB: null, node: 4, gres: {} } }]),
        capturedAt: new Date(),
      },
    };
    await expect(analyzeQosLimits(ctx)).resolves.toBeNull();
  });
});

describe('dependency truncation, wildcards, singleton', () => {
  function depCtx(pending: Job, jobs: Job[], run?: SlurmRunFn): AnalyzerContext {
    return {
      ...makeCtx(pending, { jobs, run }),
      targeted: {
        job: pending,
        schedNodeList: null,
        reqNodeList: null,
        arrayThrottle: null,
        memory: { kind: 'unknown', memoryMiB: null },
        minMemoryMiB: null,
        requestedNodes: 1,
        capturedAt: new Date(),
      },
    };
  }

  test('AND with an unsatisfied item past the detail cap stays unsatisfied', async () => {
    const ids = Array.from({ length: 55 }, (_, i) => 100 + i);
    const pending = makeJob({
      id: '80', state: 'PENDING', stateReason: 'Dependency',
      dependency: `afterok:${ids.join(':')}`,
    });
    const jobs = ids.slice(0, 54).map((id) => makeJob({ id: String(id), state: 'COMPLETED', exitCode: '0' }));
    jobs.push(makeJob({ id: String(ids[54]), state: 'RUNNING' }));
    const result = await analyzeDependency(depCtx(pending, jobs));
    expect(result?.status).toBe('unsatisfied');
    expect(result?.dependencies[0]?.jobs.length).toBeLessThanOrEqual(50);
  });

  test('OR across the cap still satisfies on a late satisfied item', async () => {
    const ids = Array.from({ length: 55 }, (_, i) => 200 + i);
    const pending = makeJob({
      id: '81', state: 'PENDING', stateReason: 'Dependency',
      dependency: ids.map((id) => `afterok:${id}`).join('?'),
    });
    const result = await analyzeDependency(depCtx(pending, [
      ...ids.slice(0, 54).map((id) => makeJob({ id: String(id), state: 'RUNNING' })),
      makeJob({ id: String(ids[54]), state: 'COMPLETED', exitCode: '0' }),
    ]));
    expect(result?.status).toBe('satisfied');
  });

  test('wildcard array dependency is unknown, not satisfied', async () => {
    const pending = makeJob({
      id: '82', state: 'PENDING', stateReason: 'Dependency', dependency: 'afterok:300_*',
    });
    const result = await analyzeDependency(depCtx(pending, [
      makeJob({ id: '300', state: 'COMPLETED', exitCode: '0' }),
    ]));
    expect(result?.dependencies[0]?.jobs[0]).toMatchObject({ status: 'unknown', arrayWildcard: true });
    expect(result?.status).toBe('unknown');
  });

  test('singleton ignores later same-name jobs, blocks on earlier ones', async () => {
    const base = {
      state: 'PENDING' as const, stateReason: 'Dependency' as const, user: 'alice', name: 'pipe',
      submitTime: new Date('2026-01-01T02:00:00Z'), jobId: '90',
    };
    const laterOnly = makeJob({
      ...base, id: '90', state: 'RUNNING',
      submitTime: new Date('2026-01-01T02:00:00Z'),
    });
    const later = makeJob({
      ...base, id: '91', state: 'RUNNING', submitTime: new Date('2026-01-01T03:00:00Z'),
    });
    expect((await analyzeDependency(depCtx({ ...laterOnly, dependency: 'singleton' }, [later])))?.status).toBe('satisfied');
    const earlier = makeJob({
      ...base, id: '89', state: 'RUNNING', submitTime: new Date('2026-01-01T01:00:00Z'),
    });
    expect((await analyzeDependency(depCtx({ ...laterOnly, dependency: 'singleton' }, [earlier, later])))?.status).toBe('unsatisfied');
  });

  test('singleton with pending earlier predecessor blocks', async () => {
    const target = makeJob({
      id: '93', state: 'PENDING', stateReason: 'Dependency', user: 'alice', name: 'pipe',
      submitTime: new Date('2026-01-01T02:00:00Z'), dependency: 'singleton',
    });
    const predecessor = makeJob({
      id: '92', state: 'PENDING', user: 'alice', name: 'pipe',
      submitTime: new Date('2026-01-01T01:00:00Z'),
    });
    expect((await analyzeDependency(depCtx(target, [predecessor])))?.status).toBe('unsatisfied');
  });

  test('singleton without ordering evidence is unknown', async () => {
    const target = makeJob({
      id: '95', state: 'PENDING', stateReason: 'Dependency', user: 'alice', name: 'pipe',
      submitTime: null, jobId: 'abc', dependency: 'singleton',
    });
    const other = makeJob({
      id: '96', state: 'RUNNING', user: 'alice', name: 'pipe', submitTime: null, jobId: 'abd',
    });
    expect((await analyzeDependency(depCtx(target, [other])))?.status).toBe('unknown');
  });
});

describe('required-nodes cap', () => {
  test('expression beyond the cap declines rich analysis', async () => {
    const names = Array.from({ length: 101 }, (_, i) => `node${String(i).padStart(3, '0')}`).join(',');
    const pending = makeJob({ id: '100', state: 'PENDING', stateReason: 'ReqNodeNotAvail' });
    const ctx: AnalyzerContext = {
      ...makeCtx(pending),
      targeted: {
        job: pending,
        schedNodeList: null,
        reqNodeList: names,
        arrayThrottle: null,
        memory: { kind: 'unknown', memoryMiB: null },
        minMemoryMiB: null,
        requestedNodes: null,
        capturedAt: new Date(),
      },
    };
    await expect(analyzeRequiredNodes(ctx)).resolves.toBeNull();
  });
});

describe('reservation adapter fallback discipline', () => {
  const ctx = { parser: PARSER } as { parser: typeof PARSER; run: SlurmRunFn };

  test('abort does not retry as text', async () => {
    const aborted = new CommandError({
      kind: 'aborted', executable: 'scontrol', args: [], stderrSnippet: null, message: 'Command aborted: scontrol',
    });
    const run: SlurmRunFn = jest.fn().mockRejectedValue(aborted);
    await expect(fetchReservationDetail({ ...ctx, run }, 'resv1')).rejects.toBe(aborted);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('timeout propagates without text retry', async () => {
    const timedOut = new CommandError({
      kind: 'timeout', executable: 'scontrol', args: [], stderrSnippet: null, message: 'timed out',
    });
    const run: SlurmRunFn = jest.fn().mockRejectedValue(timedOut);
    await expect(fetchReservationDetail({ ...ctx, run }, 'resv1')).rejects.toBe(timedOut);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('unsupported JSON mode falls back to text once', async () => {
    const unsupported = new CommandError({
      kind: 'non-zero-exit', executable: 'scontrol', args: [],
      exitCode: 1, stderrSnippet: 'scontrol: invalid option --json', message: 'bad option',
    });
    const run: SlurmRunFn = jest.fn()
      .mockRejectedValueOnce(unsupported)
      .mockResolvedValueOnce({ stdout: 'ReservationName=resv1 State=ACTIVE StartTime=2026-05-01T10:00:00 EndTime=2026-05-01T12:00:00', stderr: '' });
    const detail = await fetchReservationDetail({ ...ctx, run }, 'resv1');
    expect(detail?.state).toBe('ACTIVE');
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('unparseable JSON payload surfaces an upstream error, not text', async () => {
    const run: SlurmRunFn = jest.fn()
      .mockResolvedValueOnce({ stdout: JSON.stringify({ bogus: true }), stderr: '' });
    await expect(fetchReservationDetail({ ...ctx, run }, 'resv1')).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('mismatched reservation name surfaces an upstream error', async () => {
    const run: SlurmRunFn = jest.fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ reservations: [{ name: 'other', state: 'ACTIVE' }] }),
        stderr: '',
      });
    await expect(fetchReservationDetail({ ...ctx, run }, 'resv1')).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('service refresh, cooldown, and missing-job mapping', () => {
  beforeEach(() => {
    clearContradictionCooldownForTests();
  });

  interface Fake {
    targeted: Record<string, unknown>;
    squeueTexts: string[];
    assocTexts: string[];
    qosTexts: string[];
    partitionTable?: string;
    calls: { squeue: number; assoc: number; qos: number; partition: number };
    targetedError?: unknown;
  }

  function squeueJob(partial: Record<string, unknown>): Record<string, unknown> {
    return {
      job_id: 1, partition: 'debug', name: 'job', user_name: 'alice', account: 'research',
      qos: 'normal', job_state: ['RUNNING'], tres_req_str: 'cpu=4,mem=100M,node=1', tres_alloc_str: 'cpu=4,mem=100M,node=1',
      ...partial,
    };
  }

  function serviceFor(fake: Fake): { service: PendingAnalysisService; fake: Fake } {
    const run: SlurmRunFn = jest.fn(async (executable: string, args: readonly string[]) => {
      const argv = args.join(' ');
      if (executable === 'squeue') {
        const text = fake.squeueTexts[Math.min(fake.calls.squeue, fake.squeueTexts.length - 1)] ?? fake.squeueTexts[0] ?? '';
        fake.calls.squeue += 1;
        return { stdout: text, stderr: '' };
      }
      if (executable === 'scontrol' && argv.includes('show job')) {
        if (fake.targetedError !== undefined) {
          throw fake.targetedError;
        }
        return { stdout: JSON.stringify({ errors: [], jobs: [fake.targeted] }), stderr: '' };
      }
      if (executable === 'scontrol' && argv.includes('show config')) {
        return { stdout: 'ClusterName=nova\n', stderr: '' };
      }
      if (executable === 'scontrol' && argv.includes('show config')) {
        return { stdout: 'ClusterName=nova\n', stderr: '' };
      }
      if (executable === 'scontrol' && argv.includes('show partition')) {
        fake.calls.partition += 1;
        return { stdout: fake.partitionTable ?? JSON.stringify({ errors: [], partitions: [] }), stderr: '' };
      }
      if (executable === 'sacctmgr' && argv.includes('assoc')) {
        const text = fake.assocTexts[Math.min(fake.calls.assoc, fake.assocTexts.length - 1)] ?? '';
        fake.calls.assoc += 1;
        return { stdout: text, stderr: '' };
      }
      if (executable === 'sacctmgr') {
        const text = fake.qosTexts[0] ?? '';
        fake.calls.qos += 1;
        return { stdout: text, stderr: '' };
      }
      if (executable === 'sprio') {
        return { stdout: 'JOBID PRIORITY\n1 1', stderr: '' };
      }
      throw new Error(`unexpected ${executable} ${argv}`);
    });
    const slurmContext = { parser: PARSER, run };
    const service = new PendingAnalysisService({
      slurmContext,
      jobsCache: new JobsCache(slurmContext),
      assocCache: new AssocCache(slurmContext),
      qosCache: new QosCache(slurmContext),
      sprioWeightsCache: new SprioWeightsCache(slurmContext),
    });
    return { service, fake };
  }

  const assocHeader = 'ID|ParentID|Cluster|Account|User|Partition|ParentName|GrpTRES|GrpTRESRunMins|GrpJobs|MaxJobs';
  const qosRow = 'Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags\nnormal|0||||||||||1|';

  function pendingCpuJob(id: number, reason: string): Record<string, unknown> {
    return squeueJob({ job_id: id, job_state: ['PENDING'], state_reason: reason, tres_req_str: 'cpu=1,mem=100M,node=1' });
  }

  test('stale JobsCache corrected by refresh', async () => {
    const fake: Fake = {
      targeted: pendingCpuJob(52, 'AssocGrpCpuLimit'),
      squeueTexts: [
        JSON.stringify({ errors: [], jobs: [] }),
        JSON.stringify({
          errors: [],
          jobs: [squeueJob({ job_id: 90, job_state: ['RUNNING'], tres_req_str: 'cpu=10,mem=100M,node=1', tres_alloc_str: 'cpu=10,mem=100M,node=1' })],
        }),
      ],
      assocTexts: [`${assocHeader}\n1||c|research|||root|cpu=10||||\n2|1|c|research|alice||research|||||`],
      qosTexts: [qosRow],
      calls: { squeue: 0, assoc: 0, qos: 0, partition: 0 },
    };
    const { service } = serviceFor(fake);
    const result = await service.analyze('52', { nowMs: 1_000_000 });
    expect(result.analysis?.kind).toBe('limit');
    if (result.analysis?.kind === 'limit') {
      expect(result.analysis.used).toBe(10);
    }
    expect(fake.calls.squeue).toBeGreaterThanOrEqual(2);
  });

  test('stale association policy corrected by refresh', async () => {
    const fake: Fake = {
      targeted: pendingCpuJob(53, 'AssocGrpCpuLimit'),
      squeueTexts: [JSON.stringify({ errors: [], jobs: [] })],
      assocTexts: [
        `${assocHeader}\n1||c|research|||root|cpu=100||||\n2|1|c|research|alice||research|||||`,
        `${assocHeader}\n1||c|research|||root|cpu=1||||\n2|1|c|research|alice||research|||||`,
      ],
      qosTexts: [qosRow],
      calls: { squeue: 0, assoc: 0, qos: 0, partition: 0 },
    };
    const { service } = serviceFor(fake);
    const result = await service.analyze('53', { nowMs: 2_000_000 });
    if (result.analysis?.kind === 'limit') {
      expect(result.analysis.limit).toBe(1);
    } else {
      throw new Error('expected limit analysis');
    }
    expect(fake.calls.assoc).toBeGreaterThanOrEqual(2);
  });

  test('stale QOS policy corrected by refresh', async () => {
    const qosLoose = 'Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags\nshared|0|||||cpu=100|||||1|';
    const qosTight = 'Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags\nshared|0|||||cpu=1|||||1|';
    let qosCalls = 0;
    const base: Fake = {
      targeted: { ...pendingCpuJob(54, 'QOSGrpCpuLimit'), account: 'research', qos: 'shared' },
      squeueTexts: [JSON.stringify({ errors: [], jobs: [] })],
      assocTexts: [],
      qosTexts: [qosLoose],
      calls: { squeue: 0, assoc: 0, qos: 0, partition: 0 },
    };
    const run: SlurmRunFn = jest.fn(async (executable: string, args: readonly string[]) => {
      const argv = args.join(' ');
      if (executable === 'squeue') {
        return { stdout: base.squeueTexts[0] ?? '', stderr: '' };
      }
      if (executable === 'scontrol' && argv.includes('show job')) {
        return { stdout: JSON.stringify({ errors: [], jobs: [base.targeted] }), stderr: '' };
      }
      if (executable === 'scontrol' && argv.includes('show config')) {
        return { stdout: 'ClusterName=nova\n', stderr: '' };
      }
      if (executable === 'scontrol' && argv.includes('show config')) {
        return { stdout: 'ClusterName=nova\n', stderr: '' };
      }
      if (executable === 'scontrol' && argv.includes('show partition')) {
        return { stdout: JSON.stringify({ errors: [], partitions: [] }), stderr: '' };
      }
      if (executable === 'sacctmgr') {
        qosCalls += 1;
        return { stdout: qosCalls <= 1 ? qosLoose : qosTight, stderr: '' };
      }
      throw new Error(`unexpected ${executable} ${argv}`);
    });
    const slurmContext = { parser: PARSER, run };
    const service = new PendingAnalysisService({
      slurmContext,
      jobsCache: new JobsCache(slurmContext),
      qosCache: new QosCache(slurmContext),
    });
    const result = await service.analyze('54', { nowMs: 3_000_000 });
    if (result.analysis?.kind === 'limit') {
      expect(result.analysis.limit).toBe(1);
    } else {
      throw new Error('expected limit analysis');
    }
    expect(qosCalls).toBeGreaterThanOrEqual(2);
  });

  test('cooldown suppresses repeat refresh; later window refreshes again', async () => {
    const fake: Fake = {
      targeted: pendingCpuJob(55, 'AssocGrpCpuLimit'),
      squeueTexts: [JSON.stringify({ errors: [], jobs: [] })],
      assocTexts: [`${assocHeader}\n1||c|research|||root|cpu=100||||\n2|1|c|research|alice||research|||||`],
      qosTexts: [qosRow],
      calls: { squeue: 0, assoc: 0, qos: 0, partition: 0 },
    };
    const { service } = serviceFor(fake);
    const first = await service.analyze('55', { nowMs: 4_000_000 });
    expect(first.updatedAt instanceof Date).toBe(true);
    const assocAfterFirst = fake.calls.assoc;
    expect(assocAfterFirst).toBeGreaterThanOrEqual(2);
    const suppressed = await service.analyze('55', { nowMs: 4_010_000 });
    expect(suppressed.updatedAt instanceof Date).toBe(true);
    expect(Number.isNaN(suppressed.updatedAt.getTime())).toBe(false);
    expect(fake.calls.assoc).toBe(assocAfterFirst);
    await service.analyze('55', { nowMs: 4_000_000 + 60_000 });
    expect(fake.calls.assoc).toBeGreaterThanOrEqual(assocAfterFirst + 1);
  });

  test('missing job via errors[] becomes 404; unrelated errors stay 503', async () => {
    const base: Fake = {
      targeted: pendingCpuJob(56, 'Resources'),
      squeueTexts: [JSON.stringify({ errors: [], jobs: [] })],
      assocTexts: [],
      qosTexts: [],
      calls: { squeue: 0, assoc: 0, qos: 0, partition: 0 },
    };
    const missing = serviceFor({
      ...base,
      targetedError: new SlurmUpstreamError(['Invalid job id specified: 56']),
    } as Fake);
    await expect(missing.service.analyze('56')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const broken = serviceFor({
      ...base,
      targetedError: new SlurmUpstreamError(['slurmdbd: Access denied']),
    } as Fake);
    await expect(broken.service.analyze('56')).rejects.not.toMatchObject({ code: 'NOT_FOUND' });
    const exitNamed = serviceFor({
      ...base,
      targetedError: new CommandError({ kind: 'non-zero-exit', executable: 'scontrol', args: [], exitCode: 1, stderrSnippet: 'scontrol: invalid job id specified: 56', message: 'exit 1' }),
    } as Fake);
    await expect(exitNamed.service.analyze('56')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const exitOther = serviceFor({
      ...base,
      targetedError: new CommandError({ kind: 'non-zero-exit', executable: 'scontrol', args: [], exitCode: 1, stderrSnippet: 'scontrol: socket timed out', message: 'exit 1' }),
    } as Fake);
    await expect(exitOther.service.analyze('56')).rejects.not.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('aggregate memory requests for limits', () => {
  function memLimitCtx(opts: {
    tresMem: string | null;
    memory: MemoryRequirement;
    cpus: number | null;
    nodes: number | null;
    gpus?: number;
  }) {
    const pending = makeJob({
      id: '110', state: 'PENDING', stateReason: 'AssocGrpMemLimit', account: 'research',
      requested: {
        cpus: opts.cpus, memoryMiB: opts.tresMem === null ? null : 999999, nodes: opts.nodes,
        gpus: { total: opts.gpus ?? 0, byType: {} },
      },
    });
    // When tresMem is null the ReqTRES aggregate is absent.
    if (opts.tresMem === null) {
      pending.requested.memoryMiB = null;
    } else {
      pending.requested.memoryMiB = Number(opts.tresMem);
    }
    const base = makeCtx(pending, { memory: opts.memory });
    return {
      ...base,
      assoc: {
        store: buildAssociationStore([
          assocEntry({ id: '1', parentId: null, account: 'root' }),
          assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root', grpTres: { cpu: null, memMiB: 100000, node: null, gres: {} } }),
          assocEntry({ id: '9', parentId: '2', account: 'research', user: 'alice' }),
        ]),
        capturedAt: new Date(),
      },
    } as AnalyzerContext;
  }

  test('ReqTRES aggregate wins over MinMemory flavors', async () => {
    const result = await analyzeAssocLimits(
      memLimitCtx({ tresMem: '8000', memory: { kind: 'perCpu', memoryMiB: 100 }, cpus: 3, nodes: 1 })
    );
    expect(result?.requested).toBe(8000);
  });

  test('--mem-per-cpu derives total from CPU count', async () => {
    const result = await analyzeAssocLimits(
      memLimitCtx({ tresMem: null, memory: { kind: 'perCpu', memoryMiB: 100 }, cpus: 3, nodes: 1 })
    );
    expect(result?.requested).toBe(300);
  });

  test('--mem-per-gpu derives total from GPU count', async () => {
    const result = await analyzeAssocLimits(
      memLimitCtx({ tresMem: null, memory: { kind: 'perGpu', memoryMiB: 500 }, cpus: null, nodes: 1, gpus: 2 })
    );
    expect(result?.requested).toBe(1000);
  });

  test('multi-node --mem multiplies per-node by node count', async () => {
    const result = await analyzeAssocLimits(
      memLimitCtx({ tresMem: null, memory: { kind: 'perNode', memoryMiB: 1000 }, cpus: null, nodes: 4 })
    );
    expect(result?.requested).toBe(4000);
  });

  test('underivable total declines the numeric analysis', async () => {
    const result = await analyzeAssocLimits(
      memLimitCtx({ tresMem: null, memory: { kind: 'perCpu', memoryMiB: 100 }, cpus: null, nodes: 1 })
    );
    expect(result).toBeNull();
  });
});

describe('UsageFactor zero and flags', () => {
  test('UsageFactor=0 zeroes the contribution without unknown', () => {
    const store = buildQosStore([{ ...emptyQosEntry('zeroed'), usageFactor: 0 }]);
    const jobs = [makeJob({ id: '120', qos: 'zeroed' })];
    const sum = sumRunMinutes(jobs, new Date('2026-01-01T00:30:00Z'), store, () => true, (job) => job.allocated.cpus);
    expect(sum.total).toBe(0);
    expect(sum.unknown).toBe(0);
    expect(sum.runningJobs).toBe(1);
  });

  test('strict UsageFactor: unset and -1 default to 1; numerics kept', () => {
    const header = 'Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags';
    const row = (name: string, usage: string): string => `${header}\n${name}|0|||||||||1|${usage}|`;
    const factor = (name: string, usage: string): number =>
      parseQosStdout(row(name, usage)).find((r) => r.name === name)?.usageFactor as number;
    expect(factor('blank', '')).toBe(1);
    expect(factor('clear', '-1')).toBe(1);
    expect(factor('na', 'N/A')).toBe(1);
    expect(factor('null', '(null)')).toBe(1);
    expect(factor('none', 'NONE')).toBe(1);
    expect(factor('zero', '0')).toBe(0);
    expect(factor('one', '1')).toBe(1);
    expect(factor('decimal', '1.5')).toBe(1.5);
    expect(factor('scientific', '1e3')).toBe(1000);
  });

  test('malformed UsageFactor fails the snapshot', () => {
    const header = 'Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags';
    for (const bad of ['garbage', 'NaN', 'nan', '1.2.3', 'abc', '-0.5', '-2', '1,5', 'inf']) {
      expect(() => parseQosStdout(`${header}\nq|0|||||||||1|${bad}|`)).toThrow();
    }
  });

  test('only the exact UsageFactorSafe flag sets usageFactorSafe', () => {
    const rows = parseQosStdout(
      'Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags\n' +
      'exact|0||||||||||1|UsageFactorSafe\n' +
      'safe|0||||||||||1|Safe\n' +
      'both|0||||||||||1|Safe,UsageFactorSafe\n' +
      'plain|0||||||||||1|OverPartQOS'
    );
    expect(rows.find((row) => row.name === 'exact')?.usageFactorSafe).toBe(true);
    expect(rows.find((row) => row.name === 'safe')?.usageFactorSafe).toBe(false);
    expect(rows.find((row) => row.name === 'both')?.usageFactorSafe).toBe(true);
    expect(rows.find((row) => row.name === 'plain')?.usageFactorSafe).toBe(false);
  });
});

describe('priority unknown values and fractional factors', () => {
  function priorityCtx(opts: {
    snapshotPriority: number | null;
    sprioWeighted: string;
    sprioNormalized: string;
    competitors?: Array<{ id: string; priority: number | null }>;
  }): AnalyzerContext {
    const pending = makeJob({
      id: '130', state: 'PENDING', stateReason: 'Priority', partition: 'debug', priority: opts.snapshotPriority,
    });
    const run: SlurmRunFn = jest.fn(async (_exe: string, args: readonly string[]) => {
      const argv = args.join(' ');
      if (argv.includes('-n')) {
        return { stdout: opts.sprioNormalized, stderr: '' };
      }
      return { stdout: opts.sprioWeighted, stderr: '' };
    });
    const base = makeCtx(pending, {
      jobs: (opts.competitors ?? []).map((c) => makeJob({ id: c.id, partition: 'debug', state: 'PENDING', priority: c.priority })),
      run,
    });
    return { ...base, sprioWeights: { weights: {}, capturedAt: new Date() } };
  }

  test('missing snapshot priority falls back to sprio total', async () => {
    const result = await analyzePriority(priorityCtx({
      snapshotPriority: null,
      sprioWeighted: 'JOBID PRIORITY AGE\n130 4242 10',
      sprioNormalized: 'JOBID PRIORITY AGE\n130 0.5 0.1',
    }));
    expect(result?.priority).toBe(4242);
  });

  test('no usable priority anywhere declines the analysis', async () => {
    const result = await analyzePriority(priorityCtx({
      snapshotPriority: null,
      sprioWeighted: 'JOBID PRIORITY AGE\n',
      sprioNormalized: 'JOBID PRIORITY AGE\n',
    }));
    expect(result).toBeNull();
  });

  test('competitors with unknown priority are excluded, not zeroed', async () => {
    const result = await analyzePriority(priorityCtx({
      snapshotPriority: 100,
      sprioWeighted: 'JOBID PRIORITY AGE\n130 100 10',
      sprioNormalized: 'JOBID PRIORITY AGE\n130 0.5 0.1',
      competitors: [
        { id: '131', priority: null },
        { id: '132', priority: 50 },
      ],
    }));
    expect(result?.higherPriorityJobs).toBe(0);
    expect(result?.competitors).toEqual([]);
    expect(result?.pendingJobs).toBe(3);
  });

  test('normalized fractional priorities survive parsing', async () => {
    const result = await analyzePriority(priorityCtx({
      snapshotPriority: 100,
      sprioWeighted: 'JOBID PRIORITY AGE\n130 100 10',
      sprioNormalized: 'JOBID PRIORITY AGE\n130 0.5 0.00001459',
    }));
    const age = result?.factors.find((factor) => factor.name === 'age');
    expect(age?.normalized).toBeCloseTo(0.00001459, 8);
    expect(age?.weighted).toBe(10);
  });
});

describe('run-minute unknown contributors', () => {
  function cpuRunMinutesCtx(jobs: Job[]): AnalyzerContext {
    const pending = makeJob({
      id: '140', state: 'PENDING', stateReason: 'AssocGrpCPURunMinutesLimit', account: 'research', qos: 'normal',
      requested: { cpus: 4, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
      timeLimit: { kind: 'finite', seconds: 3600 },
    });
    const base = makeCtx(pending, {
      jobs,
      assocEntries: [
        assocEntry({ id: '1', parentId: null, account: 'root' }),
        assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root', grpTresRunMins: { cpu: 100000, memMiB: null, node: null, gres: {} } }),
        assocEntry({ id: '9', parentId: '2', account: 'research', user: 'alice' }),
      ],
    });
    return {
      ...base,
      qos: { store: buildQosStore([{ ...emptyQosEntry('normal') }]), capturedAt: new Date() },
    };
  }

  function liveCpuJob(id: string, overrides: Partial<Job> = {}): Job {
    return makeJob({
      id, account: 'research', qos: 'normal',
      startTime: new Date(Date.now() - 60_000),
      allocated: { cpus: 2000, memoryMiB: null, nodes: null, gpus: { total: 0, byType: {} }, gpuPresent: true },
      ...overrides,
    });
  }

  test('unquantifiable remainder keeps the proven violation, used stays null', async () => {
    const withoutStart = await analyzeAssocLimits(cpuRunMinutesCtx([
      liveCpuJob('141'),
      makeJob({ id: '141b', account: 'research', qos: 'normal', startTime: null }),
    ]));
    expect(withoutStart?.limitingAccount).toBe('research');
    expect(withoutStart?.used).toBeNull();
    const unlimited = await analyzeAssocLimits(cpuRunMinutesCtx([
      liveCpuJob('142a'),
      makeJob({ id: '142', account: 'research', qos: 'normal', timeLimit: { kind: 'infinite' } }),
    ]));
    expect(unlimited?.limitingAccount).toBe('research');
    expect(unlimited?.used).toBeNull();
  });

  test('all-quantifiable contributors stay exact', async () => {
    const result = await analyzeAssocLimits(cpuRunMinutesCtx([liveCpuJob('143')]));
    expect(result?.used).not.toBeNull();
    expect(result?.limitingAccount).toBe('research');
  });

  test('unknown remainder without a proven lower bound yields nothing', async () => {
    const result = await analyzeAssocLimits(cpuRunMinutesCtx([
      makeJob({
        id: '144', account: 'research', qos: 'normal',
        startTime: new Date(Date.now() - 60_000),
        allocated: { cpus: 1, memoryMiB: null, nodes: null, gpus: { total: 0, byType: {} }, gpuPresent: true },
      }),
      makeJob({ id: '145', account: 'research', qos: 'normal', startTime: null }),
    ]));
    expect(result).toBeNull();
  });
});

describe('allocated-only usage accounting', () => {
  test('missing allocation is unknown; zero stays zero; allocated wins over requested', async () => {
    const entries = [
      assocEntry({ id: '1', parentId: null, account: 'root' }),
      assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root', grpTres: { cpu: 100, memMiB: null, node: null, gres: {} } }),
      assocEntry({ id: '9', parentId: '2', account: 'research', user: 'alice' }),
    ];
    const pending = makeJob({
      id: '150', state: 'PENDING', stateReason: 'AssocGrpCpuLimit', account: 'research',
      requested: { cpus: 1, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
    });
    const base = { store: buildAssociationStore(entries), capturedAt: new Date() };
    const differs = await analyzeAssocLimits({
      ...makeCtx(pending, {
        jobs: [makeJob({
          id: '151', account: 'research',
          requested: { cpus: 32, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
          allocated: { cpus: 2, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
        })],
      }),
      assoc: base,
    });
    expect(differs?.used).toBe(2);
    const missing = await analyzeAssocLimits({
      ...makeCtx(pending, {
        jobs: [makeJob({
          id: '152', account: 'research',
          requested: { cpus: 32, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
          allocated: { cpus: null, memoryMiB: null, nodes: null, gpus: { total: 0, byType: {} } },
        })],
      }),
      assoc: base,
    });
    expect(missing).toBeNull();
    const zeroed = await analyzeAssocLimits({
      ...makeCtx(pending, {
        jobs: [makeJob({
          id: '153', account: 'research',
          requested: { cpus: 32, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
          allocated: { cpus: 0, memoryMiB: null, nodes: null, gpus: { total: 0, byType: {} } },
        })],
      }),
      assoc: base,
    });
    expect(zeroed?.used).toBe(0);
  });
});

describe('sacctmgr strict rows and QOS aliases', () => {
  const header = 'ID|ParentID|Cluster|Account|User|Partition|ParentName|GrpTRES|GrpTRESRunMins|GrpJobs|MaxJobs';

  test('blank and header rows skipped; one malformed row fails the snapshot', () => {
    expect(() => parseAssocStdout(`${header}\n1||c|research|||root|cpu=10||||\nBADROW\n`)).toThrow();
    expect(() => parseAssocStdout(`${header}\n1||c|research|||root|cpu=10||||\n1|xx|c|research|||root|cpu=10||||\n`)).toThrow();
    expect(() => parseAssocStdout(`${header}\n1||c|research|||root|cpu=10||||\n1||c|research|||root|cpu=10|||||extra|cols|here|and|more|columns\n`)).not.toThrow();
    expect(() => parseAssocStdout(`${header}\n1||c|research|||root|not-a-tres||||\n`)).toThrow();
    expect(() => parseAssocStdout(`${header}\n1||c|research|||root|cpu=10||||\n1||c|||||cpu=10||||\n`)).toThrow();
    expect(parseAssocStdout(`${header}\n\n1||c|research|||root|cpu=10||||\n\n`)).toHaveLength(1);
  });

  test('QOS malformed rows fail; canonical GrpTRES wins over contradictory alias', () => {
    expect(() => parseQosStdout('Name|Priority|GrpCPUs\nonly|0|1\n')).toThrow();
    const merged = parseQosStdout(
      'Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags\n' +
      'both|0|99||||cpu=10|||||1|\n' +
      'alias|0|7|||||||||1|'
    );
    expect(merged.find((row) => row.name === 'both')?.grpTres.cpu).toBe(10);
    expect(merged.find((row) => row.name === 'alias')?.grpTres.cpu).toBe(7);
  });
});

describe('targeted exact identity', () => {
  test('schema failure stays visible, never downgrades', () => {
    expect(() => parseTargetedJobStdout(PARSER, JSON.stringify({ jobs: [{ unexpected: true }] }), '1')).toThrow();
  });

  test('requested job matched exactly; others never substitute', () => {
    const stdout = JSON.stringify({
      errors: [],
      jobs: [
        { job_id: 1, job_state: ['RUNNING'] },
        { job_id: 2, job_state: ['PENDING'] },
      ],
    });
    expect(parseTargetedJobStdout(PARSER, stdout, '2')?.job.jobId).toBe('2');
    expect(parseTargetedJobStdout(PARSER, stdout, '99')).toBeNull();
  });

  test('array task composes from task ids; master never satisfies a task query', () => {
    const stdout = JSON.stringify({
      errors: [],
      jobs: [{ job_id: 100, array_job_id: { number: 100, set: true }, array_task_id: { number: 4, set: true }, job_state: ['RUNNING'] }],
    });
    expect(parseTargetedJobStdout(PARSER, stdout, '100_4')?.job.id).toBe('100_4');
    const masterOnly = JSON.stringify({ errors: [], jobs: [{ job_id: 101, job_state: ['COMPLETED'] }] });
    expect(parseTargetedJobStdout(PARSER, masterOnly, '101_4')).toBeNull();
  });
});

describe('array-task dependency exactness', () => {
  function depCtxFor(pending: Job, jobs: Job[]): AnalyzerContext {
    return {
      ...makeCtx(pending, { jobs }),
      targeted: {
        job: pending,
        schedNodeList: null,
        reqNodeList: null,
        arrayThrottle: null,
        memory: { kind: 'unknown', memoryMiB: null },
        minMemoryMiB: null,
        requestedNodes: 1,
        capturedAt: new Date(),
      },
    };
  }

  test('explicit task found evaluates the task', async () => {
    const pending = makeJob({ id: '160', state: 'PENDING', stateReason: 'Dependency', dependency: 'afterok:161_4' });
    const task = makeJob({ id: '161_4', jobId: '161', arrayJobId: '161', arrayTaskId: '4', state: 'COMPLETED', exitCode: '0' });
    const result = await analyzeDependency(depCtxFor(pending, [task]));
    expect(result?.dependencies[0]?.jobs[0]?.status).toBe('satisfied');
  });

  test('explicit task missing but master exists stays unknown', async () => {
    const pending = makeJob({ id: '162', state: 'PENDING', stateReason: 'Dependency', dependency: 'afterok:163_4' });
    const master = makeJob({ id: '163', state: 'COMPLETED', exitCode: '0' });
    const result = await analyzeDependency(depCtxFor(pending, [master]));
    expect(result?.dependencies[0]?.jobs[0]?.status).toBe('unknown');
  });

  test('aftercorr with the actual correlated task evaluates; master-only is unknown', async () => {
    const self = makeJob({
      id: '164_4', jobId: '164', arrayJobId: '164', arrayTaskId: '4',
      state: 'PENDING', stateReason: 'Dependency', dependency: 'aftercorr:165',
    });
    const correlated = makeJob({ id: '165_4', jobId: '165', arrayJobId: '165', arrayTaskId: '4', state: 'COMPLETED', exitCode: '0' });
    expect((await analyzeDependency(depCtxFor(self, [correlated])))?.status).toBe('satisfied');
    const master = makeJob({ id: '165', state: 'COMPLETED', exitCode: '0' });
    expect((await analyzeDependency(depCtxFor(self, [master])))?.status).toBe('unknown');
  });
});

describe('singleton large job IDs', () => {
  function singletonTarget(id: string, submit: Date | null): Job {
    return makeJob({
      id, state: 'PENDING', stateReason: 'Dependency', user: 'alice', name: 'pipe',
      submitTime: submit, jobId: id, dependency: 'singleton',
    });
  }

  test('IDs above one million order correctly with equal timestamps', async () => {
    const when = new Date('2026-01-01T02:00:00Z');
    const target = singletonTarget('2000002', when);
    const earlier = makeJob({
      id: '2000001', state: 'RUNNING', user: 'alice', name: 'pipe', submitTime: when, jobId: '2000001',
    });
    const ctx: AnalyzerContext = {
      ...makeCtx(target, { jobs: [earlier] }),
      targeted: {
        job: target, schedNodeList: null, reqNodeList: null, arrayThrottle: null,
        memory: { kind: 'unknown', memoryMiB: null }, minMemoryMiB: null, requestedNodes: 1, capturedAt: new Date(),
      },
    };
    expect((await analyzeDependency(ctx))?.status).toBe('unsatisfied');
    const later = makeJob({
      id: '2000003', state: 'RUNNING', user: 'alice', name: 'pipe', submitTime: when, jobId: '2000003',
    });
    const ctxLater: AnalyzerContext = {
      ...makeCtx(target, { jobs: [later] }),
      targeted: {
        job: target, schedNodeList: null, reqNodeList: null, arrayThrottle: null,
        memory: { kind: 'unknown', memoryMiB: null }, minMemoryMiB: null, requestedNodes: 1, capturedAt: new Date(),
      },
    };
    expect((await analyzeDependency(ctxLater))?.status).toBe('satisfied');
  });
});

describe('canonical missing-job signal and refresh timestamps', () => {
  interface Fake {
    targeted: Record<string, unknown>;
    squeueTexts: string[];
    assocTexts: string[];
    qosTexts: string[];
    calls: { squeue: number; assoc: number; qos: number };
    targetedError?: unknown;
    failAssocRefresh?: boolean;
    captureProbe?: { capturedAt: string | null };
  }

  function squeueJob(partial: Record<string, unknown>): Record<string, unknown> {
    return {
      job_id: 1, partition: 'debug', name: 'job', user_name: 'alice', account: 'research',
      qos: 'normal', job_state: ['RUNNING'], tres_req_str: 'cpu=4,mem=100M,node=1', tres_alloc_str: 'cpu=4,mem=100M,node=1',
      ...partial,
    };
  }

  function serviceFor(fake: Fake): PendingAnalysisService {
    const run: SlurmRunFn = jest.fn(async (executable: string, args: readonly string[]) => {
      const argv = args.join(' ');
      if (executable === 'squeue') {
        const text = fake.squeueTexts[Math.min(fake.calls.squeue, fake.squeueTexts.length - 1)] ?? fake.squeueTexts[0] ?? '';
        fake.calls.squeue += 1;
        return { stdout: text, stderr: '' };
      }
      if (executable === 'scontrol' && argv.includes('show job')) {
        if (fake.targetedError !== undefined) {
          throw fake.targetedError;
        }
        const probed = parseTargetedJobStdout(PARSER, JSON.stringify({ errors: [], jobs: [fake.targeted] }), String((fake.targeted as Record<string, unknown>)['job_id'] ?? '1'));
        if (fake.captureProbe !== undefined) {
          fake.captureProbe.capturedAt = probed?.capturedAt.toISOString() ?? null;
        }
        return { stdout: JSON.stringify({ errors: [], jobs: [fake.targeted] }), stderr: '' };
      }
      if (executable === 'scontrol' && argv.includes('show config')) {
        return { stdout: 'ClusterName=nova\n', stderr: '' };
      }
      if (executable === 'scontrol' && argv.includes('show config')) {
        return { stdout: 'ClusterName=nova\n', stderr: '' };
      }
      if (executable === 'scontrol' && argv.includes('show partition')) {
        return { stdout: JSON.stringify({ errors: [], partitions: [] }), stderr: '' };
      }
      if (executable === 'sacctmgr' && argv.includes('assoc')) {
        if (fake.failAssocRefresh === true && fake.calls.assoc >= 1) {
          throw new CommandError({ kind: 'non-zero-exit', executable: 'sacctmgr', args: [], exitCode: 1, stderrSnippet: 'slurmdbd: gone', message: 'exit 1' });
        }
        const text = fake.assocTexts[Math.min(fake.calls.assoc, fake.assocTexts.length - 1)] ?? '';
        fake.calls.assoc += 1;
        return { stdout: text, stderr: '' };
      }
      if (executable === 'sacctmgr') {
        const text = fake.qosTexts[0] ?? '';
        fake.calls.qos += 1;
        return { stdout: text, stderr: '' };
      }
      throw new Error(`unexpected ${executable} ${argv}`);
    });
    const slurmContext = { parser: PARSER, run };
    return new PendingAnalysisService({
      slurmContext,
      jobsCache: new JobsCache(slurmContext),
      assocCache: new AssocCache(slurmContext),
      qosCache: new QosCache(slurmContext),
    });
  }

  const assocHeader = 'ID|ParentID|Cluster|Account|User|Partition|ParentName|GrpTRES|GrpTRESRunMins|GrpJobs|MaxJobs';
  const qosRow = 'Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags\nnormal|0||||||||||1|';

  beforeEach(() => {
    clearContradictionCooldownForTests();
  });

  test.each([
    ['bare canonical phrase', 'Invalid job id specified'],
    ['phrase with echoed id', 'Invalid job id specified: 170'],
    ['unknown job with id', 'unknown job 170'],
  ])('missing job %s becomes 404', async (_label, stderr) => {
    const fake: Fake = {
      targeted: squeueJob({ job_id: 170, job_state: ['PENDING'], state_reason: 'Resources' }),
      squeueTexts: [JSON.stringify({ errors: [], jobs: [] })],
      assocTexts: [],
      qosTexts: [],
      calls: { squeue: 0, assoc: 0, qos: 0 },
      targetedError: new CommandError({ kind: 'non-zero-exit', executable: 'scontrol', args: [], exitCode: 1, stderrSnippet: stderr, message: 'exit 1' }),
    };
    await expect(serviceFor(fake).analyze('170')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test.each([
    ['slurmdbd failure', 'slurmdbd: Access denied'],
    ['timeout', 'scontrol: socket timed out'],
    ['permission failure', 'scontrol: permission denied for user'],
    ['bare not found', 'config file not found: /etc/slurm/slurm.conf'],
  ])('non-job failure (%s) never becomes 404', async (_label, stderr) => {
    const fake: Fake = {
      targeted: squeueJob({ job_id: 171, job_state: ['PENDING'], state_reason: 'Resources' }),
      squeueTexts: [JSON.stringify({ errors: [], jobs: [] })],
      assocTexts: [],
      qosTexts: [],
      calls: { squeue: 0, assoc: 0, qos: 0 },
      targetedError: new CommandError({ kind: 'non-zero-exit', executable: 'scontrol', args: [], exitCode: 1, stderrSnippet: stderr, message: 'exit 1' }),
    };
    await expect(serviceFor(fake).analyze('171')).rejects.not.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('post-refresh analysis carries a later final updatedAt', async () => {
    const probe: { capturedAt: string | null } = { capturedAt: null };
    const fake: Fake = {
      targeted: squeueJob({ job_id: 172, job_state: ['PENDING'], state_reason: 'AssocGrpCpuLimit', tres_req_str: 'cpu=1,mem=100M,node=1' }),
      squeueTexts: [JSON.stringify({ errors: [], jobs: [] })],
      assocTexts: [`${assocHeader}\n1||c|research|||root|cpu=100||||\n2|1|c|research|alice||research|||||`],
      qosTexts: [qosRow],
      calls: { squeue: 0, assoc: 0, qos: 0 },
      captureProbe: probe,
    };
    const result = await serviceFor(fake).analyze('172', { nowMs: 9_000_000 });
    expect(result.analysis?.kind).toBe('limit');
    expect(result.updatedAt instanceof Date).toBe(true);
    expect(probe.capturedAt).not.toBeNull();
    expect(result.updatedAt.toISOString() >= (probe.capturedAt as string)).toBe(true);
  });

  test('failed contradiction refresh keeps the original measurement and timestamp', async () => {
    const probe: { capturedAt: string | null } = { capturedAt: null };
    const fake: Fake = {
      targeted: squeueJob({ job_id: 173, job_state: ['PENDING'], state_reason: 'AssocGrpCpuLimit', tres_req_str: 'cpu=1,mem=100M,node=1' }),
      squeueTexts: [JSON.stringify({ errors: [], jobs: [] })],
      assocTexts: [`${assocHeader}\n1||c|research|||root|cpu=100||||\n2|1|c|research|alice||research|||||`],
      qosTexts: [qosRow],
      calls: { squeue: 0, assoc: 0, qos: 0 },
      failAssocRefresh: true,
      captureProbe: probe,
    };
    const result = await serviceFor(fake).analyze('173', { nowMs: 9_100_000 });
    if (result.analysis?.kind !== 'limit') {
      throw new Error('expected limit analysis');
    }
    expect(result.analysis.limit).toBe(100);
    expect(result.updatedAt.toISOString() >= (probe.capturedAt as string)).toBe(true);
  });

  test('abort during contradiction refresh propagates instead of stale analysis', async () => {
    const aborted = new CommandError({ kind: 'aborted', executable: 'sacctmgr', args: [], message: 'aborted' });
    const run: SlurmRunFn = jest.fn(async (executable: string, args: readonly string[]) => {
      const argv = args.join(' ');
      if (executable === 'scontrol' && argv.includes('show config')) {
        return { stdout: 'ClusterName=nova\n', stderr: '' };
      }
      if (executable === 'squeue') {
        return { stdout: JSON.stringify({ errors: [], jobs: [] }), stderr: '' };
      }
      if (executable === 'scontrol' && argv.includes('show job')) {
        return {
          stdout: JSON.stringify({
            errors: [],
            jobs: [squeueJob({ job_id: 174, job_state: ['PENDING'], state_reason: 'AssocGrpCpuLimit', account: 'research', user_name: 'alice', tres_req_str: 'cpu=1,mem=100M,node=1' })],
          }),
          stderr: '',
        };
      }
      if (executable === 'sacctmgr' && argv.includes('assoc')) {
        const assocLoads = (run as jest.Mock).mock.calls.filter(
          (call) => call[0] === 'sacctmgr' && (call[1] as readonly string[]).join(' ').includes('assoc')
        ).length;
        if (assocLoads >= 1) {
          throw aborted;
        }
        return {
          stdout: `${assocHeader}\n1||c|research|||root|cpu=100||||\n2|1|c|research|alice||research|||||`,
          stderr: '',
        };
      }
      if (executable === 'sacctmgr') {
        return { stdout: qosRow, stderr: '' };
      }
      throw new Error(`unexpected ${executable} ${argv}`);
    });
    const slurmContext = { parser: PARSER, run };
    const service = new PendingAnalysisService({
      slurmContext,
      jobsCache: new JobsCache(slurmContext),
      assocCache: new AssocCache(slurmContext),
      qosCache: new QosCache(slurmContext),
    });
    await expect(service.analyze('174', { nowMs: 9_200_000 })).rejects.toBe(aborted);
  });
});

describe('association evidence-aware selection', () => {
  const entries = [
    assocEntry({ id: '1', parentId: null, account: 'root', grpTres: { cpu: 1000, memMiB: null, node: null, gres: {} } }),
    assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root', grpTres: { cpu: 100, memMiB: null, node: null, gres: {} } }),
    assocEntry({ id: '3', parentId: '2', account: 'child', parentAccount: 'research', grpTres: { cpu: 10, memMiB: null, node: null, gres: {} } }),
    assocEntry({ id: '4', parentId: '3', account: 'child', user: 'alice' }),
  ];

  function cpuPending(id: string, account: string, cpus: number): Job {
    return makeJob({
      id, state: 'PENDING', stateReason: 'AssocGrpCpuLimit', account,
      requested: { cpus, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
    });
  }

  function cpuJob(id: string, account: string, cpus: number | null): Job {
    return makeJob({
      id, account,
      requested: { cpus: cpus ?? 1, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
      allocated: { cpus, memoryMiB: null, nodes: null, gpus: { total: 0, byType: {} } },
    });
  }

  test('child headroom plus unknown parent establishes no limiter', async () => {
    const result = await analyzeAssocLimits({
      ...makeCtx(cpuPending('200', 'child', 1), {
        jobs: [
          cpuJob('201', 'child', 2),
          cpuJob('202', 'research', null),
        ],
      }),
      assoc: { store: buildAssociationStore(entries), capturedAt: new Date() },
    });
    expect(result).toBeNull();
  });

  test('multiple proven violations choose the deepest level, not min headroom', async () => {
    const result = await analyzeAssocLimits({
      ...makeCtx(cpuPending('203', 'child', 5), {
        jobs: [cpuJob('204', 'child', 8)],
      }),
      assoc: { store: buildAssociationStore(entries), capturedAt: new Date() },
    });
    expect(result?.limitingAccount).toBe('child');
    expect(result?.used).toBe(8);
  });

  test('proven child violation survives unknown parent usage', async () => {
    const result = await analyzeAssocLimits({
      ...makeCtx(cpuPending('211', 'child', 5), {
        jobs: [
          cpuJob('212', 'child', 8),
          cpuJob('213', 'research', null),
        ],
      }),
      assoc: { store: buildAssociationStore(entries), capturedAt: new Date() },
    });
    expect(result?.limitingAccount).toBe('child');
    expect(result?.used).toBe(8);
    expect(result?.hierarchy?.find((row) => row.account === 'research')?.used).toBeNull();
  });

  test('deepest-first among several proven violations', async () => {
    const tight = [
      assocEntry({ id: '1', parentId: null, account: 'root', grpTres: { cpu: 12, memMiB: null, node: null, gres: {} } }),
      assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root', grpTres: { cpu: 11, memMiB: null, node: null, gres: {} } }),
      assocEntry({ id: '3', parentId: '2', account: 'child', parentAccount: 'research', grpTres: { cpu: 10, memMiB: null, node: null, gres: {} } }),
      assocEntry({ id: '4', parentId: '3', account: 'child', user: 'alice' }),
    ];
    const result = await analyzeAssocLimits({
      ...makeCtx(cpuPending('205', 'child', 5), { jobs: [cpuJob('206', 'child', 8)] }),
      assoc: { store: buildAssociationStore(tight), capturedAt: new Date() },
    });
    expect(result?.limitingAccount).toBe('child');
    expect(result?.used).toBe(8);
  });

  test('all known with headroom returns unclaimed measurement for refresh', async () => {
    const result = await analyzeAssocLimits({
      ...makeCtx(cpuPending('207', 'child', 1), { jobs: [cpuJob('208', 'child', 2)] }),
      assoc: { store: buildAssociationStore(entries), capturedAt: new Date() },
    });
    expect(result?.limitingAccount).toBeUndefined();
    expect(result?.used).toBe(2);
    expect(result?.hierarchy?.every((row) => row.limiting === false)).toBe(true);
  });

  test('all usages unknown returns null', async () => {
    const result = await analyzeAssocLimits({
      ...makeCtx(cpuPending('209', 'child', 1), { jobs: [cpuJob('210', 'child', null)] }),
      assoc: { store: buildAssociationStore(entries), capturedAt: new Date() },
    });
    expect(result).toBeNull();
  });
});

describe('association hierarchy validation', () => {
  test('healthy chain traverses', () => {
    const store = buildAssociationStore([
      assocEntry({ id: '1', parentId: null, account: 'root' }),
      assocEntry({ id: '2', parentId: '1', account: 'mid', parentAccount: 'root' }),
      assocEntry({ id: '3', parentId: '2', account: 'leaf', parentAccount: 'mid' }),
    ]);
    const start = store.byId.get('3') as AssociationEntry;
    expect(ancestorChainById(store, start).map((entry) => entry.account)).toEqual(['leaf', 'mid', 'root']);
  });

  test('missing ParentID target fails instead of truncating', () => {
    const store = buildAssociationStore([
      assocEntry({ id: '1', parentId: '99', account: 'orphan' }),
    ]);
    const start = store.byId.get('1') as AssociationEntry;
    expect(() => ancestorChainById(store, start)).toThrow();
  });

  test('cycle fails instead of terminating', () => {
    const store = buildAssociationStore([
      assocEntry({ id: '1', parentId: '2', account: 'a' }),
      assocEntry({ id: '2', parentId: '1', account: 'b' }),
    ]);
    const start = store.byId.get('1') as AssociationEntry;
    expect(() => ancestorChainById(store, start)).toThrow();
  });

  test('duplicate ID fails the store build', () => {
    expect(() => buildAssociationStore([
      assocEntry({ id: '1', parentId: null, account: 'a' }),
      assocEntry({ id: '1', parentId: null, account: 'b' }),
    ])).toThrow();
  });

  test('duplicate identity tuple with different IDs fails the store build', () => {
    expect(() => buildAssociationStore([
      assocEntry({ id: '1', parentId: null, account: 'research', user: 'alice', partition: 'debug' }),
      assocEntry({ id: '2', parentId: null, account: 'research', user: 'alice', partition: 'debug' }),
    ])).toThrow();
  });

  test('null partition stays distinct from a named partition', () => {
    const store = buildAssociationStore([
      assocEntry({ id: '1', parentId: null, account: 'research', user: 'alice' }),
      assocEntry({ id: '2', parentId: '1', account: 'research', user: 'alice', partition: 'debug' }),
    ]);
    expect(resolveAssociation(store, { account: 'research', user: 'alice', partition: 'debug' })?.id).toBe('2');
    expect(resolveAssociation(store, { account: 'research', user: 'alice', partition: 'other' })?.id).toBe('1');
    expect(resolveAssociation(store, { account: 'research', user: 'alice', partition: null })?.id).toBe('1');
  });

  test('same account with different users stays distinct', () => {
    const store = buildAssociationStore([
      assocEntry({ id: '1', parentId: null, account: 'research', user: 'alice' }),
      assocEntry({ id: '2', parentId: null, account: 'research', user: 'bob' }),
    ]);
    expect(resolveAssociation(store, { account: 'research', user: 'alice', partition: null })?.id).toBe('1');
    expect(resolveAssociation(store, { account: 'research', user: 'bob', partition: null })?.id).toBe('2');
    expect(resolveAssociation(store, { account: 'research', user: 'carol', partition: null })).toBeNull();
  });

  test('depth overflow fails instead of truncating', () => {
    const chainEntries: AssociationEntry[] = [];
    for (let i = 0; i < 25; i += 1) {
      chainEntries.push(
        assocEntry({ id: String(i + 1), parentId: i === 24 ? null : String(i + 2), account: `a${i}` })
      );
    }
    const store = buildAssociationStore(chainEntries);
    const start = store.byId.get('1') as AssociationEntry;
    expect(() => ancestorChainById(store, start)).toThrow();
  });
});

describe('Resources tri-state partial evidence', () => {
  function triCtx(opts: {
    nodes: number | null;
    cpus: number | null;
    memory: MemoryRequirement;
    nodeFreeMem?: number;
    nodeCpus?: number;
  }) {
    const pending = makeJob({
      id: '300', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: opts.cpus, memoryMiB: null, nodes: opts.nodes, gpus: { total: 0, byType: {} } },
    });
    return makeCtx(pending, {
      memory: opts.memory,
      nodes: [makeNode({
        name: 'node01',
        cpus: opts.nodeCpus ?? 8,
        effectiveCpus: opts.nodeCpus ?? 8,
        totalMemoryMiB: 131072,
        allocMemoryMiB: 131072 - (opts.nodeFreeMem ?? 131072),
      })],
    });
  }

  test('all dimensions known and fitting => sufficient', async () => {
    const result = await analyzeResources(triCtx({
      nodes: 1, cpus: 4, memory: { kind: 'perNode', memoryMiB: 1024 },
    }));
    expect(result?.nodes[0]?.status).toBe('sufficient');
    expect(result?.sufficientNodes).toBe(1);
  });

  test('all dimensions known with a shortage => insufficient', async () => {
    const result = await analyzeResources(triCtx({
      nodes: 1, cpus: 64, memory: { kind: 'perNode', memoryMiB: 1024 },
    }));
    expect(result?.nodes[0]?.status).toBe('insufficient');
  });

  test('CPU unknown with memory shortage => insufficient', async () => {
    const result = await analyzeResources(triCtx({
      nodes: 4, cpus: 64,
      memory: { kind: 'perNode', memoryMiB: 200000 },
      nodeFreeMem: 65536,
    }));
    expect(result?.nodes[0]?.status).toBe('insufficient');
    expect(result?.nodes[0]?.shortages).toEqual([
      { resource: 'memoryMiB', requested: 200000, currentlyUnallocated: 65536 },
    ]);
  });

  test('CPU unknown with memory fitting => unknown, not sufficient', async () => {
    const result = await analyzeResources(triCtx({
      nodes: 4, cpus: 64, memory: { kind: 'perNode', memoryMiB: 1024 },
    }));
    expect(result?.nodes[0]?.status).toBe('unknown');
    expect(result?.sufficientNodes).toBe(0);
    expect(result?.unknownNodes).toBe(1);
  });

  test('GPU unknown with CPU/memory fitting => unknown', async () => {
    const pending = makeJob({
      id: '301', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: 2, memoryMiB: null, nodes: 2, gpus: { total: 4, byType: { unknown: 4 } } },
    });
    const ctx = makeCtx(pending, { memory: { kind: 'unknown', memoryMiB: null } });
    const result = await analyzeResources(ctx);
    expect(result).toBeNull();
  });

  test('no evaluable dimensions => analysis null', async () => {
    const pending = makeJob({
      id: '302', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: null, memoryMiB: null, nodes: null, gpus: { total: 0, byType: {} } },
    });
    await expect(analyzeResources(makeCtx(pending))).resolves.toBeNull();
  });
});

describe('dependency lookup failure propagation', () => {
  function depCtxFor(pending: Job, jobs: Job[], run?: SlurmRunFn): AnalyzerContext {
    return {
      ...makeCtx(pending, { jobs, run }),
      targeted: {
        job: pending, schedNodeList: null, reqNodeList: null, arrayThrottle: null,
        memory: { kind: 'unknown', memoryMiB: null }, minMemoryMiB: null, requestedNodes: 1, capturedAt: new Date(),
      },
    };
  }

  function failingRun(error: unknown): SlurmRunFn {
    return jest.fn().mockRejectedValue(error);
  }

  test('timeout propagates instead of becoming unknown', async () => {
    const pending = makeJob({ id: '310', state: 'PENDING', stateReason: 'Dependency', dependency: 'afterok:311' });
    const run = failingRun(new CommandError({ kind: 'timeout', executable: 'scontrol', args: [], message: 'timed out' }));
    await expect(analyzeDependency(depCtxFor(pending, [], run))).rejects.toMatchObject({ kind: 'timeout' });
  });

  test('unrelated controller error propagates', async () => {
    const pending = makeJob({ id: '312', state: 'PENDING', stateReason: 'Dependency', dependency: 'afterok:313' });
    const run = failingRun(new CommandError({
      kind: 'non-zero-exit', executable: 'scontrol', args: [], exitCode: 1,
      stderrSnippet: 'scontrol: slurmdbd failure', message: 'exit 1',
    }));
    await expect(analyzeDependency(depCtxFor(pending, [], run))).rejects.toMatchObject({ kind: 'non-zero-exit' });
  });

  test('malformed upstream response propagates', async () => {
    const pending = makeJob({ id: '314', state: 'PENDING', stateReason: 'Dependency', dependency: 'afterok:315' });
    const run = failingRun(new UpstreamInvalidError('bad json'));
    await expect(analyzeDependency(depCtxFor(pending, [], run))).rejects.toThrow('bad json');
  });

  test('canonical invalid-job signal stays unknown', async () => {
    const pending = makeJob({ id: '316', state: 'PENDING', stateReason: 'Dependency', dependency: 'afterok:317' });
    const run = failingRun(new CommandError({
      kind: 'non-zero-exit', executable: 'scontrol', args: [], exitCode: 1,
      stderrSnippet: 'scontrol: Invalid job id specified', message: 'exit 1',
    }));
    const result = await analyzeDependency(depCtxFor(pending, [], run));
    expect(result?.dependencies[0]?.jobs[0]?.status).toBe('unknown');
  });

  test('lookup budget exhaustion yields unknown without extra calls', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => 400 + i);
    const pending = makeJob({
      id: '399', state: 'PENDING', stateReason: 'Dependency',
      dependency: `afterok:${ids.join(':')}`,
    });
    const run = jest.fn(async (_exe: string, args: readonly string[]) => {
      const id = String(args[args.length - 1] ?? '');
      throw new CommandError({
        kind: 'non-zero-exit', executable: 'scontrol', args: [...args], exitCode: 1,
        stderrSnippet: `scontrol: Invalid job id specified: ${id}`, message: 'exit 1',
      });
    });
    const result = await analyzeDependency(depCtxFor(pending, [], run));
    expect(result?.status).toBe('unknown');
    expect(run).toHaveBeenCalledTimes(10);
  });
});

describe('local cluster scoping', () => {
  test('ClusterName parses from scontrol show config', async () => {
    expect(parseClusterName('ClusterName=nova\nSlurmctldHost=x\n')).toBe('nova');
    expect(parseClusterName('SlurmctldHost=x\n')).toBeNull();
    expect(parseClusterName('ClusterName=bad;name\n')).toBeNull();
    const run: SlurmRunFn = jest.fn().mockResolvedValue({ stdout: 'ClusterName=nova\n', stderr: '' });
    await expect(fetchLocalClusterName({ parser: PARSER, run })).resolves.toBe('nova');
  });

  test('association query constrains to the local cluster when known', async () => {
    const seen: string[][] = [];
    const run: SlurmRunFn = jest.fn(async (exe: string, args: readonly string[]) => {
      seen.push([exe, ...args]);
      if (exe === 'scontrol') {
        return { stdout: 'ClusterName=nova\n', stderr: '' };
      }
      return { stdout: 'ID|ParentID|Cluster|Account|User|Partition|ParentName|GrpTRES|GrpTRESRunMins|GrpJobs|MaxJobs\n', stderr: '' };
    });
    await fetchAssocSnapshot({ parser: PARSER, run });
    const assocCall = seen.find((call) => call[0] === 'sacctmgr');
    expect(assocCall).toContain('Cluster=nova');
  });

  test('unresolvable cluster lookup fails instead of querying all clusters', async () => {
    const run: SlurmRunFn = jest.fn(async (exe: string) => {
      if (exe === 'scontrol') {
        throw new CommandError({ kind: 'timeout', executable: 'scontrol', args: [], message: 'timed out' });
      }
      return { stdout: 'ID|ParentID|Cluster|Account|User|Partition|ParentName|GrpTRES|GrpTRESRunMins|GrpJobs|MaxJobs\n', stderr: '' };
    });
    await expect(fetchAssocSnapshot({ parser: PARSER, run })).rejects.toThrow();
  });

  test('aborted cluster lookup propagates instead of querying', async () => {
    const run: SlurmRunFn = jest.fn(async (exe: string) => {
      if (exe === 'scontrol') {
        throw new CommandError({ kind: 'aborted', executable: 'scontrol', args: [], message: 'aborted' });
      }
      return { stdout: '', stderr: '' };
    });
    await expect(fetchAssocSnapshot({ parser: PARSER, run })).rejects.toMatchObject({ kind: 'aborted' });
  });

  test('missing ClusterName fails instead of querying all clusters', async () => {
    const run: SlurmRunFn = jest.fn(async (exe: string) => {
      if (exe === 'scontrol') {
        return { stdout: 'SlurmctldHost=x\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    await expect(fetchAssocSnapshot({ parser: PARSER, run })).rejects.toThrow(/ClusterName/);
  });
});

describe('multiple typed-GPU requests', () => {
  function gresCtx(gpus: Job['requested']['gpus']): AnalyzerContext {
    const pending = makeJob({
      id: '330', state: 'PENDING', stateReason: 'AssocGrpGRES', account: 'research',
      requested: { cpus: null, memoryMiB: null, nodes: 1, gpus },
    });
    return {
      ...makeCtx(pending),
      assoc: {
        store: buildAssociationStore([
          assocEntry({ id: '1', parentId: null, account: 'root' }),
          assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root', grpTres: { cpu: null, memMiB: null, node: null, gres: { 'gpu:a100': 4, 'gpu:v100': 4 } } }),
          assocEntry({ id: '9', parentId: '2', account: 'research', user: 'alice' }),
        ]),
        capturedAt: new Date(),
      },
    };
  }

  test('single typed request analyzes regardless of key order', async () => {
    const forward = await analyzeAssocLimits(gresCtx({ total: 1, byType: { a100: 1 } }));
    expect(forward?.gpuType).toBe('a100');
    expect(forward?.requested).toBe(1);
  });

  test('simultaneous typed requests decline instead of picking one', async () => {
    const first = await analyzeAssocLimits(gresCtx({ total: 3, byType: { a100: 1, v100: 2 } }));
    const reversed = await analyzeAssocLimits(gresCtx({ total: 3, byType: { v100: 2, a100: 1 } }));
    expect(first).toBeNull();
    expect(reversed).toBeNull();
  });

  test('untyped aggregate analyzes the generic type', async () => {
    const pending = makeJob({
      id: '331', state: 'PENDING', stateReason: 'AssocGrpGRES', account: 'research',
      requested: { cpus: null, memoryMiB: null, nodes: 1, gpus: { total: 2, byType: { unknown: 2 } } },
    });
    const ctx: AnalyzerContext = {
      ...makeCtx(pending),
      assoc: {
        store: buildAssociationStore([
          assocEntry({ id: '1', parentId: null, account: 'root' }),
          assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root', grpTres: { cpu: null, memMiB: null, node: null, gres: { gpu: 4 } } }),
          assocEntry({ id: '9', parentId: '2', account: 'research', user: 'alice' }),
        ]),
        capturedAt: new Date(),
      },
    };
    const result = await analyzeAssocLimits(ctx);
    expect(result?.gpuType).toBeUndefined();
    expect(result?.requested).toBe(2);
  });
});

describe('reservation exact identity', () => {
  test('matching JSON identity accepted', () => {
    const parsed = parseReservationJson(JSON.stringify({ reservations: [{ name: 'resv1', state: 'ACTIVE' }] }));
    expect(parsed?.name).toBe('resv1');
  });

  test('wrong JSON identity and missing JSON identity surface, not synthesize', () => {
    expect(parseReservationJson(JSON.stringify({ reservations: [{ name: 'other', state: 'ACTIVE' }] }))?.name).toBe('other');
    expect(parseReservationJson(JSON.stringify({ reservations: [{ state: 'ACTIVE' }] }))?.name).toBeNull();
    expect(parseReservationJson('not json')).toBeNull();
  });

  test('matching text identity accepted; wrong/missing text identity surfaces', () => {
    expect(parseReservationText('ReservationName=resv1 State=ACTIVE')?.name).toBe('resv1');
    expect(parseReservationText('ReservationName=other State=ACTIVE')?.name).toBe('other');
    expect(parseReservationText('State=ACTIVE')?.name).toBeNull();
    expect(parseReservationText('')).toBeNull();
  });

  test('fetch rejects mismatched identity without text retry', async () => {
    const run: SlurmRunFn = jest.fn().mockResolvedValue({
      stdout: JSON.stringify({ reservations: [{ name: 'other', state: 'ACTIVE' }] }),
      stderr: '',
    });
    await expect(fetchReservationDetail({ parser: PARSER, run }, 'resv1')).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('GPU allocation presence', () => {
  function rawJob(overrides: Record<string, unknown>): never {
    return { job_id: 1, ...overrides } as never;
  }

  test('explicit zero, positive, absent, and malformed allocations', () => {
    expect(normalizeJob(rawJob({ tres_alloc_str: 'cpu=4,mem=100M,node=1,gres/gpu=0' })).allocated.gpuPresent).toBe(true);
    expect(normalizeJob(rawJob({ tres_alloc_str: 'cpu=4,mem=100M,node=1,gres/gpu=2' })).allocated.gpus.total).toBe(2);
    expect(normalizeJob(rawJob({ tres_alloc_str: 'cpu=4,mem=100M,node=1' })).allocated.gpuPresent).toBe(true);
    expect(normalizeJob(rawJob({ tres_alloc_str: 'cpu=4,mem=100M,node=1' })).allocated.gpus.total).toBe(0);
    expect(normalizeJob(rawJob({})).allocated.gpuPresent).toBe(false);
    expect(normalizeJob(rawJob({ tres_alloc_str: '!!!not-tres!!!' })).allocated.gpuPresent).toBe(false);
    expect(
      normalizeJob(rawJob({ gres_detail: ['gpu:a100:2(IDX:0-1)'] })).allocated.gpus.byType
    ).toMatchObject({ a100: 2 });
  });

  test('GRES usage counts known GPU zeros without unknown', async () => {
    const pending = makeJob({
      id: '340', state: 'PENDING', stateReason: 'AssocGrpGRES', account: 'research',
      requested: { cpus: null, memoryMiB: null, nodes: 1, gpus: { total: 1, byType: { a100: 1 } } },
    });
    const result = await analyzeAssocLimits({
      ...makeCtx(pending, {
        jobs: [
          makeJob({
            id: '341', account: 'research',
            allocated: { cpus: 1, memoryMiB: 100, nodes: 1, gpus: { total: 0, byType: {} }, gpuPresent: true },
          }),
        ],
      }),
      assoc: {
        store: buildAssociationStore([
          assocEntry({ id: '1', parentId: null, account: 'root' }),
          assocEntry({ id: '2', parentId: '1', account: 'research', parentAccount: 'root', grpTres: { cpu: null, memMiB: null, node: null, gres: { 'gpu:a100': 4 } } }),
          assocEntry({ id: '9', parentId: '2', account: 'research', user: 'alice' }),
        ]),
        capturedAt: new Date(),
      },
    });
    expect(result?.used).toBe(0);
    expect(result?.requested).toBe(1);
  });
});

describe('single-node unknown-mode memory coverage', () => {
  test('single-node ReqTRES memory evaluates despite unknown mode', async () => {
    const pending = makeJob({
      id: '350', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: 2, memoryMiB: 8192, nodes: 1, gpus: { total: 0, byType: {} } },
    });
    const fit = makeCtx(pending, { memory: { kind: 'unknown', memoryMiB: 8192 } });
    expect((await analyzeResources(fit))?.nodes[0]?.status).toBe('sufficient');
    const short = makeCtx(
      { ...pending, requested: { cpus: 2, memoryMiB: 200000, nodes: 1, gpus: { total: 0, byType: {} } } },
      { memory: { kind: 'unknown', memoryMiB: 200000 } }
    );
    expect((await analyzeResources(short))?.nodes[0]?.status).toBe('insufficient');
  });

  test('multi-node unknown-mode memory stays unknown', async () => {
    const pending = makeJob({
      id: '351', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: null, memoryMiB: 65536, nodes: 4, gpus: { total: 0, byType: {} } },
    });
    await expect(
      analyzeResources(makeCtx(pending, { memory: { kind: 'unknown', memoryMiB: 65536 } }))
    ).resolves.toBeNull();
  });
});

describe('strict policy TRES parsing', () => {
  test('valid forms parse; malformed values fail the snapshot', () => {
    expect(parsePolicyTresLimit('cpu=12', 'GrpTRES')).toMatchObject({ cpu: 12 });
    expect(parsePolicyTresLimit('mem=64G', 'GrpTRES')).toMatchObject({ memMiB: 65536 });
    expect(parsePolicyTresLimit('node=4', 'GrpTRES')).toMatchObject({ node: 4 });
    expect(parsePolicyTresLimit('gres/gpu=2', 'GrpTRES')).toMatchObject({ gres: { gpu: 2 } });
    expect(parsePolicyTresLimit('gres/gpu:a100=1', 'GrpTRES')).toMatchObject({ gres: { 'gpu:a100': 1 } });
    expect(
      parsePolicyTresLimit('cpu=12,mem=64G,node=4,gres/gpu:a100=1', 'GrpTRES')
    ).toMatchObject({ cpu: 12, memMiB: 65536, node: 4, gres: { 'gpu:a100': 1 } });
    expect(parsePolicyTresLimit('', 'GrpTRES')).toMatchObject({ cpu: null, memMiB: null });
    expect(parsePolicyTresLimit('N/A', 'GrpTRES')).toMatchObject({ cpu: null });
    expect(() => parsePolicyTresLimit('cpu=garbage', 'GrpTRES')).toThrow();
    expect(() => parsePolicyTresLimit('mem=nope', 'GrpTRES')).toThrow();
    expect(() => parsePolicyTresLimit('gres/gpu:a100=wat', 'GrpTRES')).toThrow();
    expect(() => parsePolicyTresLimit('cpu=12,,mem', 'GrpTRES')).toThrow();
    expect(() => parsePolicyTresLimit('cpu=1.5', 'GrpTRES')).toThrow();
  });
});

describe('association ID sentinels', () => {
  test('ID requires a positive integer; ParentID accepts root sentinels', () => {
    expect(normalizeAssociationId('42')).toBe('42');
    expect(() => normalizeAssociationId('')).toThrow();
    expect(() => normalizeAssociationId('0')).toThrow();
    expect(() => normalizeAssociationId('-1')).toThrow();
    expect(() => normalizeAssociationId('abc')).toThrow();
    expect(normalizeParentAssociationId('42')).toBe('42');
    expect(normalizeParentAssociationId('')).toBeNull();
    expect(normalizeParentAssociationId('0')).toBeNull();
    expect(normalizeParentAssociationId('-1')).toBeNull();
    expect(() => normalizeParentAssociationId('abc')).toThrow();
  });

  test('ParentID=0 terminates at the root without phantom lookup', () => {
    const header = 'ID|ParentID|Cluster|Account|User|Partition|ParentName|GrpTRES|GrpTRESRunMins|GrpJobs|MaxJobs';
    const store = buildAssociationStore(
      parseAssocStdout(`${header}\n7|0|c|root|||||||\n8|7|c|child|||root||||`)
    );
    expect(store.byId.get('7')?.parentId).toBeNull();
    const start = store.byId.get('8') as AssociationEntry;
    expect(ancestorChainById(store, start).map((entry) => entry.account)).toEqual(['child', 'root']);
  });
});

describe('duplicate QOS names fail', () => {
  test('one snapshot with two same-named QOS rows is upstream-invalid', () => {
    expect(() => buildQosStore([emptyQosEntry('dup'), emptyQosEntry('dup')])).toThrow();
  });
});

describe('missing QOS policy propagates uncertainty', () => {
  test('no store or missing entry makes run-minute usage unknown', () => {
    const jobs = [makeJob({ id: '360', qos: 'normal' })];
    const now = new Date('2026-01-01T00:30:00Z');
    const withoutStore = sumRunMinutes(jobs, now, null, () => true, (job) => job.allocated.cpus);
    expect(withoutStore.unknown).toBe(1);
    expect(withoutStore.total).toBe(0);
    const store = buildQosStore([emptyQosEntry('other')]);
    const missingEntry = sumRunMinutes(jobs, now, store, () => true, (job) => job.allocated.cpus);
    expect(missingEntry.unknown).toBe(1);
    const known = buildQosStore([{ ...emptyQosEntry('normal') }]);
    const exact = sumRunMinutes(jobs, now, known, () => true, (job) => job.allocated.cpus);
    expect(exact.unknown).toBe(0);
    expect(exact.total).toBeCloseTo(120, 0);
  });
});

describe('bare array-job dependencies apply to the whole array', () => {
  function arrayTask(arrayId: string, taskId: string, partial: Partial<Job> = {}): Job {
    return makeJob({
      id: `${arrayId}_${taskId}`, jobId: arrayId, arrayJobId: arrayId, arrayTaskId: taskId,
      state: 'COMPLETED', exitCode: '0',
      ...partial,
    });
  }

  // Pin taskCount (ntasks) to verify it is not treated as array cardinality.
  function arrayMaster(arrayId: string): Job {
    return makeJob({
      id: arrayId, jobId: arrayId, arrayJobId: arrayId, state: 'PENDING',
      taskCount: 2, dependency: null,
    });
  }

  function bareCtx(dependency: string, jobs: Job[]): AnalyzerContext {
    const pending = makeJob({ id: '500', state: 'PENDING', stateReason: 'Dependency', dependency });
    return {
      ...makeCtx(pending, { jobs }),
      targeted: {
        job: pending, schedNodeList: null, reqNodeList: null, arrayThrottle: null,
        memory: { kind: 'unknown', memoryMiB: null }, minMemoryMiB: null, requestedNodes: 1, capturedAt: new Date(),
      },
    };
  }

  test('ordinary non-array afterok keeps scalar semantics', async () => {
    const result = await analyzeDependency(bareCtx(
      'afterok:501',
      [makeJob({ id: '501', state: 'COMPLETED', exitCode: '0' })]
    ));
    expect(result?.status).toBe('satisfied');
  });

  test('bare after is order-independent: any definite block wins', async () => {
    const delayed = (id: string, task: string, partial: Partial<Job>): Job =>
      arrayTask(id, task, { state: 'RUNNING', startTime: new Date(), ...partial });
    const unknownFirst = await analyzeDependency(bareCtx(
      'after:550+5',
      [delayed('550', '1', { startTime: null }), arrayTask('550', '2', { state: 'PENDING', startTime: null })]
    ));
    expect(unknownFirst?.status).toBe('unsatisfied');
    const unsatisfiedFirst = await analyzeDependency(bareCtx(
      'after:551+5',
      [arrayTask('551', '1', { state: 'PENDING', startTime: null }), delayed('551', '2', { startTime: null })]
    ));
    expect(unsatisfiedFirst?.status).toBe('unsatisfied');
    const unproven = await analyzeDependency(bareCtx(
      'after:552+5',
      [delayed('552', '1', { startTime: new Date(Date.now() - 10 * 60_000) }), delayed('552', '2', { startTime: null })]
    ));
    expect(unproven?.status).toBe('unknown');
  });

  test('bare afterany: live task blocks; all-terminal observed is unknown', async () => {
    const blocked = await analyzeDependency(bareCtx(
      'afterany:520',
      [arrayTask('520', '1', { state: 'COMPLETED', exitCode: '0' }), arrayTask('520', '2', { state: 'RUNNING' })]
    ));
    expect(blocked?.status).toBe('unsatisfied');
    const unproven = await analyzeDependency(bareCtx(
      'afterany:521',
      [arrayTask('521', '1', { state: 'COMPLETED', exitCode: '0' })]
    ));
    expect(unproven?.status).toBe('unknown');
    const ntasksMatch = await analyzeDependency(bareCtx(
      'afterany:522',
      [arrayMaster('522'), arrayTask('522', '1', { state: 'COMPLETED', exitCode: '0' }), arrayTask('522', '2', { state: 'FAILED', exitCode: '1' })]
    ));
    expect(ntasksMatch?.status).toBe('unknown');
  });

  test('bare afterok: failed task disproves; clean observed is unknown', async () => {
    const failed = await analyzeDependency(bareCtx(
      'afterok:530',
      [arrayTask('530', '1', { state: 'COMPLETED', exitCode: '0' }), arrayTask('530', '2', { state: 'FAILED', exitCode: '1' })]
    ));
    expect(failed?.status).toBe('unsatisfied');
    const unproven = await analyzeDependency(bareCtx(
      'afterok:531',
      [arrayTask('531', '1', { state: 'COMPLETED', exitCode: '0' })]
    ));
    expect(unproven?.status).toBe('unknown');
    const cleanMatch = await analyzeDependency(bareCtx(
      'afterok:532',
      [arrayMaster('532'), arrayTask('532', '1', { state: 'COMPLETED', exitCode: '0' }), arrayTask('532', '2', { state: 'COMPLETED', exitCode: '0' })]
    ));
    expect(cleanMatch?.status).toBe('unknown');
  });

  test('bare afternotok prioritizes live evidence over observed failure', async () => {
    const failedPlusLive = await analyzeDependency(bareCtx(
      'afternotok:540',
      [arrayTask('540', '1', { state: 'FAILED', exitCode: '1' }), arrayTask('540', '2', { state: 'RUNNING' })]
    ));
    expect(failedPlusLive?.status).toBe('unsatisfied');
    const failureComplete = await analyzeDependency(bareCtx(
      'afternotok:541',
      [arrayMaster('541'), arrayTask('541', '1', { state: 'FAILED', exitCode: '1' }), arrayTask('541', '2', { state: 'COMPLETED', exitCode: '0' })]
    ));
    expect(failureComplete?.status).toBe('unknown');
    const liveNoFailure = await analyzeDependency(bareCtx(
      'afternotok:542',
      [arrayTask('542', '1', { state: 'COMPLETED', exitCode: '0' }), arrayTask('542', '2', { state: 'RUNNING' })]
    ));
    expect(liveNoFailure?.status).toBe('unsatisfied');
    const cleanObserved = await analyzeDependency(bareCtx(
      'afternotok:543',
      [arrayMaster('543'), arrayTask('543', '1', { state: 'COMPLETED', exitCode: '0' })]
    ));
    expect(cleanObserved?.status).toBe('unknown');
    const unknownExit = await analyzeDependency(bareCtx(
      'afternotok:544',
      [arrayTask('544', '1', { state: 'COMPLETED', exitCode: null })]
    ));
    expect(unknownExit?.status).toBe('unknown');
  });
});

describe('strict LimitFactor parsing', () => {
  const header = 'Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags';
  const row = (factor: string): string => `${header}\nq|0|||||||||${factor}||`;

  test('unset, -1, valid, decimal, and zero factors', () => {
    expect(parseQosStdout(`${header}\nq|0|||||||||||`).find((r) => r.name === 'q')?.limitFactor).toBeNull();
    expect(parseQosStdout(row('-1')).find((r) => r.name === 'q')?.limitFactor).toBeNull();
    expect(parseQosStdout(row('1')).find((r) => r.name === 'q')?.limitFactor).toBe(1);
    expect(parseQosStdout(row('2')).find((r) => r.name === 'q')?.limitFactor).toBe(2);
    expect(parseQosStdout(row('1.5')).find((r) => r.name === 'q')?.limitFactor).toBe(1.5);
    expect(parseQosStdout(row('0')).find((r) => r.name === 'q')?.limitFactor).toBe(0);
  });

  test('malformed factors fail the snapshot', () => {
    for (const bad of ['garbage', 'NaN', '1.2.3', 'abc', '-0.5', '1,5']) {
      expect(() => parseQosStdout(row(bad))).toThrow();
    }
  });
});

describe('LimitFactor zero application and updatedAt paths', () => {
  test('zero factor leaves the raw limit unscaled', () => {
    expect(effectiveAssocTresLimit(30, 0)).toEqual({ rawLimit: 30, effectiveLimit: 30, factored: false });
    expect(effectiveAssocTresLimit(30, 2)).toEqual({ rawLimit: 30, effectiveLimit: 60, factored: true });
    expect(effectiveAssocTresLimit(30, null).factored).toBe(false);
  });
});

describe('Resources memory-request detection from memory modes', () => {
  test('memory-only job with MinMemoryNode receives Resources analysis', async () => {
    const pending = makeJob({
      id: '900', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: null, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
    });
    const ctx = makeCtx(pending, { memory: { kind: 'perNode', memoryMiB: 100000 } });
    const result = await analyzeResources(ctx);
    expect(result?.insufficientNodes).toBe(1);
    expect(result?.nodes[0]?.shortages).toEqual([
      { resource: 'memoryMiB', requested: 100000, currentlyUnallocated: 16384 },
    ]);
  });

  test('ReqTRES memory absent with MinMemoryCPU still evaluates', async () => {
    const pending = makeJob({
      id: '901', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: 4, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
    });
    const ctx = makeCtx(pending, { memory: { kind: 'perCpu', memoryMiB: 5000 } });
    const result = await analyzeResources(ctx);
    expect(result?.nodes[0]?.shortages).toEqual([
      { resource: 'memoryMiB', requested: 20000, currentlyUnallocated: 16384 },
    ]);
  });

  test('ReqTRES memory absent with MinMemoryPerGPU still evaluates', async () => {
    const pending = makeJob({
      id: '902', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: null, memoryMiB: null, nodes: 1, gpus: { total: 2, byType: {} } },
    });
    const ctx = makeCtx(pending, {
      memory: { kind: 'perGpu', memoryMiB: 9000 },
      nodes: [makeNode({ name: 'node01', gpu: { total: 4, allocated: 0, byType: {} } })],
    });
    const result = await analyzeResources(ctx);
    expect(result?.nodes[0]?.shortages).toEqual([
      { resource: 'memoryMiB', requested: 18000, currentlyUnallocated: 16384 },
    ]);
  });

  test('multi-node perCpu without placement stays unknown, not sufficient', async () => {
    const pending = makeJob({
      id: '903', state: 'PENDING', stateReason: 'Resources',
      requested: { cpus: 8, memoryMiB: null, nodes: 2, gpus: { total: 0, byType: {} } },
    });
    const single = makeCtx(pending, {
      memory: { kind: 'perCpu', memoryMiB: 1000 },
      nodes: [makeNode({ name: 'node01' })],
    });
    await expect(analyzeResources(single)).resolves.toBeNull();
  });
});
