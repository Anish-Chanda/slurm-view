const { executeCommand } = require("./executeCmd");
const { createSafeCommand } = require("./inputValidation");

const parseIntOrZero = (value) => parseInt(value, 10) || 0;

const parseFloatOrZero = (value) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const getComponentKey = (header) => {
    const normalizedHeader = header.toUpperCase();
    const headerToKeyMap = {
        SITE: 'site',
        AGE: 'age',
        FAIRSHARE: 'fairshare',
        JOBSIZE: 'jobsize',
        PARTITION: 'partition',
        QOS: 'qos'
    };

    return headerToKeyMap[normalizedHeader] || null;
};

const createEmptyComponents = () => ({
    site: 0,
    age: 0,
    fairshare: 0,
    jobsize: 0,
    partition: 0,
    qos: 0
});

const parseSprioRow = (output, parseValue) => {
    const lines = output
        .trim()
        .split('\n')
        .map(line => line.trim())
        .filter(line => line);

    const headerLine = lines.find(line => line.startsWith('JOBID'));
    const dataLine = lines.find(line => !line.startsWith('JOBID') && !line.startsWith('Weights'));

    // Find the data line (skip header)
    if (!headerLine || !dataLine) {
        throw new Error('No priority data found in sprio output');
    }

    const headerFields = headerLine.split(/\s+/);
    const dataFields = dataLine.split(/\s+/);

    const components = createEmptyComponents();
    const factorHeaders = headerFields.slice(3);
    const factorValues = dataFields.slice(3);

    factorHeaders.forEach((header, index) => {
        const componentKey = getComponentKey(header);
        if (!componentKey) {
            return;
        }

        components[componentKey] = parseValue(factorValues[index]);
    });

    return {
        jobId: dataFields[0],
        partition: dataFields[1],
        priority: parseValue(dataFields[2]),
        components
    };
};

/**
 * Parse sprio output for a specific job
 * @param {string} output - Raw output from sprio command
 * @returns {Object} Parsed priority components
 */
const parseSprioOutput = (output) => {
    // Default sprio output columns are weighted component contributions.
    return parseSprioRow(output, parseIntOrZero);
};

/**
 * Parse sprio normalized output for a specific job
 * @param {string} output - Raw output from sprio -n command
 * @returns {Object} Parsed normalized priority components
 */
const parseSprioNormalizedOutput = (output) => {
    // sprio -n columns are normalized factors in floating-point form.
    return parseSprioRow(output, parseFloatOrZero);
};

/**
 * Parse sprio weights output
 * @param {string} output - Raw output from sprio -w command
 * @returns {Object} Priority weights configuration
 */
const parseSprioWeights = (output) => {
    const lines = output
        .trim()
        .split('\n')
        .map(line => line.trim())
        .filter(line => line);

    const headerLine = lines.find(line => line.startsWith('JOBID'));
    const dataLine = lines.find(line => line.startsWith('Weights'));

    if (!headerLine || !dataLine) {
        throw new Error('No weights data found in sprio output');
    }

    const headerFields = headerLine.split(/\s+/);
    const dataFields = dataLine.split(/\s+/);
    const weights = createEmptyComponents();

    const factorHeaders = headerFields.slice(3);

    factorHeaders.forEach((header, index) => {
        const componentKey = getComponentKey(header);
        if (!componentKey) {
            return;
        }

        weights[componentKey] = parseInt(dataFields[index + 1], 10) || 0;
    });

    return weights;
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

        const normalizedCmd = createSafeCommand('sprio', ['-n', '-j', jobId]);
        const normalizedOutput = executeCommand(normalizedCmd);
        const normalizedData = parseSprioNormalizedOutput(normalizedOutput);

        return {
            ...priorityData,
            normalizedComponents: normalizedData.components,
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
 * Calculate contribution percentage of each priority component.
 * Components from default sprio output are already weighted values.
 * @param {Object} components - Weighted priority components
 * @returns {Object} Percentage contributions
 */
const calculateContributions = (components) => {
    const contributions = {};
    const total = Object.keys(components).reduce((sum, key) => {
        return sum + (components[key] || 0);
    }, 0);

    if (total === 0) {
        return Object.keys(components).reduce((acc, key) => {
            acc[key] = 0;
            return acc;
        }, {});
    }

    Object.keys(components).forEach(key => {
        const weightedValue = components[key] || 0;
        contributions[key] = ((weightedValue / total) * 100).toFixed(1);
    });

    return contributions;
};

module.exports = {
    parseSprioOutput,
    parseSprioNormalizedOutput,
    parseSprioWeights,
    getJobPriority,
    parseCompetingJobs,
    getCompetingJobs,
    getRunningJobsCount,
    calculateContributions
};
