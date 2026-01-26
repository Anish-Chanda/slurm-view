const NodeCache = require('node-cache');

/**
 * DataCache manages multiple caches for different types of data
 * - jobsCache: Individual job data indexed by job ID
 * - seffCache: Seff report data indexed by job ID  
 * - pendingReasonCache: Pending reason analysis indexed by job ID
 */
class DataCache {
    constructor() {
        // Jobs cache - stores individual jobs keyed by job_id
        // This acts as both the primary storage and allows O(1) lookup by ID
        this.jobsCache = new NodeCache({ stdTTL: 30, checkperiod: 120 });
        this.jobsLastUpdated = 0;
        
        // Seff reports cache (keyed by job_id)
        this.seffCache = new NodeCache({ stdTTL: 1800, checkperiod: 300 }); // 30 min TTL
        
        // Pending reason analysis cache (keyed by job_id)
        this.pendingReasonCache = new NodeCache({ stdTTL: 60, checkperiod: 120 }); // 60 sec TTL

        // Account limits cache (very long TTL - updated hourly)
        this.accountLimitsCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // 1 hour TTL
        this.accountLimitsLastUpdated = 0;

        // General purpose cache for stats and other data
        this.cache = new NodeCache({ stdTTL: 5, checkperiod: 120 }); // 5 sec TTL for stats

        this.updateIntervals = {
            jobs: 30000, // 30 seconds
        };

        // Log cache stats every 60 seconds (only if not in test environment)
        this.statsInterval = null;
        if (process.env.NODE_ENV !== 'test') {
            this.statsInterval = setInterval(() => {
                this.logStats();
            }, 60000);
        }
    }

    /**
     * Set jobs data - stores each job individually by job_id
     * @param {string} key - Should be 'jobs'
     * @param {Object} data - Object with jobs array and metadata
     */
    setData(key, data) {
        if (key !== 'jobs') return;

        // Clear existing jobs first
        this.jobsCache.flushAll();
        
        // Store each job by its ID
        if (data && Array.isArray(data.jobs)) {
            data.jobs.forEach(job => {
                if (job.job_id) {
                    this.jobsCache.set(job.job_id.toString(), job, 30);
                }
            });
        }
        
        // Track when jobs were last updated
        this.jobsLastUpdated = Date.now();
    }

    /**
     * Get all jobs as an array with metadata (for compatibility)
     * @param {string} key - Should be 'jobs'
     * @returns {Object|null} Object with jobs array or null
     */
    getData(key) {
        if (key !== 'jobs') return null;
        
        const allKeys = this.jobsCache.keys();
        if (allKeys.length === 0) return null;
        
        const jobs = allKeys.map(jobId => this.jobsCache.get(jobId)).filter(job => job !== undefined);
        
        return {
            jobs: jobs,
            success: true
        };
    }

    /**
     * Get last update timestamp for jobs
     * @param {string} key - Should be 'jobs'
     * @returns {number} Timestamp or 0
     */
    getLastUpdated(key) {
        if (key !== 'jobs') return 0;
        return this.jobsLastUpdated;
    }

    /**
     * Check if jobs data is stale
     * @param {string} key - Should be 'jobs'
     * @param {number} threshold - Optional custom threshold
     * @returns {boolean} True if stale
     */
    isStale(key, threshold = null) {
        if (key !== 'jobs') return true;
        
        if (this.jobsLastUpdated === 0) return true;

        const now = Date.now();
        const interval = threshold || this.getUpdateInterval(key);

        return now - this.jobsLastUpdated > interval;
    }

    /**
     * Get update interval for a key
     * @param {string} key - Cache key
     * @returns {number} Interval in milliseconds
     */
    getUpdateInterval(key) {
        if (key === 'jobs') return this.updateIntervals.jobs;
        return 60000; // Default 1 minute
    }

