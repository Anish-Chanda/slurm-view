import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  fetchJobs,
  normalizeStateReason,
  parseJobsStdout,
} from '../../../src/server/adapters/slurm/jobs.js';
import type { SupportedDataParser } from '../../../src/server/adapters/slurm/parser-version.js';
import {
  SlurmUpstreamError,
  UpstreamInvalidError,
} from '../../../src/server/adapters/slurm/errors.js';

const FIXTURES = path.join(__dirname, 'fixtures');

function jobsFixture(version: string): string {
  return fs.readFileSync(path.join(FIXTURES, `${version}-jobs.json`), 'utf8');
}

describe('parseJobsStdout', () => {
  test.each([
    ['v0.0.43', 'v43'],
    ['v0.0.44', 'v44'],
    ['v0.0.45', 'v45'],
  ] as Array<[SupportedDataParser, string]>)('normalizes %s fixture', (parser, version) => {
    const jobs = parseJobsStdout(parser, jobsFixture(version));
    expect(jobs).toHaveLength(3);

    const running = jobs[0]!;
    expect(running.id).toBe('101');
    expect(running.jobId).toBe('101');
    expect(running.state).toBe('RUNNING');
    expect(running.stateFlags).toEqual([]);
    expect(running.stateReason).toBeNull();
    expect(running.timeLimit).toEqual({ kind: 'finite', seconds: 7200 });
    expect(running.submitTime).toEqual(new Date(1725799000 * 1000));
    expect(running.startTime).toEqual(new Date(1725799500 * 1000));
    expect(running.endTime).toBeNull();
    expect(running.nodeCount).toBe(2);
    expect(running.nodeExpression).toBe('gpu[01-02]');
    expect(running.requested.cpus).toBe(8);
    expect(running.requested.memoryMiB).toBe(32768);
    expect(running.requested.gpus).toEqual({ total: 4, byType: { a100: 4 } });
    expect(running.allocated.gpus).toEqual({ total: 4, byType: { a100: 4 } });
    expect(running.partition).toBe('debug');
  });

  test('derives composite identity from array wrapper fields', () => {
    const jobs = parseJobsStdout('v0.0.45', jobsFixture('v43'));
    const arrayTask = jobs[1]!;
    expect(arrayTask.jobId).toBe('102');
    expect(arrayTask.arrayJobId).toBe('100');
    expect(arrayTask.arrayTaskId).toBe('2');
    expect(arrayTask.id).toBe('100_2');
    expect(arrayTask.state).toBe('PENDING');
    expect(arrayTask.stateFlags).toEqual(['REQUEUE_HOLD']);
    expect(arrayTask.stateReason).toBe('Resources');
    expect(arrayTask.timeLimit).toEqual({ kind: 'infinite' });
    expect(arrayTask.startTime).toBeNull();
    expect(arrayTask.dependency).toBe('afterok:99');
  });

  test('cleans sentinel/empty strings and joins node arrays', () => {
    const jobs = parseJobsStdout('v0.0.45', jobsFixture('v43'));
    const done = jobs[2]!;
    expect(done.partition).toBeNull();
    expect(done.name).toBeNull();
    expect(done.nodeExpression).toBe('node01,node02');
    expect(done.nodeCount).toBe(1);
    expect(done.requested.gpus).toEqual({ total: 2, byType: { unknown: 2 } });
    expect(done.exitCode).toBe('0');
    expect(done.derivedExitCode).toBe('0');
  });

  test('tolerates realistic exit-code status/signal metadata without changing return_code', () => {
    const jobs = parseJobsStdout(
      'v0.0.45',
      JSON.stringify({
        jobs: [
          {
            job_id: 200,
            exit_code: {
              return_code: { number: 0, set: true, infinite: false },
              status: ['SUCCESS'],
              signal: {
                id: { number: 0, set: false, infinite: false },
                name: '',
              },
            },
            derived_exit_code: {
              return_code: { number: 1, set: true, infinite: false },
              status: ['ERROR'],
              signal: {
                id: { number: 0, set: false, infinite: false },
                name: '',
              },
            },
          },
        ],
      })
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.exitCode).toBe('0');
    expect(jobs[0]?.derivedExitCode).toBe('1');
  });

  test('non-array jobs keep scalar identity and null exit codes when unset', () => {
    const jobs = parseJobsStdout('v0.0.45', jobsFixture('v43'));
    const running = jobs[0]!;
    expect(running.id).toBe('101');
    expect(running.arrayJobId).toBeNull();
    expect(running.arrayTaskId).toBeNull();
    expect(running.exitCode).toBeNull();
  });

  test('malformed array wrapper data rejects the payload', () => {
    const badTask = {
      job_id: 9,
      array_job_id: { number: 100, set: true, infinite: false },
      array_task_id: { number: 'abc', set: true, infinite: false },
    };
    expect(() =>
      parseJobsStdout('v0.0.45', JSON.stringify({ jobs: [badTask] }))
    ).toThrow(UpstreamInvalidError);
  });

  test('gres_detail enriches GPU types without changing the TRES total', () => {
    const jobs = parseJobsStdout(
      'v0.0.45',
      JSON.stringify({
        jobs: [
          {
            job_id: 7,
            tres_req_str: 'cpu=2,mem=8G,gres/gpu=2',
            tres_alloc_str: 'cpu=2,mem=8G,gres/gpu=2',
            gres_detail: ['gpu:a100:2(IDX:0-1)'],
          },
        ],
      })
    );
    expect(jobs[0]?.allocated.gpus).toEqual({ total: 2, byType: { a100: 2 } });
    expect(jobs[0]?.requested.gpus).toEqual({ total: 2, byType: { unknown: 2 } });
  });

  test('invalid JSON and schema failures never yield partial data', () => {
    expect(() => parseJobsStdout('v0.0.45', 'not json')).toThrow(UpstreamInvalidError);
    expect(() => parseJobsStdout('v0.0.45', JSON.stringify({ meta: {} }))).toThrow(
      UpstreamInvalidError
    );
  });
});

