const dataCache = require("../../modules/dataCache");

describe('DataCache', () => {
    beforeEach(() => {
        // Reset the cache before each test
        Object.keys(dataCache.cache).forEach(key => {
            dataCache.cache[key].data = null;
            dataCache.cache[key].lastUpdated = 0;
        });
    });

    test('should store and retrieve data', () => {
        const testData = { jobs: [{ job_id: 1, name: 'test' }] };
        dataCache.setData('jobs', testData);

        const retrieved = dataCache.getData('jobs');
        expect(retrieved).toEqual(testData);
    });

    test('should update lastUpdated timestamp on data set', () => {
        const beforeSet = Date.now();
        dataCache.setData('jobs', { success: true });
        const afterSet = Date.now();

        const lastUpdated = dataCache.getLastUpdated('jobs');
        expect(lastUpdated).toBeGreaterThanOrEqual(beforeSet);
        expect(lastUpdated).toBeLessThanOrEqual(afterSet);
    });

    test('should correctly identify stale data', () => {
        // Set data and artificially make it old
        dataCache.setData('jobs', { success: true });
        dataCache.cache.jobs.lastUpdated = Date.now() - 60000; // 1 minute ago

        // Check with default interval (30s for jobs)
        expect(dataCache.isStale('jobs')).toBe(true);

        // Check with custom threshold (2 minutes)
        expect(dataCache.isStale('jobs', 120000)).toBe(false);
    });

    test('should return correct update interval for different data types', () => {
        expect(dataCache.getUpdateInterval('jobs')).toBe(30000);
        expect(dataCache.getUpdateInterval('unknownKey')).toBe(60000); // Default
    });

    test('should return null for non-existent data', () => {
        expect(dataCache.getData('nonExistentKey')).toBeNull();
    });

    test('should return 0 for lastUpdated when data never set', () => {
        expect(dataCache.getLastUpdated('jobs')).toBe(0);
    });

    test('should not store data for invalid keys', () => {
        dataCache.setData('invalidKey', { foo: 'bar' });
        expect(dataCache.getData('invalidKey')).toBeNull();
    });
});