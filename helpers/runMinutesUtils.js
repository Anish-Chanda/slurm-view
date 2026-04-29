/**
 * Utilities for calculating and formatting run-minutes (resource × time) limits
 */

const { parseMemoryToMB } = require('./accountLimits');
const NO_DATA_VALUES = new Set(['', 'N/A', 'Not started']);

function hasMeaningfulValue(value) {
    return value !== null && value !== undefined && !NO_DATA_VALUES.has(value);
}

function getJobResourceValue(job, preferredKey, fallbackKey) {
    if (hasMeaningfulValue(job[preferredKey])) {
        return job[preferredKey];
    }

    if (fallbackKey && hasMeaningfulValue(job[fallbackKey])) {
        return job[fallbackKey];
    }

    return null;
}

function parseStartTimeToUnixSeconds(startTime) {
    if (!hasMeaningfulValue(startTime)) {
        return 0;
    }

    if (typeof startTime === 'object' && startTime.number !== undefined) {
        return startTime.number || 0;
    }

    if (typeof startTime === 'number') {
        return Number.isFinite(startTime) ? startTime : 0;
    }

    if (typeof startTime === 'string') {
        const trimmed = startTime.trim();

        if (/^\d+$/.test(trimmed)) {
            return parseInt(trimmed, 10);
        }

        const parsedDate = new Date(trimmed).getTime();
        if (!Number.isNaN(parsedDate)) {
            return Math.floor(parsedDate / 1000);
        }
    }

    return 0;
}

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
    
    if (typeof timeLimitStr === 'object' && timeLimitStr.number !== undefined) {
        if (timeLimitStr.infinite || timeLimitStr.number === 4294967295) return null;
        return timeLimitStr.number;
    }
    
    // Handle UNLIMITED
    if (timeLimitStr === 'UNLIMITED' || timeLimitStr === 'Partition_Limit') {
        return null; // Indicates unlimited
    }
    
    // If already a number (minutes), return it
    if (typeof timeLimitStr === 'number') {
        return Math.floor(timeLimitStr);
    }
    
    const str = String(timeLimitStr).trim();
    
    // Format: "11d 23h 39m 19s"
    if (str.match(/[dhms]/i) && !str.includes(':') && !str.includes('-')) {
        let totalMins = 0;
        const days = str.match(/(\d+)\s*d/i);
        const hours = str.match(/(\d+)\s*h/i);
        const mins = str.match(/(\d+)\s*m/i);
        const secs = str.match(/(\d+)\s*s/i);
        
        if (days) totalMins += parseInt(days[1]) * 1440;
        if (hours) totalMins += parseInt(hours[1]) * 60;
        if (mins) totalMins += parseInt(mins[1]);
        if (secs) totalMins += Math.floor(parseInt(secs[1]) / 60);
        
        return totalMins;
    }
    
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
    // If we already have time_left pre-calculated in human format (Xd Xh Xm Xs)
    if (hasMeaningfulValue(job.time_left)) {
        if (job.time_left === 'Exceeded') return 0;
        const parsed = parseTimeLimit(job.time_left);
        if (parsed !== null && parsed >= 0) return parsed;
    }

    // Parse time limit
    const timeLimit = parseTimeLimit(job.time_limit);
    
    // If UNLIMITED, return null
    if (timeLimit === null) {
        return null;
    }
    
    // If job hasn't started yet, return full time limit
    if (!hasMeaningfulValue(job.start_time)) {
        return timeLimit;
    }
    
    // Calculate elapsed time
    const startTime = parseStartTimeToUnixSeconds(job.start_time);
    
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
            resourceAmount = parseInt(getJobResourceValue(job, 'alloc_cpus', 'total_cpus') || 0, 10) || 0;
            return resourceAmount * remaining;
            
        case 'mem':
            // Return MB-minutes
            resourceAmount = parseMemoryToMB(String(getJobResourceValue(job, 'alloc_memory', 'total_memory') || '0'));
            return resourceAmount * remaining;
            
        case 'node':
            resourceAmount = parseInt(getJobResourceValue(job, 'alloc_nodes', 'nodes') || 0, 10) || 0;
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
    getJobResourceValue,
    calculateJobRunMinutes,
    formatRunMinutes
};
