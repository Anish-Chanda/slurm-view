jest.mock('../../service/jobsService', () => ({
  getJobs: jest.fn(),
  completedJobDetails: jest.fn()
}));

jest.mock('../../handlers/fetchStats', () => ({
  getCPUsByState: jest.fn(),
  getMemByState: jest.fn(),
  getGPUByState: jest.fn()
}));

jest.mock('../../handlers/fetchPartitions', () => ({
  getPartitions: jest.fn()
}));

jest.mock('../../handlers/fetchJobStates', () => ({
  getJobStates: jest.fn()
}));

jest.mock('../../handlers/fetchPendingReason', () => ({
  getPendingReason: jest.fn()
}));

const request = require('supertest');
const { createApp } = require('../../src/server/app.js');
const { DEFAULT_PAGE_SIZE } = require('../../constants.js');
const jobsService = require('../../service/jobsService');
const { getCPUsByState, getMemByState, getGPUByState } = require('../../handlers/fetchStats');
const { getPartitions } = require('../../handlers/fetchPartitions');
const { getJobStates } = require('../../handlers/fetchJobStates');
const { getPendingReason } = require('../../handlers/fetchPendingReason');

const PASSENGER_BASE_URI = '/pun/dev/slurm-view';

const sampleJob = {
  job_id: '12345',
  partition: 'debug',
  name: 'test-job',
  user_name: 'alice',
  job_state: 'RUNNING',
  time_limit: '1:00:00',
  time_left: '30:00'
};

const defaultJobsResult = {
  success: true,
  jobs: [],
  pagination: { page: 1, pageSize: DEFAULT_PAGE_SIZE, totalItems: 0, totalPages: 0 },
  lastUpdated: Date.now()
};

let savedPassengerBaseUri;

beforeEach(() => {
  savedPassengerBaseUri = process.env.PASSENGER_BASE_URI;
  delete process.env.PASSENGER_BASE_URI;

  jobsService.getJobs.mockReset();
  jobsService.getJobs.mockResolvedValue({ ...defaultJobsResult });
  jobsService.completedJobDetails.mockReset();
  jobsService.completedJobDetails.mockReturnValue({
    success: false,
    message: 'Could not get efficiency report for Job 12345.'
  });

  getCPUsByState.mockReset();
  getCPUsByState.mockReturnValue({
    allocated: 4, idle: 12, other: 0, total: 16,
    loadGroups: { low: 2, medium: 1, high: 1 }
  });
  getMemByState.mockReset();
  getMemByState.mockReturnValue({
    allocated: 100, allocatedUsed: 60, idle: 200, down: 0, other: 0, total: 300
  });
  getGPUByState.mockReset();
  getGPUByState.mockResolvedValue({ name: 'GPU Utilization', children: [], totalGPUs: 0 });

  getPartitions.mockReset();
  getPartitions.mockReturnValue([{ id: 'all', name: 'All Partitions' }]);
  getJobStates.mockReset();
  getJobStates.mockReturnValue([]);
  getPendingReason.mockReset();
  getPendingReason.mockResolvedValue({ analysis: 'mocked-reason' });
});

afterEach(() => {
  if (savedPassengerBaseUri === undefined) {
    delete process.env.PASSENGER_BASE_URI;
  } else {
    process.env.PASSENGER_BASE_URI = savedPassengerBaseUri;
  }
});

