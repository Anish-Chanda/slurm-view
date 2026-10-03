import { fetchJobs, JOB_FIELDS, SQUEUE_FORMAT, parseJobsStdout } from '../../../src/server/adapters/slurm/jobs.js';
import { normalizeJob, normalizeStateReason } from '../../../src/server/adapters/slurm/job-normalizer.js';
import { UpstreamInvalidError } from '../../../src/server/adapters/slurm/errors.js';
import type { RawJob } from '../../../src/server/adapters/slurm/schemas/jobs.js';

const SEP = '\x1f';
const END = '\x1e\n';

function fields(overrides: Record<string, string> = {}): string[] {
  const values: Record<string, string> = {
    JobID: '101',
    JobArrayID: '101',
    ArrayTaskID: 'N/A',
    Partition: 'debug',
    Name: 'train job',
    UserName: 'alice',
    Account: 'research',
    QOS: 'normal',
    State: 'RUNNING',
    Reason: 'None',
    TimeLimit: '2:00:00',
    SubmitTime: '1725799000',
    StartTime: '1725799500',
    EndTime: 'N/A',
    PriorityLong: '1234',
    NumNodes: '2',
    NodeList: 'gpu[01-02]',
    'tres-alloc': 'cpu=8,mem=32G,node=2,gres/gpu:a100=4',
    exit_code: '0:0',
    ...overrides,
  };
  return JOB_FIELDS.map(({ name }) => values[name]!);
}

function row(overrides: Record<string, string> = {}): string {
  return `${fields(overrides).join(SEP)}${END}`;
}

describe('formatted squeue parser', () => {
  test('normalizes queue fields, timestamps, duration, exit code, and allocated TRES', () => {
    const [job] = parseJobsStdout(row());
    expect(job).toMatchObject({
      id: '101',
      jobId: '101',
      arrayJobId: null,
      arrayTaskId: null,
      partition: 'debug',
      name: 'train job',
      user: 'alice',
      account: 'research',
      qos: 'normal',
      state: 'RUNNING',
      stateFlags: [],
      stateReason: null,
      timeLimit: { kind: 'finite', seconds: 7200 },
      submitTime: new Date(1725799000 * 1000),
      startTime: new Date(1725799500 * 1000),
      endTime: null,
      priority: 1234,
      nodeCount: 2,
      nodeExpression: 'gpu[01-02]',
      exitCode: '0',
    });
    expect(job!.allocated).toMatchObject({ cpus: 8, memoryMiB: 32768, nodes: 2, gpuPresent: true });
    expect(job!.allocated.gpus).toEqual({ total: 4, byType: { a100: 4 } });
  });

  test('parses array task identity and zero task IDs without classifying ordinary jobs as arrays', () => {
    const [arrayJob] = parseJobsStdout(row({
      JobID: '100_0', JobArrayID: '100', ArrayTaskID: '0', State: 'PENDING',
      'tres-alloc': 'cpu=8,mem=4G', StartTime: 'N/A', TimeLimit: 'UNLIMITED',
    }));
    expect(arrayJob).toMatchObject({ id: '100_0', jobId: '100_0', arrayJobId: '100', arrayTaskId: '0', state: 'PENDING' });
    expect(arrayJob!.allocated).toMatchObject({ cpus: null, memoryMiB: null, gpuPresent: false });
    expect(arrayJob!.timeLimit).toEqual({ kind: 'infinite' });

    const [ordinary] = parseJobsStdout(row({ JobArrayID: '101', ArrayTaskID: 'N/A' }));
    expect(ordinary!.arrayJobId).toBeNull();
    expect(ordinary!.arrayTaskId).toBeNull();
  });

  test('keeps textual fields intact across spaces, punctuation, and Unicode', () => {
    const [job] = parseJobsStdout(row({
      Name: 'α train, stage | 2', Partition: 'gpu,fast', NodeList: 'node a,node-b',
    }));
    expect(job!.name).toBe('α train, stage | 2');
    expect(job!.partition).toBe('gpu,fast');
    expect(job!.nodeExpression).toBe('node a,node-b');
  });

  test('does not erase sentinel-looking values in arbitrary text fields', () => {
    const [job] = parseJobsStdout(row({
      Name: 'N/A', Partition: 'NONE', UserName: 'NONE', Account: 'NONE', QOS: 'NONE',
    }));
    expect(job).toMatchObject({
      name: 'N/A', partition: 'NONE', user: 'NONE', account: 'NONE', qos: 'NONE',
    });
  });

  test.each<[string, number]>([
    ['0:00', 0],
    ['3:04:05', 11_045],
    ['2-03:04:05', 183_845],
  ])('parses Slurm duration %s', (value, seconds) => {
    const [job] = parseJobsStdout(row({ TimeLimit: value }));
    expect(job!.timeLimit).toEqual({ kind: 'finite', seconds });
  });

  test('maps unset values to null and accepts completed exit status', () => {
    const [job] = parseJobsStdout(row({
      State: 'COMPLETED', Reason: 'N/A', TimeLimit: 'NOT_SET', SubmitTime: '0',
      StartTime: 'N/A', EndTime: '1725800000', PriorityLong: 'N/A', NumNodes: 'N/A',
      NodeList: 'NONE', 'tres-alloc': 'cpu=4,mem=2G', exit_code: '1:9',
    }));
    expect(job).toMatchObject({ state: 'COMPLETED', stateReason: null, timeLimit: null,
      submitTime: null, startTime: null, endTime: new Date(1725800000 * 1000),
      priority: null, nodeCount: null, nodeExpression: null, exitCode: '1' });
    expect(job!.allocated).toMatchObject({ cpus: null, memoryMiB: null, gpuPresent: false });
  });

  test('does not infer a base state from a state flag or unknown token', () => {
    for (const state of ['REQUEUE_HOLD', 'SOMETHING_NEW']) {
      const [job] = parseJobsStdout(row({ State: state }));
      expect(job!.state).toBe('UNKNOWN');
      expect(job!.stateFlags).toEqual([state]);
    }
  });

  test('empty output is an empty snapshot', () => {
    expect(parseJobsStdout('')).toEqual([]);
  });

  test.each([
    ['missing final terminator', row().slice(0, -2)],
    ['wrong field count', `101${SEP}debug${END}`],
    ['malformed job ID', row({ JobID: '123+4' })],
    ['malformed integer', row({ PriorityLong: '1.2' })],
    ['malformed timestamp', row({ SubmitTime: 'yesterday' })],
    ['malformed duration', row({ TimeLimit: '1:99' })],
    ['malformed exit code', row({ exit_code: 'done' })],
    ['unsupported heterogeneous job ID', row({ JobID: '123+1' })],
    ['inconsistent array identity', row({ JobID: '100_2', JobArrayID: '100', ArrayTaskID: '3' })],
  ])('rejects %s atomically', (_label, input) => {
    expect(() => parseJobsStdout(input)).toThrow(UpstreamInvalidError);
  });

  test('parses a 30,001-row snapshot completely', () => {
    const output = Array.from({ length: 30_001 }, (_, index) =>
      row({ JobID: String(index + 1), JobArrayID: String(index + 1), Name: `job-${index}` })
    ).join('');
    const jobs = parseJobsStdout(output);
    expect(jobs).toHaveLength(30_001);
    expect(jobs[0]!.id).toBe('1');
    expect(jobs.at(-1)!.id).toBe('30001');
  });
});

