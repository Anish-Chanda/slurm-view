import request from 'supertest';
import { createApp } from '../../../src/server/app.js';
import { JobsCache } from '../../../src/server/cache/jobs-cache.js';
import { NodesCache } from '../../../src/server/cache/nodes-cache.js';
import { AssocCache } from '../../../src/server/cache/assoc-cache.js';
import { QosCache } from '../../../src/server/cache/qos-cache.js';
import { SprioWeightsCache } from '../../../src/server/cache/sprio-weights-cache.js';
import type { SlurmRunFn } from '../../../src/server/adapters/slurm/context.js';
import { CommandError } from '../../../src/server/adapters/slurm/command-runner.js';
import { clearContradictionCooldownForTests } from '../../../src/server/services/pending-analysis/contradiction-cooldown.js';

const PARSER = 'v0.0.45' as const;

function squeueJob(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    job_id: 1,
    partition: 'debug',
    name: 'job',
    user_name: 'alice',
    account: 'research',
    qos: 'normal',
    job_state: ['PENDING'],
    state_reason: 'Resources',
    tres_req_str: 'cpu=4,mem=8192M,node=1',
    tres_alloc_str: '',
    ...partial,
  };
}

function jobsEnvelope(jobs: Array<Record<string, unknown>>): string {
  return JSON.stringify({ errors: [], warnings: [], jobs });
}

function targetedEnvelope(job: Record<string, unknown>): string {
  return JSON.stringify({ errors: [], warnings: [], jobs: [job] });
}

interface FakeSlurm {
  targeted?: string;
  squeue?: string;
  nodes?: string;
  partitionDetail?: string;
  reservationText?: string;
  sprio?: string;
  sprioN?: string;
  weights?: string;
  assocTexts?: string[];
  qosText?: string;
  calls?: { sacctmgr: number };
}

function fakeRun(fake: FakeSlurm): SlurmRunFn {
  const calls = (fake.calls ??= { sacctmgr: 0 });
  return jest.fn(async (executable: string, args: readonly string[]) => {
    const argv = args.join(' ');
    if (executable === 'squeue') {
      return { stdout: fake.squeue ?? jobsEnvelope([]), stderr: '' };
    }
    if (executable === 'scontrol' && argv.includes('show config')) {
      return { stdout: 'ClusterName=nova\n', stderr: '' };
    }
    if (executable === 'scontrol' && argv.includes('show job')) {
      if (fake.targeted === undefined) {
        throw new Error('no targeted fixture');
      }
      return { stdout: fake.targeted, stderr: '' };
    }
    if (executable === 'scontrol' && argv.includes('show node')) {
      return { stdout: fake.nodes ?? JSON.stringify({ errors: [], nodes: [] }), stderr: '' };
    }
    if (executable === 'scontrol' && argv.includes('show partition')) {
      return { stdout: fake.partitionDetail ?? JSON.stringify({ errors: [], partitions: [] }), stderr: '' };
    }
    if (executable === 'scontrol' && argv.includes('show reservation')) {
      return { stdout: fake.reservationText ?? 'ReservationName=resv State=ACTIVE StartTime=2026-05-01T10:00:00 EndTime=2026-05-01T12:00:00', stderr: '' };
    }
    if (executable === 'sprio' && argv.includes('-w')) {
      return { stdout: fake.weights ?? 'JOBID PRIORITY AGE\nWeights 0 0 1000', stderr: '' };
    }
    if (executable === 'sprio' && argv.includes('-n')) {
      return { stdout: fake.sprioN ?? 'JOBID PRIORITY AGE\n42 100 0.5', stderr: '' };
    }
    if (executable === 'sprio') {
      return { stdout: fake.sprio ?? 'JOBID PRIORITY AGE\n42 100 50', stderr: '' };
    }
    if (executable === 'sacctmgr' && argv.includes('assoc')) {
      const texts = fake.assocTexts ?? [];
      const stdout = texts[Math.min(calls.sacctmgr, texts.length - 1)] ?? texts[0] ?? '';
      calls.sacctmgr += 1;
      return { stdout, stderr: '' };
    }
    if (executable === 'sacctmgr' && argv.includes('qos')) {
      return { stdout: fake.qosText ?? '', stderr: '' };
    }
    throw new Error(`unexpected Slurm call: ${executable} ${argv}`);
  });
}

