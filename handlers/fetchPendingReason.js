const { executeCommand } = require("../helpers/executeCmd");
const { createSafeCommand, validatePartitionName } = require("../helpers/inputValidation");
const { parseTres, checkResources } = require("../helpers/tresUtils");
const { 
    getJobPriority, 
    getCompetingJobs, 
    getRunningJobsCount,
    calculateContributions 
} = require("../helpers/priorityUtils");
const dataCache = require("../modules/dataCache");

const getPendingReason = async (jobId) => {
    // Check cache first
    const cached = dataCache.getPendingReason(jobId);
    if (cached) return cached;

    try {
        // Fetch Job Details
        const jobCmd = createSafeCommand('scontrol', ['show', 'job', jobId]);
        const jobOutput = executeCommand(jobCmd);
        
        const jobData = parseJobData(jobOutput);
        
        if (jobData.JobState !== 'PENDING') {
            return { type: 'Status', message: `Job is ${jobData.JobState}` };
        }
        
        // Route to appropriate handler based on pending reason
        let result;
        if (jobData.Reason === 'Resources') {
            result = analyzeResourcesPending(jobId, jobData);
        } else if (jobData.Reason === 'Priority') {
            result = analyzePriorityPending(jobId, jobData);
        } else {
            result = { type: 'Other', message: `Pending reason: ${jobData.Reason}` };
        }

        // Cache result (short TTL as resources/priorities change)
        dataCache.setPendingReason(jobId, result);
        
        return result;

    } catch (error) {
        console.error(`Error fetching pending reason for job ${jobId}:`, error.message);
        return { type: 'Error', message: error.message };
    }
};

/**
 * Analyze a job pending due to resources
 * @param {string} jobId - Job ID
 * @param {Object} jobData - Parsed job data from scontrol
 * @returns {Object} Resources analysis result
 */
const analyzeResourcesPending = (jobId, jobData) => {
    // Identify Target Nodes
    let targetNodes = [];
    let scope = 'Partition';

    if (jobData.SchedNodeList && jobData.SchedNodeList !== '(null)') {
        targetNodes = [jobData.SchedNodeList];
        scope = 'Scheduled Node';
    } else if (jobData.ReqNodeList && jobData.ReqNodeList !== '(null)') {
        targetNodes = [jobData.ReqNodeList];
        scope = 'Requested Node';
    } else {
        // Fetch all nodes in partition
        const partCmd = createSafeCommand('sinfo', ['-p', jobData.Partition, '-h', '-o', '%N']);
        const partOutput = executeCommand(partCmd);
        targetNodes = partOutput.trim().split(',').filter(n => n);
    }

    // Analyze Nodes       
    const nodesCmdArgs = ['show', 'node', targetNodes.join(',')];
    const nodesCmd = createSafeCommand('scontrol', nodesCmdArgs);
    const nodesOutput = executeCommand(nodesCmd);
    
    const nodesAnalysis = analyzeNodes(nodesOutput, jobData.ReqTRES);

    return {
        type: 'Resources',
        scope: scope,
        jobId: jobId,
        reqTres: jobData.ReqTRES,
        summary: summarizeAnalysis(nodesAnalysis, targetNodes.length),
        details: nodesAnalysis
    };
};

/**
 * Analyze a job pending due to priority
 * @param {string} jobId - Job ID
 * @param {Object} jobData - Parsed job data from scontrol
 * @returns {Object} Priority analysis result
 */
const analyzePriorityPending = (jobId, jobData) => {
    try {
        // Get job priority breakdown
        const priorityData = getJobPriority(jobId);
        
        // Get competing jobs (limit to 5)
        const competition = getCompetingJobs(jobData.Partition, priorityData.priority, 5);
        
        // Get running jobs count
        const runningCount = getRunningJobsCount(jobData.Partition);
        
        // Calculate percentage contributions
        const contributions = calculateContributions(
            priorityData.components, 
            priorityData.weights
        );

        // Calculate estimated position in queue
        const queuePosition = competition.higherPriorityCount + 1;

        return {
            type: 'Priority',
            jobId: jobId,
            partition: jobData.Partition,
            priority: {
                total: priorityData.priority,
                components: priorityData.components,
                weights: priorityData.weights,
                contributions: contributions
            },
            competition: {
                higherPriorityCount: competition.higherPriorityCount,
                topCompetitors: competition.competitors,
                totalPending: competition.totalPending,
                runningJobs: runningCount
            },
            queuePosition: queuePosition
        };
    } catch (error) {
        console.error(`Error analyzing priority for job ${jobId}:`, error.message);
        // Fallback to simple message if priority analysis fails
        return { 
            type: 'Other', 
            message: `Pending reason: Priority (detailed analysis unavailable: ${error.message})` 
        };
    }
};

// Helper to parse scontrol show job output
const parseJobData = (output) => {
    const data = {};
    const lines = output.split('\n');
    
    // Simple parser for key=value pairs
    lines.forEach(line => {
        const pairs = line.trim().split(/\s+/);
        pairs.forEach(pair => {
            const [key, val] = pair.split('=');
            if (key && val) {
                data[key] = val;
            }
        });
    });

    // Extract TRES
    const reqTresMatch = output.match(/ReqTRES=([^\s]+)/);
    if (reqTresMatch) {
        data.ReqTRES = parseTres(reqTresMatch[1]);
    }

    return data;
};

// Helper to analyze node output
const analyzeNodes = (output, reqTres) => {
    const nodes = [];
    const blocks = output.split('\n\n');

    blocks.forEach(block => {
        if (!block.trim()) return;
        
        const nodeNameMatch = block.match(/NodeName=([^\s]+)/);
        const cfgTresMatch = block.match(/CfgTRES=([^\s]+)/);
        const allocTresMatch = block.match(/AllocTRES=([^\s]+)/);
        
        if (!nodeNameMatch) return;

        const name = nodeNameMatch[1];
        const cfg = parseTres(cfgTresMatch ? cfgTresMatch[1] : '');
        const alloc = parseTres(allocTresMatch ? allocTresMatch[1] : '');

        // Calculate Available
        const available = {
            cpu: cfg.cpu - alloc.cpu,
            mem: cfg.mem - alloc.mem,
            gpu: {
                total: cfg.gpu.total - alloc.gpu.total,
                types: {}
            }
        };

        // Calculate GPU types availability
        Object.keys(cfg.gpu.types).forEach(type => {
            const total = cfg.gpu.types[type];
            const used = alloc.gpu.types[type] || 0;
            available.gpu.types[type] = total - used;
        });

        const bottlenecks = checkResources(reqTres, available);

        nodes.push({
            name,
            available,
            bottlenecks,
            isBlocked: bottlenecks.length > 0
        });
    });

    return nodes;
};

const summarizeAnalysis = (nodes, totalNodes) => {
    const blockedNodes = nodes.filter(n => n.isBlocked);
    const freeNodes = nodes.length - blockedNodes.length;
    
    // Count bottlenecks
    const bottleneckCounts = {};
    blockedNodes.forEach(node => {
        node.bottlenecks.forEach(b => {
            bottleneckCounts[b.resource] = (bottleneckCounts[b.resource] || 0) + 1;
        });
    });

    return {
        totalNodesAnalyzed: nodes.length,
        blockedNodes: blockedNodes.length,
        freeNodes: freeNodes,
        bottlenecks: bottleneckCounts
    };
};

module.exports = {
    getPendingReason
};
