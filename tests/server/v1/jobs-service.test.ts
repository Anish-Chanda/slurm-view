import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseJobsStdout } from '../../../src/server/adapters/slurm/jobs.js';
import type { Job } from '../../../src/server/models/job.js';
import type { JobSnapshot } from '../../../src/server/cache/jobs-cache.js';
import { JobsService } from '../../../src/server/services/jobs-service.js';
import type { JobsSource } from '../../../src/server/services/jobs-service.js';

const FIXTURES = path.join(__dirname, 'fixtures');

function loadJobs(): Job[] {
  const stdout = fs.readFileSync(path.join(FIXTURES, 'v45-jobs.json'), 'utf8');
  return parseJobsStdout('v0.0.45', stdout);
}

function serviceFor(jobs: Job[]): JobsService {
  const snapshot: JobSnapshot = {
    jobs,
    byId: new Map(jobs.map((job) => [job.id, job])),
    capturedAt: new Date('2026-09-09T12:00:00.000Z'),
  };
  const source: JobsSource = { getOrLoad: () => Promise.resolve(snapshot) };
  return new JobsService(source);
}

const PAGE = { page: 1, pageSize: 20 };

describe('JobsService.listJobs', () => {
  test('returns the full snapshot with pagination metadata and timestamp', async () => {
    const result = await serviceFor(loadJobs()).listJobs({}, PAGE);
    expect(result.jobs).toHaveLength(3);
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 3, totalPages: 1 });
    expect(result.updatedAt).toEqual(new Date('2026-09-09T12:00:00.000Z'));
  });

  test.each([
    ['id exact', { id: '101' }, ['101']],
    ['partition exact ci', { partition: 'COMPUTE' }, ['100_2']],
    ['name substring', { name: 'train' }, ['101']],
    ['user case-insensitive', { user: 'ALICE' }, ['101']],
    ['account substring', { account: 'teach' }, ['100_2']],
    ['state exact', { state: 'PENDING' }, ['100_2']],
    ['stateReason substring', { stateReason: 'resour' }, ['100_2']],
  ])('filters by %s', (_label, filter, expectedIds) => {
    return expect(
      serviceFor(loadJobs())
        .listJobs(filter, PAGE)
        .then((result) => result.jobs.map((job) => job.id))
    ).resolves.toEqual(expectedIds);
  });

  test('id is an exact string comparison, not a substring', async () => {
    const service = serviceFor(loadJobs());
    await expect(
      service.listJobs({ id: '10' }, PAGE).then((r) => r.jobs.map((j) => j.id))
    ).resolves.toEqual([]);
    await expect(
      service.listJobs({ id: '100_2' }, PAGE).then((r) => r.jobs.map((j) => j.id))
    ).resolves.toEqual(['100_2']);
  });

  test('state is an exact comparison', async () => {
    const service = serviceFor(loadJobs());
    await expect(
      service.listJobs({ state: 'pending' }, PAGE).then((r) => r.jobs)
    ).resolves.toEqual([]);
  });

  test('wildcards work only for name and stateReason', async () => {
    const service = serviceFor(loadJobs());
    await expect(
      service.listJobs({ user: 'ali*' }, PAGE).then((r) => r.jobs)
    ).resolves.toEqual([]);
    await expect(
      service.listJobs({ account: 'teach*' }, PAGE).then((r) => r.jobs)
    ).resolves.toEqual([]);
    await expect(
      service.listJobs({ partition: 'comp*' }, PAGE).then((r) => r.jobs)
    ).resolves.toEqual([]);
    await expect(
      service.listJobs({ id: '10*' }, PAGE).then((r) => r.jobs)
    ).resolves.toEqual([]);
  });

  test('partition uses exact match, not substring', async () => {
    // `comp` must not match `compute`.
    const result = await serviceFor(loadJobs()).listJobs({ partition: 'comp' }, PAGE);
    expect(result.jobs).toHaveLength(0);
  });

  test('supports * wildcards', async () => {
    const service = serviceFor(loadJobs());
    await expect(
      service.listJobs({ stateReason: 'Res*es' }, PAGE).then((r) => r.jobs.map((j) => j.id))
    ).resolves.toEqual(['100_2']);
    await expect(
      service.listJobs({ name: '*MODEL' }, PAGE).then((r) => r.jobs.map((j) => j.id))
    ).resolves.toEqual(['101']);
  });

  test('null domain values never match', async () => {
    // Job 103 has partition null; an unrelated partition finds nothing extra.
    const result = await serviceFor(loadJobs()).listJobs({ partition: 'debug' }, PAGE);
    expect(result.jobs.map((job) => job.id)).toEqual(['101']);
  });

  test('pagination slices after filtering', async () => {
    const service = serviceFor(loadJobs());
    const first = await service.listJobs({}, { page: 1, pageSize: 2 });
    expect(first.jobs.map((job) => job.id)).toEqual(['101', '100_2']);
    expect(first.pagination).toEqual({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });
    const second = await service.listJobs({}, { page: 2, pageSize: 2 });
    expect(second.jobs.map((job) => job.id)).toEqual(['103']);
    const beyond = await service.listJobs({}, { page: 9, pageSize: 2 });
    expect(beyond.jobs).toEqual([]);
    expect(beyond.pagination.totalItems).toBe(3);
  });

  test('empty snapshot yields an empty result, not an error', async () => {
    const result = await serviceFor([]).listJobs({}, PAGE);
    expect(result.jobs).toEqual([]);
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 0, totalPages: 0 });
  });

  test('propagates snapshot load failures to the handler', async () => {
    const failing: JobsSource = {
      getOrLoad: () => Promise.reject(new Error('controller down')),
    };
    await expect(new JobsService(failing).listJobs({}, PAGE)).rejects.toThrow('controller down');
  });
});

describe('JobsService.getJobById', () => {
  test('returns the job with the snapshot timestamp', async () => {
    const result = await serviceFor(loadJobs()).getJobById('101');
    expect(result?.job.id).toBe('101');
    expect(result?.updatedAt).toEqual(new Date('2026-09-09T12:00:00.000Z'));
  });

  test('resolves composite array task IDs exactly', async () => {
    const service = serviceFor(loadJobs());
    await expect(service.getJobById('100_2').then((r) => r?.job.id)).resolves.toBe('100_2');
    await expect(service.getJobById('100')).resolves.toBeNull();
    await expect(service.getJobById('10')).resolves.toBeNull();
  });

  test('unknown IDs resolve to null for the handler 404', async () => {
    await expect(serviceFor(loadJobs()).getJobById('99999')).resolves.toBeNull();
    await expect(serviceFor([]).getJobById('101')).resolves.toBeNull();
  });
});