function buildApp(fake: FakeSlurm) {
  const run = fakeRun(fake);
  const ctx = { parser: PARSER, run };
  const jobsCache = new JobsCache(ctx);
  const nodesCache = new NodesCache(ctx);
  const assocCache = new AssocCache(ctx);
  const qosCache = new QosCache(ctx);
  const sprioWeightsCache = new SprioWeightsCache(ctx);
  const app = createApp({
    jobsCache,
    nodesCache,
    pendingAnalysis: {
      slurmContext: ctx,
      jobsCache,
      nodesCache,
      assocCache,
      qosCache,
      sprioWeightsCache,
    },
  });
  return app;
}

const NODES_ENVELOPE = JSON.stringify({
  errors: [],
  nodes: [
    {
      name: 'node01',
      state: 'IDLE',
      partitions: ['debug'],
      cpus: 8,
      effective_cpus: 8,
      alloc_cpus: 0,
      real_memory: 16384,
      alloc_memory: 0,
    },
  ],
});

const PARTITION_ENVELOPE = JSON.stringify({
  errors: [],
  partitions: [{ name: 'debug', state: 'UP', max_time: '60', max_nodes: 10, total_nodes: 12, qos: 'normal' }],
});

describe('GET /api/v1/jobs/:id/pending-analysis contract', () => {
  beforeEach(() => {
    clearContradictionCooldownForTests();
  });
  test('non-canonical ID becomes 400 without touching Slurm', async () => {
    const fake: FakeSlurm = {
      targeted: targetedEnvelope(squeueJob({ job_id: 1 })),
      squeue: jobsEnvelope([]),
    };
    const run = fakeRun(fake);
    const ctx = { parser: PARSER, run };
    const jobsCache = new JobsCache(ctx);
    const app = createApp({
      jobsCache,
      pendingAnalysis: { slurmContext: ctx, jobsCache },
    });
    const res = await request(app).get('/api/v1/jobs/1;rm/pending-analysis');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
    expect(run).not.toHaveBeenCalled();
  });

  test('missing wiring becomes 503, not a crash', async () => {
    const res = await request(createApp()).get('/api/v1/jobs/42/pending-analysis');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
  });

  test('unknown job becomes 404 with live-data detail', async () => {
    const app = buildApp({
      targeted: JSON.stringify({ errors: [], warnings: [], jobs: [] }),
      squeue: jobsEnvelope([]),
    });
    const res = await request(app).get('/api/v1/jobs/99999/pending-analysis');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.detail).toMatch(/99999/);
  });

  test('targeted RUNNING beats stale snapshot PENDING with 409 JOB_NOT_PENDING', async () => {
    const app = buildApp({
      targeted: targetedEnvelope(
        squeueJob({ job_id: 42, job_state: ['RUNNING'], state_reason: 'None' })
      ),
      squeue: jobsEnvelope([squeueJob({ job_id: 42, job_state: ['PENDING'], state_reason: 'Resources' })]),
    });
    const res = await request(app).get('/api/v1/jobs/42/pending-analysis');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('JOB_NOT_PENDING');
    expect(res.body.type).toBe('urn:slurm-view:problem:job-not-pending');
    expect(res.body.detail).toMatch(/RUNNING/);
  });

  test('simple reasons echo stateReason with analysis null', async () => {
    const app = buildApp({
      targeted: targetedEnvelope(
        squeueJob({ job_id: 43, job_state: ['PENDING'], state_reason: 'BeginTime' })
      ),
      squeue: jobsEnvelope([]),
    });
    const res = await request(app).get('/api/v1/jobs/43/pending-analysis');
    expect(res.status).toBe(200);
    expect(res.body.stateReason).toBe('BeginTime');
    expect(res.body.analysis).toBeNull();
    expect(typeof res.body.updatedAt).toBe('string');
    expect(res.body).not.toHaveProperty('message');
  });

  test('resources analysis reports current fit without eligibility claims', async () => {
    const app = buildApp({
      targeted: targetedEnvelope(
        squeueJob({ job_id: 44, job_state: ['PENDING'], state_reason: 'Resources', tres_req_str: 'cpu=64,mem=1000000M,node=1' })
      ),
      squeue: jobsEnvelope([]),
      nodes: NODES_ENVELOPE,
    });
    const res = await request(app).get('/api/v1/jobs/44/pending-analysis');
    expect(res.status).toBe(200);
    expect(res.body.analysis.kind).toBe('resources');
    expect(res.body.analysis.scope).toBe('partition');
    const shortages = res.body.analysis.nodes[0].shortages;
    expect(shortages.length).toBeGreaterThan(0);
    expect(shortages[0]).toHaveProperty('currentlyUnallocated');
    expect(shortages[0]).not.toHaveProperty('available');
    expect(JSON.stringify(res.body)).not.toMatch(/eligible|queuePosition|recommendation/);
  });

  test('priority derives competition from the snapshot with no queue position', async () => {
    const app = buildApp({
      targeted: targetedEnvelope(
        squeueJob({ job_id: 45, job_state: ['PENDING'], state_reason: 'Priority', partition: 'debug', priority: { number: 100, set: true } })
      ),
      squeue: jobsEnvelope([
        squeueJob({ job_id: 45, job_state: ['PENDING'], partition: 'debug', priority: { number: 100, set: true } }),
        squeueJob({ job_id: 46, job_state: ['PENDING'], partition: 'debug', user_name: 'bob', priority: { number: 200, set: true } }),
        squeueJob({ job_id: 47, job_state: ['RUNNING'], partition: 'debug', priority: { number: 50, set: true } }),
      ]),
      sprio: 'JOBID PRIORITY AGE\n45 100 50',
      sprioN: 'JOBID PRIORITY AGE\n45 100 0.5',
      weights: 'JOBID PRIORITY AGE\nWeights 0 0 1000',
    });
    const res = await request(app).get('/api/v1/jobs/45/pending-analysis');
    expect(res.status).toBe(200);
    expect(res.body.analysis.kind).toBe('priority');
    expect(res.body.analysis.higherPriorityJobs).toBe(1);
    expect(res.body.analysis.pendingJobs).toBe(2);
    expect(res.body.analysis.runningJobs).toBe(1);
    expect(res.body.analysis.competitors[0]).toMatchObject({ jobId: '46', priority: 200 });
    expect(res.body.analysis).not.toHaveProperty('queuePosition');
  });

  test('Relative QOS declines numeric analysis instead of misreading percents', async () => {
    const app = buildApp({
      targeted: targetedEnvelope(
        squeueJob({ job_id: 48, job_state: ['PENDING'], state_reason: 'QOSGrpCpuLimit', qos: 'pct' })
      ),
      squeue: jobsEnvelope([]),
      qosText: 'Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags\npct|0||||||||||1|Relative',
      partitionDetail: JSON.stringify({ errors: [], partitions: [] }),
    });
    const res = await request(app).get('/api/v1/jobs/48/pending-analysis');
    expect(res.status).toBe(200);
    expect(res.body.stateReason).toBe('QOSGrpCpuLimit');
    expect(res.body.analysis).toBeNull();
  });

  test('association TRES limit is scaled by the job QOS LimitFactor', async () => {
    const app = buildApp({
      targeted: targetedEnvelope(
        squeueJob({ job_id: 49, job_state: ['PENDING'], state_reason: 'AssocGrpCpuLimit', account: 'research', user_name: 'alice', qos: 'fast', tres_req_str: 'cpu=55,mem=100M,node=1' })
      ),
      squeue: jobsEnvelope([
        squeueJob({ job_id: 90, job_state: ['RUNNING'], account: 'research', user_name: 'alice', tres_req_str: 'cpu=1,mem=100M,node=1', tres_alloc_str: 'cpu=1,mem=100M,node=1' }),
      ]),
      assocTexts: [
        'ID|ParentID|Cluster|Account|User|Partition|ParentName|GrpTRES|GrpTRESRunMins|GrpJobs|MaxJobs\n1||c|research|||root|cpu=30||||\n2|1|c|research|alice||research|||||',
      ],
      qosText: 'Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags\nfast|0|||||||||2|1|',
    });
    const res = await request(app).get('/api/v1/jobs/49/pending-analysis');
    expect(res.status).toBe(200);
    expect(res.body.analysis.kind).toBe('limit');
    expect(res.body.analysis.domain).toBe('association');
    expect(res.body.analysis.limit).toBe(60);
  });

  test('QOS group usage spans accounts (never account-scoped)', async () => {
    const app = buildApp({
      targeted: targetedEnvelope(
        squeueJob({ job_id: 51, job_state: ['PENDING'], state_reason: 'QOSGrpCpuLimit', account: 'research', qos: 'shared', tres_req_str: 'cpu=5,mem=100M,node=1' })
      ),
      squeue: jobsEnvelope([
        squeueJob({ job_id: 91, job_state: ['RUNNING'], account: 'research', user_name: 'alice', qos: 'shared', tres_req_str: 'cpu=4,mem=100M,node=1', tres_alloc_str: 'cpu=4,mem=100M,node=1' }),
        squeueJob({ job_id: 92, job_state: ['RUNNING'], account: 'unrelated', user_name: 'bob', qos: 'shared', tres_req_str: 'cpu=4,mem=100M,node=1', tres_alloc_str: 'cpu=4,mem=100M,node=1' }),
      ]),
      qosText: 'Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags\nshared|0|||||cpu=10|||||1|',
      partitionDetail: JSON.stringify({ errors: [], partitions: [] }),
    });
    const res = await request(app).get('/api/v1/jobs/51/pending-analysis');
    expect(res.status).toBe(200);
    expect(res.body.analysis.used).toBe(8);
  });

  test('stale policy refreshes once on contradiction', async () => {
    const calls = { sacctmgr: 0 };
    const app = buildApp({
      targeted: targetedEnvelope(
        squeueJob({ job_id: 52, job_state: ['PENDING'], state_reason: 'AssocGrpCpuLimit', account: 'research', user_name: 'alice', qos: 'normal', tres_req_str: 'cpu=1,mem=100M,node=1' })
      ),
      squeue: jobsEnvelope([]),
      assocTexts: [
        'ID|ParentID|Cluster|Account|User|Partition|ParentName|GrpTRES|GrpTRESRunMins|GrpJobs|MaxJobs\n1||c|research|||root|cpu=100||||\n2|1|c|research|alice||research|||||',
        'ID|ParentID|Cluster|Account|User|Partition|ParentName|GrpTRES|GrpTRESRunMins|GrpJobs|MaxJobs\n1||c|research|||root|cpu=1||||\n2|1|c|research|alice||research|||||',
      ],
      qosText: 'Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags\nnormal|0||||||||||1|',
      calls,
    } as FakeSlurm);
    const res = await request(app).get('/api/v1/jobs/52/pending-analysis');
    expect(res.status).toBe(200);
    expect(res.body.analysis.limit).toBe(1);
    expect(calls.sacctmgr).toBeGreaterThanOrEqual(2);
  });

  test('Slurm failure becomes 503 without leaking internals', async () => {
    const run: SlurmRunFn = jest.fn().mockRejectedValue(
      new CommandError({
        kind: 'non-zero-exit',
        executable: 'scontrol',
        args: [],
        exitCode: 1,
        stderrSnippet: 'slurmctld: secret-internals denied',
        message: 'Command exited with code 1: scontrol',
      })
    );
    const ctx = { parser: PARSER, run };
    const jobsCache = new JobsCache(ctx);
    const app = createApp({
      jobsCache,
      pendingAnalysis: { slurmContext: ctx, jobsCache },
    });
    const res = await request(app).get('/api/v1/jobs/42/pending-analysis');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('secret-internals');
  });
});
