const { executeCommand } = require("./executeCmd");
const { createSafeCommand } = require("./inputValidation");

/**
 * Parse sprio output for a specific job
 * @param {string} output - Raw output from sprio command
 * @returns {Object} Parsed priority components
 */
const parseSprioOutput = (output) => {
    const lines = output.trim().split('\n');
    
    // Find the data line (skip header)
    const dataLine = lines.find(line => !line.trim().startsWith('JOBID'));
    if (!dataLine) {
        throw new Error('No priority data found in sprio output');
    }

    const fields = dataLine.trim().split(/\s+/);
    
    // Expected format: JOBID PARTITION PRIORITY SITE AGE FAIRSHARE JOBSIZE PARTITION QOS
    const result = {
        jobId: fields[0],
        partition: fields[1],
        priority: parseInt(fields[2], 10) || 0,
        components: {
            site: parseInt(fields[3], 10) || 0,
            age: parseInt(fields[4], 10) || 0,
            fairshare: parseInt(fields[5], 10) || 0,
            jobsize: parseInt(fields[6], 10) || 0,
            partition: parseInt(fields[7], 10) || 0,
            qos: parseInt(fields[8], 10) || 0
        }
    };

    return result;
};

/**
 * Parse sprio weights output
 * @param {string} output - Raw output from sprio -w command
 * @returns {Object} Priority weights configuration
 */
const parseSprioWeights = (output) => {
    const lines = output.trim().split('\n');
    
    const dataLine = lines.find(line => line.trim().startsWith('Weights'));
    if (!dataLine) {
        throw new Error('No weights data found in sprio output');
    }

    const fields = dataLine.trim().split(/\s+/);
    
    // Expected format: Weights SITE AGE FAIRSHARE JOBSIZE PARTITION QOS
    // Fields array: ['Weights', '1', '1000', '100000', '10000', '100000', '1']
    return {
        site: parseInt(fields[1], 10) || 0,
        age: parseInt(fields[2], 10) || 0,
        fairshare: parseInt(fields[3], 10) || 0,
        jobsize: parseInt(fields[4], 10) || 0,
        partition: parseInt(fields[5], 10) || 0,
        qos: parseInt(fields[6], 10) || 0
    };
};

/**
 * Get priority breakdown for a specific job
 * @param {string} jobId - Job ID to analyze
 * @returns {Object} Priority analysis with components and weights
 */
const getJobPriority = (jobId) => {
    try {
        // Get job priority breakdown
        const sprioCmd = createSafeCommand('sprio', ['-j', jobId]);
        const sprioOutput = executeCommand(sprioCmd);
        const priorityData = parseSprioOutput(sprioOutput);

        // Get priority weights
        const weightsCmd = createSafeCommand('sprio', ['-w']);
        const weightsOutput = executeCommand(weightsCmd);
        const weights = parseSprioWeights(weightsOutput);

        return {
            ...priorityData,
            weights
        };
    } catch (error) {
        console.error(`Error getting priority for job ${jobId}:`, error.message);
        throw error;
    }
};

/**
 * Parse competing jobs from squeue output
 * @param {string} output - Raw output from squeue command
 * @returns {Array} Array of competing job objects
 */
const parseCompetingJobs = (output) => {
    const lines = output.trim().split('\n').filter(line => line.trim());
    
    return lines.map(line => {
        const [jobId, priority, user, state] = line.split('|');
        return {
            jobId: jobId.trim(),
            priority: parseInt(priority, 10) || 0,
            user: user.trim(),
            state: state.trim()
        };
    });
};

/**
 * Get competing jobs in the same partition with higher priority
 * @param {string} partition - Partition name
 * @param {number} jobPriority - Current job's priority
 * @param {number} limit - Maximum number of competing jobs to return (default: 5)
 * @returns {Object} Competition analysis
 */
const getCompetingJobs = (partition, jobPriority, limit = 5) => {
    try {
        // Get all pending jobs in partition sorted by priority (descending)
        const squeueCmd = createSafeCommand('squeue', [
            '-p', partition,
            '-t', 'PENDING',
            '-h',
            '-o', '%i|%Q|%u|%T'
        ]);
        const squeueOutput = executeCommand(squeueCmd);
        
        if (!squeueOutput.trim()) {
            return {
                higherPriorityCount: 0,
                competitors: [],
                totalPending: 0
            };
        }

        const allPendingJobs = parseCompetingJobs(squeueOutput);
        
        // Filter jobs with higher priority
        const higherPriorityJobs = allPendingJobs.filter(job => job.priority > jobPriority);
        
        // Sort by priority descending and limit
        const topCompetitors = higherPriorityJobs
            .sort((a, b) => b.priority - a.priority)
            .slice(0, limit);

        return {
            higherPriorityCount: higherPriorityJobs.length,
            competitors: topCompetitors,
            totalPending: allPendingJobs.length
        };
    } catch (error) {
        console.error(`Error getting competing jobs for partition ${partition}:`, error.message);
        return {
            higherPriorityCount: 0,
            competitors: [],
            totalPending: 0,
            error: error.message
        };
    }
};

/**
 * Get count of running jobs in a partition
 * @param {string} partition - Partition name
 * @returns {number} Count of running jobs
 */
const getRunningJobsCount = (partition) => {
    try {
        const squeueCmd = createSafeCommand('squeue', [
            '-p', partition,
            '-t', 'RUNNING',
            '-h',
            '-o', '%i'
        ]);
        const output = executeCommand(squeueCmd);
        const lines = output.trim().split('\n').filter(line => line.trim());
        return lines.length;
    } catch (error) {
        console.error(`Error getting running jobs count for partition ${partition}:`, error.message);
        return 0;
    }
};

/**
 * Calculate contribution percentage of each priority component
 * @param {Object} components - Priority components
 * @param {Object} weights - Priority weights
 * @returns {Object} Percentage contributions
 */
const calculateContributions = (components, weights) => {
    const contributions = {};
    const total = Object.keys(components).reduce((sum, key) => {
        return sum + (components[key] * (weights[key] || 0));
    }, 0);

    if (total === 0) {
        return Object.keys(components).reduce((acc, key) => {
            acc[key] = 0;
            return acc;
        }, {});
    }

    Object.keys(components).forEach(key => {
        const weightedValue = components[key] * (weights[key] || 0);
        contributions[key] = ((weightedValue / total) * 100).toFixed(1);
    });

    return contributions;
};

module.exports = {
    parseSprioOutput,
    parseSprioWeights,
    getJobPriority,
    parseCompetingJobs,
    getCompetingJobs,
    getRunningJobsCount,
    calculateContributions
};
