class DataCache {
    constructor() {
        this.cache = {
            jobs: {
                data: null,
                lastUpdated: 0
            },
            cpuStats: {
                data: null,
                lastUpdated: 0
            },
            memStats: {
                data: null,
                lastUpdated: 0
            },
            gpuStats: {
                data: null,
                lastUpdated: 0
            },
            seffData: { //TODO: map job id to seff data
                data: {},
                lastUpdated: 0
            }
        };

        this.updateIntervals = {
            jobs: 30000, // 30 seconds
            stats: 60000, // 1 minute
            completedJobs: 300000 // 5 minutes
        };
    }

    setData(key, data) {
        if (this.cache[key]) {
            this.cache[key].data = data;
            this.cache[key].lastUpdated = Date.now();
        }
    }

    getData(key) {
        return this.cache[key]?.data || null;
    }

    getLastUpdated(key) {
        return this.cache[key]?.lastUpdated || 0;
    }

    isStale(key, threshold = null) {
        const lastUpdated = this.getLastUpdated(key);
        const now = Date.now();
        const interval = threshold || this.getUpdateInterval(key);

        return now - lastUpdated > interval;
    }

    getUpdateInterval(key) {
        if (key === 'jobs') return this.updateIntervals.jobs;
        if (key === 'cpuStats' || key === 'memStats' || key === 'gpuStats') return this.updateIntervals.stats;
        if (key === 'completedJobs') return this.updateIntervals.completedJobs;
        return 60000; // Default 1 minute
    }
}

module.exports = new DataCache(); //singleton