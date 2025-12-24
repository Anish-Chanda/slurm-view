const NodeCache = require('node-cache');

class DataCache {
    constructor() {
        this.cache = new NodeCache({ stdTTL: 30, checkperiod: 120 });

        this.updateIntervals = {
            jobs: 30000, // 30 seconds
        };
    }

    setData(key, data) {
        if (key !== 'jobs') return;

        const wrapper = {
            data: data,
            lastUpdated: Date.now()
        };
        
        this.cache.set(key, wrapper, 30);
    }

    getData(key) {
        const wrapper = this.cache.get(key);
        return wrapper ? wrapper.data : null;
    }

    getLastUpdated(key) {
        const wrapper = this.cache.get(key);
        return wrapper ? wrapper.lastUpdated : 0;
    }

    isStale(key, threshold = null) {
        const lastUpdated = this.getLastUpdated(key);
        if (lastUpdated === 0) return true;

        const now = Date.now();
        const interval = threshold || this.getUpdateInterval(key);

        return now - lastUpdated > interval;
    }

    getUpdateInterval(key) {
        if (key === 'jobs') return this.updateIntervals.jobs;
        return 60000; // Default 1 minute
    }


    getSeffData(jobId) {
        return this.cache.get(`seff:${jobId}`) || null;
    }

    setSeffData(jobId, data) {
        this.cache.set(`seff:${jobId}`, data, 1800); // 30 minutes
    }
}

module.exports = new DataCache(); //singleton