describe('normalizeJob detail fields', () => {
  function jobWith(overrides: Record<string, unknown>) {
    const [job] = parseJobsStdout(
      'v0.0.45',
      JSON.stringify({ jobs: [{ job_id: 300, ...overrides }] })
    );
    return job!;
  }

  test('normalizes eligible time, priority, stderr, tasks, and scheduling fields', () => {
    const job = jobWith({
      eligible_time: { number: 1725799100, set: true, infinite: false },
      priority: { number: 12345, set: true, infinite: false },
      standard_error: '/home/alice/slurm-300.err',
      tasks: { number: 16, set: true, infinite: false },
      cpus_per_task: { number: 2, set: true, infinite: false },
      features: 'a100,ib',
      resv_name: 'weekend',
      wckey: 'mykey',
      batch_host: 'node01',
      tres_req_str: 'cpu=32,mem=65536M,node=2',
    });
    expect(job.eligibleTime).toEqual(new Date(1725799100 * 1000));
    expect(job.priority).toBe(12345);
    expect(job.stderrPath).toBe('/home/alice/slurm-300.err');
    expect(job.taskCount).toBe(16);
    expect(job.cpusPerTask).toBe(2);
    expect(job.constraints).toBe('a100,ib');
    expect(job.reservation).toBe('weekend');
    expect(job.wckey).toBe('mykey');
    expect(job.batchHost).toBe('node01');
    expect(job.requested.nodes).toBe(2);
  });

  test('absent detail fields normalize to null without failing', () => {
    const job = jobWith({});
    expect(job.eligibleTime).toBeNull();
    expect(job.priority).toBeNull();
    expect(job.stderrPath).toBeNull();
    expect(job.taskCount).toBeNull();
    expect(job.cpusPerTask).toBeNull();
    expect(job.constraints).toBeNull();
    expect(job.reservation).toBeNull();
    expect(job.wckey).toBeNull();
    expect(job.batchHost).toBeNull();
    expect(job.requested.nodes).toBeNull();
  });

  test('unset wrappers and sentinels become null', () => {
    const job = jobWith({
      eligible_time: { number: 0, set: false, infinite: false },
      priority: { number: 0, set: false, infinite: false },
      standard_error: '(null)',
      tasks: 'N/A',
      features: '',
      resv_name: 'None',
    });
    expect(job.eligibleTime).toBeNull();
    expect(job.priority).toBeNull();
    expect(job.stderrPath).toBeNull();
    expect(job.taskCount).toBeNull();
    expect(job.constraints).toBeNull();
    expect(job.reservation).toBeNull();
  });

  test('existing fixtures without detail fields stay valid with nulls', () => {
    for (const parser of ['v0.0.43', 'v0.0.44', 'v0.0.45'] as SupportedDataParser[]) {
      const jobs = parseJobsStdout(parser, jobsFixture(parser === 'v0.0.45' ? 'v45' : parser === 'v0.0.44' ? 'v44' : 'v43'));
      expect(jobs[0]!.eligibleTime).toBeNull();
      expect(jobs[0]!.stderrPath).toBeNull();
      expect(jobs[0]!.requested.nodes).toBe(2);
    }
  });
});

describe('parseJobsStdout envelope', () => {
  test('non-empty Slurm errors fail; warnings only log', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(() =>
        parseJobsStdout(
          'v0.0.45',
          JSON.stringify({ jobs: [], errors: [{ description: 'controller down' }] })
        )
      ).toThrow(SlurmUpstreamError);
      const jobs = parseJobsStdout(
        'v0.0.45',
        JSON.stringify({ jobs: [], warnings: [{ message: 'skew' }] })
      );
      expect(jobs).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('normalizeStateReason', () => {
  test('"None" normalizes to null', () => {
    expect(normalizeStateReason('None')).toBeNull();
    expect(normalizeStateReason('NONE')).toBeNull();
    expect(normalizeStateReason(null)).toBeNull();
    expect(normalizeStateReason('')).toBeNull();
    expect(normalizeStateReason('Resources')).toBe('Resources');
  });
});

describe('fetchJobs', () => {
  test('issues versioned argv and validates output', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: jobsFixture('v45'), stderr: '' });
    const jobs = await fetchJobs({ parser: 'v0.0.45', run });
    expect(run).toHaveBeenCalledWith(
      'squeue',
      ['--json=v0.0.45', '--states=R,PD,CD'],
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
    expect(jobs).toHaveLength(3);
  });
});
