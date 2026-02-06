/**
 * Utilities for calculating and formatting run-minutes (resource × time) limits
 */

const { parseMemoryToMB } = require('./accountLimits');

/**
 * Parse Slurm time limit format to minutes
 * Formats: "days-hours:minutes:seconds", "hours:minutes:seconds", "minutes:seconds", "minutes", "UNLIMITED"
 * 
 * @param {string|number} timeLimitStr - Time limit string from Slurm
 * @returns {number|null} - Time in minutes, or null for UNLIMITED
 * 
 * @example
 * parseTimeLimit("1-00:00:00") // 1440 (1 day)
 * parseTimeLimit("2:30:00") // 150 (2.5 hours)
 * parseTimeLimit("45:00") // 45 minutes
 * parseTimeLimit("UNLIMITED") // null
 */
function parseTimeLimit(timeLimitStr) {
    if (!timeLimitStr) return 0;
    
    // Handle UNLIMITED
    if (timeLimitStr === 'UNLIMITED' || timeLimitStr === 'Partition_Limit') {
        return null; // Indicates unlimited
    }
    
    // If already a number (minutes), return it
    if (typeof timeLimitStr === 'number') {
        return Math.floor(timeLimitStr);
    }
    
    const str = String(timeLimitStr).trim();
    
    // Format: "days-hours:minutes:seconds"
    if (str.includes('-')) {
        const [daysPart, timePart] = str.split('-');
        const days = parseInt(daysPart) || 0;
        const [hours, minutes, seconds] = timePart.split(':').map(x => parseInt(x) || 0);
        return days * 1440 + hours * 60 + minutes + Math.floor(seconds / 60);
    }
    
    // Format: "hours:minutes:seconds" or "minutes:seconds"
    const parts = str.split(':').map(x => parseInt(x) || 0);
    if (parts.length === 3) {
        // hours:minutes:seconds
        return parts[0] * 60 + parts[1] + Math.floor(parts[2] / 60);
    } else if (parts.length === 2) {
        // minutes:seconds
        return parts[0] + Math.floor(parts[1] / 60);
    } else if (parts.length === 1) {
        // Just minutes
        return parts[0];
    }
    
    return 0;
}

/**
 * Calculate remaining minutes for a running job
 * 
 * @param {Object} job - Job object with time_limit, start_time
 * @returns {number|null} - Remaining minutes, or null if UNLIMITED
 */
function getRemainingMinutes(job) {
    // Parse time limit
    const timeLimit = parseTimeLimit(job.time_limit);
    
    // If UNLIMITED, return null
    if (timeLimit === null) {
        return null;
    }
    
    // If job hasn't started yet, return full time limit
    if (!job.start_time) {
        return timeLimit;
    }
    
    // Calculate elapsed time
    const startTime = typeof job.start_time === 'object' && job.start_time.number 
        ? job.start_time.number 
        : parseInt(job.start_time) || 0;
    
    if (startTime === 0) {
        return timeLimit;
    }
    
    const currentTime = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    const elapsedMinutes = Math.floor((currentTime - startTime) / 60);
    
    // Remaining = limit - elapsed
    const remaining = timeLimit - elapsedMinutes;
    
    // Don't return negative values
    return Math.max(0, remaining);
}

/**
 * Calculate a job's run-minutes contribution for a resource
 * 
 * @param {Object} job - Job object
 * @param {string} resource - Resource type: 'cpu', 'mem', 'node'
 * @returns {number|null} - Resource-minutes contribution, or null if UNLIMITED
 */
function calculateJobRunMinutes(job, resource) {
    const remaining = getRemainingMinutes(job);
    
    // If UNLIMITED time, skip this job (contribute 0 or handle specially)
    if (remaining === null) {
        return null; // Caller should handle UNLIMITED jobs
    }
    
    let resourceAmount = 0;
    
    switch (resource) {
        case 'cpu':
            resourceAmount = parseInt(job.alloc_cpus || job.total_cpus) || 0;
            return resourceAmount * remaining;
            
        case 'mem':
            // Return MB-minutes
            const memStr = job.alloc_memory || job.total_memory;
            resourceAmount = parseMemoryToMB(String(memStr));
            return resourceAmount * remaining;
            
        case 'node':
            resourceAmount = parseInt(job.alloc_nodes || job.nodes) || 0;
            return resourceAmount * remaining;
            
        default:
            return 0;
    }
}

/**
 * Format resource-minutes for display
 * Memory: GB-days
 * CPU: CPU-days
 * Node: Node-days
 * 
 * @param {number} minutes - Resource-minutes value
 * @param {string} resource - Resource type: 'cpu', 'mem', 'node'
 * @returns {Object} - { display: string, tooltip: string, rawValue: number }
 */
function formatRunMinutes(minutes, resource) {
    if (!minutes || minutes === 0) {
        const labels = { cpu: 'CPU-days', mem: 'GB-days', node: 'Node-days' };
        return {
            display: `0 ${labels[resource] || 'Units'}`,
            tooltip: '0',
            rawValue: 0
        };
    }
    
    const rawValue = minutes;
    
    switch (resource) {
        case 'mem':
            // MB-minutes to GB-days
            // 1 GB-day = 1024 MB × 1440 minutes = 1,474,560 MB-minutes
            const GB_DAY_IN_MB_MINUTES = 1024 * 1440;
            const gbDays = minutes / GB_DAY_IN_MB_MINUTES;
            return {
                display: `${gbDays.toFixed(1)} GB-days`,
                tooltip: `${minutes.toLocaleString()} MB-minutes`,
                rawValue: rawValue
            };
            
        case 'cpu':
            // CPU-minutes to CPU-days
            const cpuDays = minutes / 1440;
            return {
                display: `${cpuDays.toFixed(1)} CPU-days`,
                tooltip: `${minutes.toLocaleString()} CPU-minutes`,
                rawValue: rawValue
            };
            
        case 'node':
            // Node-minutes to Node-days
            const nodeDays = minutes / 1440;
            return {
                display: `${nodeDays.toFixed(1)} Node-days`,
                tooltip: `${minutes.toLocaleString()} Node-minutes`,
                rawValue: rawValue
            };
            
        default:
            return {
                display: minutes.toLocaleString(),
                tooltip: `${minutes.toLocaleString()} minutes`,
                rawValue: rawValue
            };
    }
}

module.exports = {
    parseTimeLimit,
    getRemainingMinutes,
    calculateJobRunMinutes,
    formatRunMinutes
};
