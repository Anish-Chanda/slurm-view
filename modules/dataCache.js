class DataCache {
    constructor() {
        this.cache = {
            jobs: {
                data: null,
                lastUpdated: 0
            },

            seff: new Map()
        };

        this.updateIntervals = {
            jobs: 30000, // 30 seconds
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
        return 60000; // Default 1 minute
    }


    getSeffData(jobId) {
        return this.cache.seff.get(jobId) || null
    }

    setSeffData(jobId, data) {
        this.cache.seff.set(jobId, data);

        setTimeout(() => {
            this.cache.seff.delete(jobId);
            console.log(`[DataCache] Expired seff cache for Job ${jobId}.`);
        }, 30 * 60 * 1000); // 30-minute cache lifetime, same as slurm
    }
}

module.exports = new DataCache(); //singleton