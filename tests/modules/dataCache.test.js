const dataCache = require("../../modules/dataCache");

describe('DataCache', () => {
    beforeEach(() => {
        // Reset the cache before each test
        dataCache.cache.flushAll();
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
        // Mock Date.now
        const realDateNow = Date.now;
        const now = 1000000000000;
        global.Date.now = jest.fn(() => now);

        dataCache.setData('jobs', { success: true });
        
        // Advance time by 20 seconds (within 30s TTL)
        global.Date.now = jest.fn(() => now + 20000);

        // Check with default interval (30s for jobs) -> Should be fresh
        expect(dataCache.isStale('jobs')).toBe(false);

        // Check with custom threshold (10s) -> Should be stale
        expect(dataCache.isStale('jobs', 10000)).toBe(true);

        // Restore Date.now
        global.Date.now = realDateNow;
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
    
    test('should store seff data with correct TTL', () => {
        const jobId = 123;
        const seffData = { some: 'data' };
        dataCache.setSeffData(jobId, seffData);
        
        const retrieved = dataCache.getSeffData(jobId);
        expect(retrieved).toEqual(seffData);
        
        // Verify TTL is set (approximately 1800s)
        // node-cache getTtl returns timestamp.
        const ttlTimestamp = dataCache.cache.getTtl(`seff:${jobId}`);
        const now = Date.now();
        const expectedExpiry = now + 1800 * 1000;
        
        // Allow some margin of error (e.g. 1000ms)
        expect(ttlTimestamp).toBeGreaterThan(now);
        expect(Math.abs(ttlTimestamp - expectedExpiry)).toBeLessThan(1000);
    });
});