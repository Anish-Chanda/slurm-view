import { normalizeJob } from '../../../src/server/adapters/slurm/jobs.js';
import { CommandError } from '../../../src/server/adapters/slurm/command-runner.js';
import { ProblemCode, ProblemDefinitions } from '../../../src/shared/api/v1/common.js';
import {
  ancestorChainById,
  applyLimitFactor,
  appliesLimitFactor,
  buildAssociationStore,
  descendantAssociationIds,
  resolveAssociation,
} from '../../../src/server/models/association.js';
import type { AssociationEntry } from '../../../src/server/models/association.js';
import { buildQosStore, emptyQosEntry, isRelativeQos } from '../../../src/server/models/qos.js';
import { expandSlurmHostlist } from '../../../src/server/adapters/slurm/hostlist.js';
import { parseDependency } from '../../../src/server/services/pending-analysis/dependency-parser.js';
import { selectAnalyzer } from '../../../src/server/services/pending-analysis/registry.js';
import {
  calculateAssociationGroupRunMinutes,
  calculateAssociationGroupUsage,
  calculateQosGroupUsage,
  calculateQosUserUsage,
  sumRunMinutes,
  usageFactorFor,
} from '../../../src/server/services/pending-analysis/usage.js';
import { effectiveAssocTresLimit } from '../../../src/server/services/pending-analysis/policy.js';
import { analyzeDependency } from '../../../src/server/services/pending-analysis/analyzers/dependency.js';
import { analyzeQosLimits } from '../../../src/server/services/pending-analysis/analyzers/qos-limits.js';
import { analyzeResources } from '../../../src/server/services/pending-analysis/analyzers/resources.js';
import { createJobSnapshot } from '../../../src/server/cache/jobs-cache.js';
import { createNodeSnapshot } from '../../../src/server/cache/nodes-cache.js';
import type { Job } from '../../../src/server/models/job.js';
import type { AnalyzerContext } from '../../../src/server/services/pending-analysis/types.js';