describe('targeted JSON job normalizer', () => {
  test('retains full detail normalization for targeted scontrol records', () => {
    const raw: RawJob = {
      job_id: 300,
      job_state: 'RUNNING',
      time_limit: { number: 120, set: true, infinite: false },
      submit_time: { number: 1725799000, set: true, infinite: false },
      tres_req_str: 'cpu=32,mem=65536M,node=2,gres/gpu=2',
      tres_alloc_str: 'cpu=8,mem=32G,node=1,gres/gpu=2',
      gres_detail: ['gpu:a100:2(IDX:0-1)'],
      standard_error: '/work/task.err',
    };
    const job = normalizeJob(raw);
    expect(job.id).toBe('300');
    expect(job.timeLimit).toEqual({ kind: 'finite', seconds: 7200 });
    expect(job.eligibleTime).toBeNull();
    expect(job.stderrPath).toBe('/work/task.err');
    expect(job.requested.nodes).toBe(2);
    expect(job.allocated.gpus).toEqual({ total: 2, byType: { a100: 2 } });
  });

  test('normalizes state reason sentinels', () => {
    expect(normalizeStateReason('None')).toBeNull();
    expect(normalizeStateReason('NONE')).toBeNull();
    expect(normalizeStateReason(null)).toBeNull();
    expect(normalizeStateReason('Resources')).toBe('Resources');
  });
});

describe('formatted squeue command', () => {
  test('uses a single strict formatted request with per-command time formatting', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: row(), stderr: '' });
    const jobs = await fetchJobs({ parser: 'v0.0.45', run });
    expect(jobs).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      'squeue',
      ['--noheader', '--array', '--states=R,PD,CD', `--Format=${SQUEUE_FORMAT}`],
      expect.objectContaining({ timeoutMs: 20_000, maxBufferBytes: 32 * 1024 * 1024,
        env: { SLURM_TIME_FORMAT: '%s' } })
    );
    expect(SQUEUE_FORMAT.split(',')).toHaveLength(JOB_FIELDS.length);
    expect(SQUEUE_FORMAT).toContain(`:0${SEP}`);
    expect(SQUEUE_FORMAT.endsWith(`:0${'\x1e'}`)).toBe(true);
    expect(SQUEUE_FORMAT).not.toContain('--json');
  });

  test('malformed output fails without retrying another format', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: row().slice(0, -2), stderr: '' });
    await expect(fetchJobs({ parser: 'v0.0.45', run })).rejects.toBeInstanceOf(UpstreamInvalidError);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
