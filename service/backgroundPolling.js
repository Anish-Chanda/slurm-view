const dataCache = require('../modules/dataCache')
const { getSlurmJobs } = require('../handlers/fetchJobs');


class BackgroundPolling {
    constructor() {
        this.isRunning = false;
        this.jobsTimer = null;
    }

    start() {
        if (this.isRunning) return;

        console.log('[Background Worker] Starting background worker service...');
        this.isRunning = true;

        console.log("[Background Worker] fetching initial data...");
        // Initial fetch
        this.updateJobs();

        // Set up timers for periodic updates
        this.jobsTimer = setInterval(() => this.updateJobs(), dataCache.updateIntervals.jobs);
    }

    stop() {
        if (!this.isRunning) return;

        console.log('[Background Worker] Stopping background worker service...');
        clearInterval(this.jobsTimer);

        this.isRunning = false;
    }

    async updateJobs() {
        try {
            console.log('[Background Worker] Fetching job data...');
            // Get all jobs without pagination for the cache
            const result = await getSlurmJobs({}, { pageSize: Number.MAX_SAFE_INTEGER });

            if (result.success) {
                dataCache.setData('jobs', result);
                console.log(`[Background Worker] Fetched ${result.jobs.length} jobs, next update in ${dataCache.updateIntervals.jobs / 1000} seconds`);
            }
        } catch (error) {
            console.error('Error updating jobs cache:', error);
        }
    }
}


module.exports = new BackgroundPolling(); //singleton