function makeJob(partial: Partial<Job> & { id: string }): Job {
  return {
    jobId: partial.id,
    arrayJobId: null,
    arrayTaskId: null,
    partition: 'debug',
    name: 'job',
    user: 'alice',
    account: 'organization-a',
    qos: 'normal',
    state: 'RUNNING',
    stateFlags: [],
    stateReason: null,
    timeLimit: { kind: 'finite', seconds: 3600 },
    submitTime: null,
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

describe('association hierarchy via ID/ParentID', () => {
  test('walks ParentID links, not names', () => {
    const store = buildAssociationStore([
      assocEntry({ id: '1', parentId: '2', account: 'leaf' }),
      // Misleading ParentName on purpose; traversal must ignore it.
      assocEntry({ id: '2', parentId: '3', account: 'mid', parentAccount: 'wrong-name' }),
      assocEntry({ id: '3', parentId: null, account: 'root' }),
    ]);
    const start = resolveAssociation(store, { account: 'leaf', user: null, partition: null });
    expect(start?.account).toBe('leaf');
    expect(ancestorChainById(store, start!).map((entry) => entry.account)).toEqual([
      'leaf',
      'mid',
      'root',
    ]);
  });

  test('cycles and missing parents fail instead of truncating', () => {
    const store = buildAssociationStore([
      assocEntry({ id: '1', parentId: '1', account: 'self' }),
      assocEntry({ id: '9', parentId: 'missing', account: 'orphan' }),
    ]);
    const self = resolveAssociation(store, { account: 'self', user: null, partition: null });
    expect(() => ancestorChainById(store, self!)).toThrow();
    const orphan = resolveAssociation(store, { account: 'orphan', user: null, partition: null });
    expect(() => ancestorChainById(store, orphan!)).toThrow();
  });

  test('descendant IDs invert ParentID links without merging scopes', () => {
    const store = buildAssociationStore([
      assocEntry({ id: '1', parentId: null, account: 'root' }),
      assocEntry({ id: '2', parentId: '1', account: 'child' }),
      assocEntry({ id: '3', parentId: '2', account: 'child', user: 'bob' }),
    ]);
    expect(descendantAssociationIds(store, '1')).toEqual(new Set(['1', '2', '3']));
    expect(descendantAssociationIds(store, '2')).toEqual(new Set(['2', '3']));
    expect(descendantAssociationIds(store, null)).toBeNull();
  });
});

describe('LimitFactor definitive rule', () => {
  test('scales association TRES limits by the job QOS factor', () => {
    expect(effectiveAssocTresLimit(30, 2)).toEqual({ rawLimit: 30, effectiveLimit: 60, factored: true });
    expect(effectiveAssocTresLimit(30, null)).toEqual({ rawLimit: 30, effectiveLimit: 30, factored: false });
    expect(effectiveAssocTresLimit(null, 2).effectiveLimit).toBeNull();
  });

  test('helper marks only TRES metrics as factorable', () => {
    expect(appliesLimitFactor('tres')).toBe(true);
    expect(appliesLimitFactor('other')).toBe(false);
    expect(applyLimitFactor(30, 2)).toBe(60);
    expect(applyLimitFactor(null, 2)).toBeNull();
  });
});

describe('run-minute UsageFactor', () => {
  const qosStore = buildQosStore([
    { ...emptyQosEntry('normal'), usageFactor: 1 },
    { ...emptyQosEntry('premium'), usageFactor: 2 },
  ]);
  const now = new Date('2026-01-01T00:30:00Z');
  const base = {
    state: 'RUNNING' as const,
    timeLimit: { kind: 'finite' as const, seconds: 3600 },
    startTime: new Date('2026-01-01T00:00:00Z'),
  };

  test('factor 1 leaves contributions unchanged', () => {
    const jobs = [makeJob({ id: '1', qos: 'normal', allocated: { cpus: 2, memoryMiB: 1024, nodes: 1, gpus: { total: 0, byType: {} } }, ...base })];
    const sum = sumRunMinutes(jobs, now, qosStore, () => true, (job) => job.allocated.cpus);
    expect(sum.total).toBeCloseTo(60, 0);
    expect(sum.unknown).toBe(0);
  });

  test('different contributing jobs scale by their own job QOS', () => {
    const jobs = [
      makeJob({ id: '1', qos: 'normal', allocated: { cpus: 2, memoryMiB: 1024, nodes: 1, gpus: { total: 0, byType: {} } }, ...base }),
      makeJob({ id: '2', qos: 'premium', allocated: { cpus: 2, memoryMiB: 1024, nodes: 1, gpus: { total: 0, byType: {} } }, ...base }),
    ];
    const sum = sumRunMinutes(jobs, now, qosStore, () => true, (job) => job.allocated.cpus);
    expect(sum.total).toBeCloseTo(180, 0);
  });

  test('UNLIMITED jobs are counted, not silently absorbed', () => {
    const jobs = [
      makeJob({ id: '9', qos: 'normal', state: 'RUNNING', startTime: new Date('2026-01-01T00:00:00Z'), timeLimit: { kind: 'infinite' } }),
    ];
    const sum = sumRunMinutes(jobs, now, qosStore, () => true, (job) => job.allocated.cpus);
    expect(sum.total).toBe(0);
    expect(sum.unknown).toBe(1);
  });
});

describe('usage scopes stay explicit', () => {
  const jobs = [
    makeJob({ id: '1', account: 'organization-a', user: 'alice', qos: 'normal', state: 'RUNNING' }),
    makeJob({ id: '2', account: 'other', user: 'bob', qos: 'normal', state: 'RUNNING' }),
    makeJob({ id: '3', account: 'organization-a', user: 'alice', qos: 'normal', state: 'PENDING' }),
  ];

  test('QOS group is QOS-global, never account-scoped', () => {
    const scoped = calculateQosGroupUsage('normal', { jobs }, () => 1);
    expect(scoped.total).toBe(2);
    expect(scoped.runningJobs).toBe(2);
  });

  test('association group respects descendants and RUNNING only', () => {
    const grouped = calculateAssociationGroupUsage('organization-a', new Set(['organization-a']), { jobs }, () => 1);
    expect(grouped.total).toBe(1);
    const userScoped = calculateQosUserUsage('normal', 'bob', { jobs }, () => 1);
    expect(userScoped.total).toBe(1);
  });
});

describe('Relative QOS guard', () => {
  test('relative QOS declines numeric analysis', async () => {
    expect(isRelativeQos({ ...emptyQosEntry('pct'), relative: true })).toBe(true);
    const pending = makeJob({
      id: '50',
      state: 'PENDING',
      stateReason: 'QOSGrpCpuLimit',
      qos: 'pct',
      requested: { cpus: 8, memoryMiB: null, nodes: 1, gpus: { total: 0, byType: {} } },
    });
    const ctx: AnalyzerContext = {
      jobId: '50',
      slurmContext: { parser: 'v0.0.45', run: jest.fn() },
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
      job: pending,
      jobsSnapshot: createJobSnapshot([pending]),
      nodesSnapshot: null,
      assoc: null,
      qos: { store: buildQosStore([{ ...emptyQosEntry('pct'), relative: true, grpTres: { cpu: 20, memMiB: null, node: null, gres: {} } }]), capturedAt: new Date() },
      sprioWeights: null,
      partitionDetail: null,
      partitionQosName: null,
      partitionTable: null,
    };
    await expect(analyzeQosLimits(ctx)).resolves.toBeNull();
  });
});

describe('dependency parse/evaluate split', () => {
  test('OR groups flatten per job id', () => {
    const parsed = parseDependency('afterok:20:21?afterany:23');
    expect(parsed?.operator).toBe('or');
    expect(parsed?.clauses).toHaveLength(3);
  });

  test('delays, wildcards, markers and array elements survive parsing', () => {
    const parsed = parseDependency('after:10+60,afterany:11_*,afterok:12_4,afterok:13(unfulfilled)');
    expect(parsed?.operator).toBe('and');
    expect(parsed?.clauses[0]?.jobs[0]).toMatchObject({ jobId: '10', delayMinutes: 60 });
    expect(parsed?.clauses[1]?.jobs[0]).toMatchObject({ jobId: '11', arrayWildcard: true });
    expect(parsed?.clauses[2]?.jobs[0]).toMatchObject({ jobId: '12', arrayTaskId: '4' });
    expect(parsed?.clauses[3]?.jobs[0]).toMatchObject({ jobId: '13', statusMarker: 'unfulfilled' });
  });

  test('mixed separators are rejected, not guessed', () => {
    expect(parseDependency('afterok:1,afterany:2?afterok:3')).toBeNull();
  });

  test('afterburstbuffer without stage-out evidence is unknown', async () => {
    const pending = makeJob({
      id: '60',
      state: 'PENDING',
      stateReason: 'Dependency',
      dependency: 'afterburstbuffer:61',
    });
    const done = makeJob({ id: '61', state: 'COMPLETED', exitCode: '0' });
    const ctx: AnalyzerContext = {
      jobId: '60',
      slurmContext: {
        parser: 'v0.0.45',
        run: jest.fn().mockImplementation(async (_exe: string, args: readonly string[]) => {
          const id = String(args[args.length - 1] ?? '');
          throw new CommandError({ kind: 'non-zero-exit', executable: 'scontrol', args: [...args], exitCode: 1, stderrSnippet: `scontrol: Invalid job id specified: ${id}`, message: 'exit 1' });
        }),
      },
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
      job: pending,
      jobsSnapshot: createJobSnapshot([pending, done]),
      nodesSnapshot: null,
      assoc: null,
      qos: null,
      sprioWeights: null,
      partitionDetail: null,
      partitionQosName: null,
      partitionTable: null,
    };
    const result = await analyzeDependency(ctx);
    expect(result?.status).toBe('unknown');
  });

  test('missing dependency target is unknown, not failure', async () => {
    const pending = makeJob({
      id: '70',
      state: 'PENDING',
      stateReason: 'Dependency',
      dependency: 'afterok:99999',
    });
    const ctx: AnalyzerContext = {
      jobId: '70',
      slurmContext: {
        parser: 'v0.0.45',
        run: jest.fn().mockImplementation(async (_exe: string, args: readonly string[]) => {
          const id = String(args[args.length - 1] ?? '');
          throw new CommandError({ kind: 'non-zero-exit', executable: 'scontrol', args: [...args], exitCode: 1, stderrSnippet: `scontrol: Invalid job id specified: ${id}`, message: 'exit 1' });
        }),
      },
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
      job: pending,
      jobsSnapshot: createJobSnapshot([pending]),
      nodesSnapshot: null,
      assoc: null,
      qos: null,
      sprioWeights: null,
      partitionDetail: null,
      partitionQosName: null,
      partitionTable: null,
    };
    const result = await analyzeDependency(ctx);
    expect(result?.dependencies[0]?.jobs[0]?.status).toBe('unknown');
    expect(result?.dependencies[0]?.jobs[0]?.state).toBeNull();
  });
});

describe('resource-fit terminology', () => {
  test('shortages use memoryMiB/currentlyUnallocated, never bare memory/available', async () => {
    const pending = makeJob({
      id: '80',
      state: 'PENDING',
      stateReason: 'Resources',
      partition: 'debug',
      requested: { cpus: 64, memoryMiB: 1_000_000, nodes: 1, gpus: { total: 0, byType: {} } },
    });
    const node = {
      name: 'node01',
      partitions: ['debug'],
      state: 'IDLE' as const,
      stateFlags: [] as string[],
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
    };
    const ctx: AnalyzerContext = {
      jobId: '80',
      slurmContext: { parser: 'v0.0.45' },
      targeted: {
        job: pending,
        schedNodeList: null,
        reqNodeList: null,
        arrayThrottle: null,
        memory: { kind: 'perNode', memoryMiB: 1_000_000 },
        minMemoryMiB: 1_000_000,
        requestedNodes: 1,
        capturedAt: new Date(),
      },
      job: pending,
      jobsSnapshot: createJobSnapshot([pending]),
      nodesSnapshot: createNodeSnapshot([node]),
      assoc: null,
      qos: null,
      sprioWeights: null,
      partitionDetail: null,
      partitionQosName: null,
      partitionTable: null,
    };
    const result = await analyzeResources(ctx);
    expect(result?.scope).toBe('partition');
    const shortages = result?.nodes[0]?.shortages ?? [];
    expect(shortages.length).toBeGreaterThan(0);
    for (const shortage of shortages) {
      expect(['cpus', 'memoryMiB', 'gpus']).toContain(shortage.resource);
      expect(shortage).toHaveProperty('currentlyUnallocated');
      expect(shortage).not.toHaveProperty('available');
    }
    expect(shortages.some((shortage) => shortage.resource === 'memoryMiB')).toBe(true);
  });

  test('hostlist brackets expand instead of splitting', () => {
    expect(expandSlurmHostlist('node[01-03]')).toEqual(['node01', 'node02', 'node03']);
  });
});

describe('registry and problem code', () => {
  test('reason inventory maps families, simple/unknown reasons stay null', () => {
    expect(selectAnalyzer('Resources')).toBeDefined();
    expect(selectAnalyzer('DependencyNeverSatisfied')).toBe(selectAnalyzer('Dependency'));
    expect(selectAnalyzer('AssocGrpCpuLimit')).toBe(selectAnalyzer('AssocGrpMemLimit'));
    expect(selectAnalyzer('BeginTime')).toBeNull();
    expect(selectAnalyzer('JobHeldUser')).toBeNull();
    expect(selectAnalyzer('InvalidQOS')).toBeNull();
    expect(selectAnalyzer('Licenses')).toBeNull();
    expect(selectAnalyzer(null)).toBeNull();
  });

  test('JOB_NOT_PENDING is a 409 problem code', () => {
    expect(ProblemCode.JobNotPending).toBe('JOB_NOT_PENDING');
    expect(ProblemDefinitions[ProblemCode.JobNotPending]).toMatchObject({
      status: 409,
      type: 'urn:slurm-view:problem:job-not-pending',
    });
  });

  test('no cluster semantics leak into normalized jobs', () => {
    const job = normalizeJob({
      job_id: 1,
      partition: 'debug',
      user_name: 'alice',
      account: 'organization-a',
      job_state: ['PENDING'],
    } as never);
    expect(job).not.toHaveProperty('cluster');
  });
});

describe('UsageFactor for jobs without a Job QOS', () => {
  const store = buildQosStore([
    { ...emptyQosEntry('normal') },
    { ...emptyQosEntry('zeroed'), usageFactor: 0 },
    { ...emptyQosEntry('doubled'), usageFactor: 2 },
  ]);
  const now = new Date('2026-01-01T00:30:00Z');
  const base = {
    state: 'RUNNING' as const,
    timeLimit: { kind: 'finite' as const, seconds: 3600 },
    startTime: new Date('2026-01-01T00:00:00Z'),
  };

  test('qos:null means no factor applies: neutral 1, even without a store', () => {
    expect(usageFactorFor(null, makeJob({ id: '1', qos: null }))).toBe(1);
    expect(usageFactorFor(undefined, makeJob({ id: '1', qos: null }))).toBe(1);
    expect(usageFactorFor(store, makeJob({ id: '1', qos: null }))).toBe(1);
  });

  test('existing named QOS resolves its configured factor', () => {
    expect(usageFactorFor(store, makeJob({ id: '1', qos: 'normal' }))).toBe(1);
    expect(usageFactorFor(store, makeJob({ id: '1', qos: 'zeroed' }))).toBe(0);
    expect(usageFactorFor(store, makeJob({ id: '1', qos: 'doubled' }))).toBe(2);
  });

  test('named QOS missing from the snapshot, or no snapshot, stays unknown', () => {
    expect(usageFactorFor(store, makeJob({ id: '1', qos: 'absent' }))).toBeNull();
    expect(usageFactorFor(null, makeJob({ id: '1', qos: 'normal' }))).toBeNull();
    expect(usageFactorFor(undefined, makeJob({ id: '1', qos: 'normal' }))).toBeNull();
  });

  test('association run minutes count a qos:null job unscaled, not unknown', () => {
    const jobs = [
      makeJob({ id: '1', qos: null, allocated: { cpus: 4, memoryMiB: 1024, nodes: 1, gpus: { total: 0, byType: {} } }, ...base }),
    ];
    const sum = calculateAssociationGroupRunMinutes('organization-a', null, 'cpu', { jobs, now, qosStore: store });
    expect(sum.total).toBeCloseTo(120, 0);
    expect(sum.unknown).toBe(0);
    expect(sum.runningJobs).toBe(1);
  });
});