describe('GET /api/jobs', () => {
  test('successful default request', async () => {
    const app = createApp();

    const res = await request(app).get('/api/jobs');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.success).toBe(true);
    expect(jobsService.getJobs).toHaveBeenCalledWith(
      {},
      { page: 1, pageSize: DEFAULT_PAGE_SIZE },
      true
    );
  });

  test('pagination parameters are forwarded', async () => {
    const app = createApp();

    const res = await request(app).get('/api/jobs').query({ page: '2', pageSize: '5' });

    expect(res.status).toBe(200);
    expect(jobsService.getJobs).toHaveBeenCalledWith(
      {},
      { page: 2, pageSize: 5 },
      true
    );
  });

  test('filter values are forwarded', async () => {
    const app = createApp();

    const res = await request(app).get('/api/jobs').query({ user: 'alice' });

    expect(res.status).toBe(200);
    expect(jobsService.getJobs).toHaveBeenCalledWith(
      { user: 'alice' },
      { page: 1, pageSize: DEFAULT_PAGE_SIZE },
      true
    );
  });

  test('invalid page returns 400', async () => {
    const app = createApp();

    const res = await request(app).get('/api/jobs').query({ page: '0' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(jobsService.getJobs).not.toHaveBeenCalled();
  });

  test('invalid page size returns 400', async () => {
    const app = createApp();

    const res = await request(app).get('/api/jobs').query({ pageSize: '9999' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(jobsService.getJobs).not.toHaveBeenCalled();
  });

  test('invalid filter value returns 400', async () => {
    const app = createApp();

    const res = await request(app).get('/api/jobs').query({ user: 'a;b' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(jobsService.getJobs).not.toHaveBeenCalled();
  });
});

describe('GET /api/stats', () => {
  test('no partition maps to null', async () => {
    const app = createApp();

    const res = await request(app).get('/api/stats/');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(getCPUsByState).toHaveBeenCalledWith(null);
    expect(getMemByState).toHaveBeenCalledWith(null);
    expect(getGPUByState).toHaveBeenCalledWith(null);
  });

  test('partition=all maps to null', async () => {
    const app = createApp();

    const res = await request(app).get('/api/stats/').query({ partition: 'all' });

    expect(res.status).toBe(200);
    expect(getCPUsByState).toHaveBeenCalledWith(null);
    expect(getMemByState).toHaveBeenCalledWith(null);
    expect(getGPUByState).toHaveBeenCalledWith(null);
  });

  test('valid partition is passed through', async () => {
    const app = createApp();

    const res = await request(app).get('/api/stats/').query({ partition: 'debug' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(getCPUsByState).toHaveBeenCalledWith('debug');
    expect(getMemByState).toHaveBeenCalledWith('debug');
    expect(getGPUByState).toHaveBeenCalledWith('debug');
  });

  test('invalid partition returns 400', async () => {
    const app = createApp();

    const res = await request(app).get('/api/stats/').query({ partition: 'bad;name' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Invalid partition name/);
    expect(getCPUsByState).not.toHaveBeenCalled();
  });
});

describe('GET /api/jobs/:id/pending-reason', () => {
  test('successful JSON response', async () => {
    const app = createApp();

    const res = await request(app).get('/api/jobs/12345/pending-reason');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ success: true, data: { analysis: 'mocked-reason' } });
    expect(getPendingReason).toHaveBeenCalledWith('12345');
  });

  test('underlying failure produces the existing 500 response', async () => {
    getPendingReason.mockRejectedValue(new Error('slurm exploded'));
    const app = createApp();

    const res = await request(app).get('/api/jobs/12345/pending-reason');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'slurm exploded' });
  });
});

describe('PASSENGER_BASE_URI', () => {
  test('API routes are reachable under the prefix and unprefixed route is 404', async () => {
    process.env.PASSENGER_BASE_URI = PASSENGER_BASE_URI;
    const app = createApp();
    // Delete before any requests to prove the base URI was captured
    // at construction time rather than read from process.env per request.
    delete process.env.PASSENGER_BASE_URI;

    const prefixed = await request(app).get(`${PASSENGER_BASE_URI}/api/jobs`);

    expect(prefixed.status).toBe(200);
    expect(prefixed.body.success).toBe(true);

    const unprefixed = await request(app).get('/api/jobs');

    expect(unprefixed.status).toBe(404);
  });
});

describe('server-rendered routes', () => {
  test('/ renders successfully with a stable page marker', async () => {
    jobsService.getJobs.mockResolvedValue({
      success: true,
      jobs: [{ ...sampleJob }],
      pagination: { page: 1, pageSize: DEFAULT_PAGE_SIZE, totalItems: 1, totalPages: 1 },
      lastUpdated: Date.now()
    });
    const app = createApp();

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('id="resource-utilization"');
    expect(res.text).toContain('Resource Utilization');
  });

  test('/partials/jobs-table renders successfully', async () => {
    jobsService.getJobs.mockResolvedValue({
      success: true,
      jobs: [{ ...sampleJob }],
      pagination: { page: 1, pageSize: DEFAULT_PAGE_SIZE, totalItems: 1, totalPages: 1 },
      lastUpdated: Date.now()
    });
    const app = createApp();

    const res = await request(app).get('/partials/jobs-table');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('id="jobs-table"');
    expect(res.text).toContain('12345');
  });

  test('/partials/seff-report/:jobid renders successfully', async () => {
    jobsService.completedJobDetails.mockReturnValue({
      success: true,
      details: { 'CPU Efficiency': '85% of test', 'CPU Utilized': '1 core' },
      fromCache: false
    });
    const app = createApp();

    const res = await request(app).get('/partials/seff-report/12345');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Job Efficiency Report');
  });

  test('/partials/seff-report/:jobid returns 404 when details are unavailable', async () => {
    const app = createApp();

    const res = await request(app).get('/partials/seff-report/12345');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });
});
