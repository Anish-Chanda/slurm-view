const { executeCommand } = require("../helpers/executeCmd");
const { createSafeCommand, validatePartitionName } = require("../helpers/inputValidation");
const { parseTres, checkResources } = require("../helpers/tresUtils");
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
        
        if (jobData.Reason !== 'Resources') {
            return { type: 'Other', message: `Pending reason: ${jobData.Reason}` };
        }

        // Identify Target Nodes
        let targetNodes = [];
        let scope = 'Partition';

        if (jobData.SchedNodeList && jobData.SchedNodeList !== '(null)') {
            targetNodes = [jobData.SchedNodeList]; // Simplified: assume single node or list string
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
        // If targetNodes contains ranges (e.g. node[1-5]), scontrol handles it.
        const nodesCmdArgs = ['show', 'node', targetNodes.join(',')];
        const nodesCmd = createSafeCommand('scontrol', nodesCmdArgs);
        const nodesOutput = executeCommand(nodesCmd);
        
        const nodesAnalysis = analyzeNodes(nodesOutput, jobData.ReqTRES);

        const result = {
            type: 'Resources',
            scope: scope,
            jobId: jobId,
            reqTres: jobData.ReqTRES,
            summary: summarizeAnalysis(nodesAnalysis, targetNodes.length),
            details: nodesAnalysis // Detailed breakdown
        };

        // Cache result (short TTL as resources change)
        dataCache.setPendingReason(jobId, result);
        
        return result;

    } catch (error) {
        console.error(`Error fetching pending reason for job ${jobId}:`, error.message);
        return { type: 'Error', message: error.message };
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
