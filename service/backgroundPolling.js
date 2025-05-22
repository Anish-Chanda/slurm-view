const dataCache = require('../modules/dataCache')
const { getSlurmJobs } = require('../handlers/fetchJobs');


class BackgroundPolling {
    constructor() {
        this.isRunning = false;
        this.jobsTimer = null;
        //TODO: this.statsTimer = null;
        //TODO: this.completedJobsTimer = null;
        //TODO: this.completedJobsTracking = new Set(); // Track jobs we've seen as running/pending
    }

    start() {
        if (this.isRunning) return;

        console.log('[Background Worker] Starting background worker service...');
        this.isRunning = true;

        console.log("[Background Worker] fetching initial data...");
        // Initial fetch
        this.updateJobs();
        //TODO: this.updateStats();
        // this.checkCompletedJobs();

        // Set up timers for periodic updates
        this.jobsTimer = setInterval(() => this.updateJobs(), dataCache.updateIntervals.jobs);
        //TODO: this.statsTimer = setInterval(() => this.updateStats(), dataCache.updateIntervals.stats);
        this.completedJobsTimer = setInterval(() => this.checkCompletedJobs(), dataCache.updateIntervals.completedJobs);
    }

    stop() {
        if (!this.isRunning) return;

        console.log('[Background Worker] Stopping background worker service...');
        clearInterval(this.jobsTimer);
        //TODO: clearInterval(this.statsTimer);
        // clearInterval(this.completedJobsTimer);
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

                // Track job IDs for completed job detection
                // const currentJobs = new Set(result.jobs.map(job => job.job_id));
                // currentJobs.forEach(jobId => this.completedJobsTracking.add(jobId));
            }
        } catch (error) {
            console.error('Error updating jobs cache:', error);
        }
    }
}


module.exports = new BackgroundPolling(); //singleton