    /**
     * Get a single job by ID from cache
     * @param {string|number} jobId - Job ID
     * @returns {Object|null} Job object or null
     */
    getJobById(jobId) {
        return this.jobsCache.get(jobId.toString());
    }

    /**
     * Get multiple jobs by IDs from cache
     * @param {Array<string|number>} jobIds - Array of job IDs
     * @returns {Array<Object>} Array of found jobs (may be partial)
     */
    getJobsByIds(jobIds) {
        const jobs = [];
        jobIds.forEach(jobId => {
            const job = this.getJobById(jobId);
            if (job) {
                jobs.push(job);
            }
        });
        return jobs;
    }

    /**
     * Set a single job in the cache
     * @param {string|number} jobId - Job ID
     * @param {Object} jobData - Job data object
     * @param {number} ttl - Optional TTL in seconds (default: 30)
     */
    setJobById(jobId, jobData, ttl = 30) {
        this.jobsCache.set(jobId.toString(), jobData, ttl);
    }

    /**
     * Get seff report for a job
     * @param {string|number} jobId - Job ID
     * @returns {Object|null} Seff data or null
     */
    getSeffData(jobId) {
        return this.seffCache.get(jobId.toString());
    }

    /**
     * Set seff report for a job
     * @param {string|number} jobId - Job ID
     * @param {Object} data - Seff report data
     * @param {number} ttl - Optional TTL in seconds (default: 1800 = 30 min)
     */
    setSeffData(jobId, data, ttl = 1800) {
        this.seffCache.set(jobId.toString(), data, ttl);
    }

    /**
     * Get pending reason analysis for a job
     * @param {string|number} jobId - Job ID
     * @returns {Object|null} Pending reason data or null
     */
    getPendingReason(jobId) {
        return this.pendingReasonCache.get(jobId.toString());
    }

    /**
     * Set pending reason analysis for a job
     * @param {string|number} jobId - Job ID
     * @param {Object} data - Pending reason analysis data
     * @param {number} ttl - Optional TTL in seconds (default: 60)
     */
    setPendingReason(jobId, data, ttl = 60) {
        this.pendingReasonCache.set(jobId.toString(), data, ttl);
    }

    /**
     * Get account limits data
     * @returns {Object|null} - Account limits or null
     */
    getAccountLimits() {
        return this.accountLimitsCache.get('limits') || null;
    }

    /**
     * Set account limits data
     * @param {Object} data - Account limits data with timestamp and accounts
     * @param {number} ttl - Optional TTL in seconds (default: 3600)
     */
    setAccountLimits(data, ttl = 3600) {
        this.accountLimitsCache.set('limits', data, ttl);
        this.accountLimitsLastUpdated = data.timestamp || Date.now();
        console.log('[DataCache] Account limits cached:', Object.keys(data.accounts || {}).length, 'accounts');
    }

    /**
     * Check if account limits need refresh
     * @param {number} threshold - Time in ms (default: 1 hour)
     * @returns {boolean} - True if stale
     */
    isAccountLimitsStale(threshold = 3600000) {
        if (!this.accountLimitsCache.get('limits')) return true;
        const age = Date.now() - this.accountLimitsLastUpdated;
        return age > threshold;
    }

    /**
     * Clear all caches
     */
    clearAll() {
        this.jobsCache.flushAll();
        this.seffCache.flushAll();
        this.pendingReasonCache.flushAll();
        this.accountLimitsCache.flushAll();
        this.cache.flushAll();
        this.jobsLastUpdated = 0;
        this.accountLimitsLastUpdated = 0;
    }

    /**
     * Log statistics for all caches
     */
    logStats() {
        console.log('[DataCache Stats]', {
            jobs: this.jobsCache.getStats(),
            seff: this.seffCache.getStats(),
            pendingReason: this.pendingReasonCache.getStats(),
            accountLimits: this.accountLimitsCache.getStats(),
            general: this.cache.getStats()
        });
    }
}

module.exports = new DataCache(); //singleton
