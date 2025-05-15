const jobsService = require('../../service/jobsService');
const dataCache = require('../../modules/dataCache');
const { getSlurmJobs } = require('../../handlers/fetchJobs');

// Mock dependencies
jest.mock('../../modules/dataCache');
jest.mock('../../handlers/fetchJobs', () => {
    const original = jest.requireActual('../../handlers/fetchJobs');
    return {
        ...original,
        getSlurmJobs: jest.fn().mockReturnValue({
            success: true,
            jobs: [],
            pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }
        }),
        // Keep the original matchesFilter implementation
        matchesFilter: original.matchesFilter
    };
});

describe('JobsService', () => {
    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Default implementations for mocks
        dataCache.getData.mockReturnValue(null);
        dataCache.isStale.mockReturnValue(true);
        dataCache.getLastUpdated.mockReturnValue(Date.now());

        getSlurmJobs.mockReturnValue({
            success: true,
            jobs: [
                { job_id: '1', name: 'job1', user_name: 'user1' },
                { job_id: '2', name: 'job2', user_name: 'user2' }
            ],
            pagination: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 }
        });
    });

    test('should use direct API when useCache is false', () => {
        const result = jobsService.getJobs({}, {}, false);

        expect(dataCache.getData).not.toHaveBeenCalled();
        expect(getSlurmJobs).toHaveBeenCalled();
        expect(result.fromCache).toBe(false);
    });

    test('should use direct API when cache is not available', () => {
        dataCache.getData.mockReturnValue(null);

        const result = jobsService.getJobs();

        expect(dataCache.getData).toHaveBeenCalledWith('jobs');
        expect(getSlurmJobs).toHaveBeenCalled();
        expect(result.fromCache).toBe(false);
    });

    test('should use direct API when cache is stale', () => {
        dataCache.getData.mockReturnValue({ jobs: [] });
        dataCache.isStale.mockReturnValue(true);

        const result = jobsService.getJobs();

        expect(dataCache.getData).toHaveBeenCalledWith('jobs');
        expect(dataCache.isStale).toHaveBeenCalledWith('jobs');
        expect(getSlurmJobs).toHaveBeenCalled();
        expect(result.fromCache).toBe(false);
    });

    test('should use cache when available and not stale', () => {
        const cachedData = {
            jobs: [
                { job_id: '1', name: 'job1', user_name: 'user1' },
                { job_id: '2', name: 'job2', user_name: 'user2' }
            ]
        };

        dataCache.getData.mockReturnValue(cachedData);
        dataCache.isStale.mockReturnValue(false);

        const result = jobsService.getJobs();

        expect(dataCache.getData).toHaveBeenCalledWith('jobs');
        expect(dataCache.isStale).toHaveBeenCalledWith('jobs');
        expect(getSlurmJobs).not.toHaveBeenCalled();
        expect(result.fromCache).toBe(true);
        expect(result.jobs.length).toBe(2);
    });

    test('should apply filters to cached data', () => {
        const cachedData = {
            jobs: [
                { job_id: '1', name: 'job1', user_name: 'user1' },
                { job_id: '2', name: 'job2', user_name: 'user2' }
            ]
        };

        dataCache.getData.mockReturnValue(cachedData);
        dataCache.isStale.mockReturnValue(false);

        const result = jobsService.getJobs({ user: 'user1' });

        expect(result.jobs.length).toBe(1);
        expect(result.jobs[0].job_id).toBe('1');
        expect(result.pagination.totalItems).toBe(1);
    });

    test('should apply pagination to cached data', () => {
        const cachedData = {
            jobs: Array(30).fill().map((_, i) => ({
                job_id: `${i + 1}`,
                name: `job${i + 1}`,
                user_name: `user${i % 3 + 1}`
            }))
        };

        dataCache.getData.mockReturnValue(cachedData);
        dataCache.isStale.mockReturnValue(false);

        const result = jobsService.getJobs({}, { page: 2, pageSize: 10 });

        expect(result.jobs.length).toBe(10);
        expect(result.jobs[0].job_id).toBe('11');
        expect(result.pagination).toEqual({
            page: 2,
            pageSize: 10,
            totalItems: 30,
            totalPages: 3
        });
    });

    test('should include lastUpdated timestamp from cache', () => {
        const mockTimestamp = 1623456789000;
        const cachedData = { jobs: [] };

        dataCache.getData.mockReturnValue(cachedData);
        dataCache.isStale.mockReturnValue(false);
        dataCache.getLastUpdated.mockReturnValue(mockTimestamp);

        const result = jobsService.getJobs();

        expect(result.lastUpdated).toBe(mockTimestamp);
    });
});