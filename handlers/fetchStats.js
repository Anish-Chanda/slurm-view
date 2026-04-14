const { executeCommand, executeCommandStreaming } = require("../helpers/executeCmd.js");
const { validatePartitionName, createSafeCommand } = require("../helpers/inputValidation");
const dataCache = require("../modules/dataCache.js");
const { getRuntimeConfig } = require("../modules/runtimeConfig.js");

const UNAVAILABLE_NODE_STATE_TOKENS = [
    "DOWN",
    "DRAIN",
    "NOT_RESPONDING",
    "POWERED_DOWN",
    "POWERING_DOWN",
    "FAIL",
    "FAILING",
    "UNKNOWN"
];

const isNodeUnavailable = (nodeState = "") => {
    const normalizedState = nodeState.toUpperCase();
    return UNAVAILABLE_NODE_STATE_TOKENS.some(token => normalizedState.includes(token));
};

const isNodeDownState = (nodeState = "") => {
    const normalizedState = nodeState.toUpperCase();
    return normalizedState.includes("DOWN") || normalizedState.includes("DRAIN");
};

const getAllocatedMemoryInUse = (realMem, allocMem, freeMem) => {
    const usedByOs = Math.max(0, realMem - freeMem);
    return Math.min(allocMem, usedByOs);
};

const isNodeAllocatedLike = (nodeState = "") => {
    const normalizedState = nodeState.toUpperCase();
    return normalizedState.includes("ALLOCATED") || normalizedState.includes("MIXED");
};

const buildEvenCpuDistribution = (totalAllocCpus, nodeCount) => {
    if (!Number.isFinite(totalAllocCpus) || totalAllocCpus <= 0 || nodeCount <= 0) {
        return [];
    }

    if (!Number.isInteger(totalAllocCpus)) {
        return Array(nodeCount).fill(totalAllocCpus / nodeCount);
    }

    const baseShare = Math.floor(totalAllocCpus / nodeCount);
    const remainder = totalAllocCpus - (baseShare * nodeCount);
    const distribution = Array(nodeCount).fill(baseShare);

    for (let i = 0; i < remainder; i += 1) {
        distribution[i] += 1;
    }

    return distribution;
};

const expandNodeListExpression = (nodeListExpression, expansionCache = new Map()) => {
    if (!nodeListExpression || typeof nodeListExpression !== 'string' || nodeListExpression === 'N/A') {
        return [];
    }

    const trimmedExpression = nodeListExpression.trim();
    if (!trimmedExpression) {
        return [];
    }

    if (expansionCache.has(trimmedExpression)) {
        return expansionCache.get(trimmedExpression);
    }

    let nodeNames = [];

    if (trimmedExpression.includes('[') || trimmedExpression.includes(']')) {
        try {
            const safeCommand = createSafeCommand('scontrol', ['show', 'hostnames', trimmedExpression]);
            const commandOutput = executeCommand(safeCommand);
            nodeNames = commandOutput
                .split('\n')
                .map((nodeName) => nodeName.trim())
                .filter(Boolean);
        } catch (error) {
            console.error(`[Stats Handler] Failed to expand node list '${trimmedExpression}': ${error.message}`);
            nodeNames = [];
        }
    } else {
        nodeNames = trimmedExpression
            .split(',')
            .map((nodeName) => nodeName.trim())
            .filter(Boolean);
    }

    expansionCache.set(trimmedExpression, nodeNames);
    return nodeNames;
};

const getNodeCpuAllocationsForJob = (job, nodeNames) => {
    if (!Array.isArray(nodeNames) || nodeNames.length === 0) {
        return [];
    }

    const explicitAllocations = Array.isArray(job.per_node_cpu_allocations)
        ? job.per_node_cpu_allocations
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value >= 0)
        : [];

    if (explicitAllocations.length === nodeNames.length && explicitAllocations.length > 0) {
        return explicitAllocations;
    }

    if (explicitAllocations.length === 1 && nodeNames.length > 1) {
        return Array(nodeNames.length).fill(explicitAllocations[0]);
    }

    const totalAllocatedCpus = Number(job.alloc_cpus);
    if (!Number.isFinite(totalAllocatedCpus) || totalAllocatedCpus <= 0) {
        return [];
    }

    return buildEvenCpuDistribution(totalAllocatedCpus, nodeNames.length);
};

const buildAllocatedCpuMapByNode = (partition = null) => {
    const jobsData = dataCache.getData('jobs');
    const allocationByNode = {};
    const expansionCache = new Map();
    const validatedPartition = partition ? validatePartitionName(partition) : null;

    if (!jobsData || !Array.isArray(jobsData.jobs)) {
        return allocationByNode;
    }

    jobsData.jobs.forEach((job) => {
        if (job.job_state !== 'RUNNING') return;
        if (validatedPartition && job.partition !== validatedPartition) return;

        let nodeNames = Array.isArray(job.node_names)
            ? job.node_names
                .map((nodeName) => String(nodeName || '').trim())
                .filter(Boolean)
            : [];

        if (nodeNames.length === 0 && typeof job.node_list === 'string') {
            nodeNames = expandNodeListExpression(job.node_list, expansionCache);
        }

        if (nodeNames.length === 0) return;

        const nodeAllocations = getNodeCpuAllocationsForJob(job, nodeNames);
        if (nodeAllocations.length === 0) return;

        nodeNames.forEach((nodeName, index) => {
            const allocation = Number(nodeAllocations[index]);
            if (!Number.isFinite(allocation) || allocation <= 0) {
                return;
            }

            allocationByNode[nodeName] = (allocationByNode[nodeName] || 0) + allocation;
        });
    });

    return allocationByNode;
};

const getNodeCpuLoadByNode = (partition = null) => {
    const safeCommand = createSafeCommand('scontrol', ['show', 'node', '-o']);
    const commandOutput = executeCommand(safeCommand);
    const lines = commandOutput.trim().split('\n');
    const validatedPartition = partition ? validatePartitionName(partition) : null;
    const nodeLoadByName = {};

    lines.forEach((line) => {
        if (!line.trim()) return;

        if (validatedPartition) {
            const partitionMatch = line.match(/Partitions=([^\s]+)/);
            if (!partitionMatch || !partitionMatch[1].split(',').includes(validatedPartition)) {
                return;
            }
        }

        const stateMatch = line.match(/State=(\S+)/);
        const nodeState = stateMatch ? stateMatch[1] : '';
        if (!isNodeAllocatedLike(nodeState)) {
            return;
        }

        const nodeNameMatch = line.match(/NodeName=(\S+)/);
        const cpuLoadMatch = line.match(/CPULoad=([^\s]+)/);

        if (!nodeNameMatch || !cpuLoadMatch) {
            return;
        }

        const parsedCpuLoad = Number(cpuLoadMatch[1]);
        if (!Number.isFinite(parsedCpuLoad) || parsedCpuLoad < 0) {
            return;
        }

        nodeLoadByName[nodeNameMatch[1]] = parsedCpuLoad;
    });

    return nodeLoadByName;
};

const classifyCpuLoadBucket = (normalizedLoadRatio, thresholds) => {
    if (normalizedLoadRatio < thresholds.lowMax) {
        return 'low';
    }

    if (normalizedLoadRatio <= thresholds.mediumMax) {
        return 'medium';
    }

    return 'high';
};

const getCpuLoadGroups = (partition = null, totalAllocatedCpus = 0) => {
    const emptyGroups = { low: 0, medium: 0, high: 0 };

    if (!Number.isFinite(totalAllocatedCpus) || totalAllocatedCpus <= 0) {
        return emptyGroups;
    }

    try {
        const config = getRuntimeConfig();
        const thresholds = config.stats.cpuLoad.thresholds;
        const allocatedCpuByNode = buildAllocatedCpuMapByNode(partition);
        const nodeCpuLoadByName = getNodeCpuLoadByNode(partition);

        const groupedAllocation = { low: 0, medium: 0, high: 0 };

        Object.entries(allocatedCpuByNode).forEach(([nodeName, allocatedCpus]) => {
            if (!Number.isFinite(allocatedCpus) || allocatedCpus <= 0) {
                return;
            }

            const nodeCpuLoad = nodeCpuLoadByName[nodeName];
            if (!Number.isFinite(nodeCpuLoad)) {
                return;
            }

            const normalizedLoadRatio = nodeCpuLoad / allocatedCpus;
            const bucket = classifyCpuLoadBucket(normalizedLoadRatio, thresholds);
            groupedAllocation[bucket] += allocatedCpus;
        });

        const classifiedTotal = groupedAllocation.low + groupedAllocation.medium + groupedAllocation.high;
        const remainingAllocation = Math.max(0, totalAllocatedCpus - classifiedTotal);
        groupedAllocation.medium += remainingAllocation;

        return groupedAllocation;
    } catch (error) {
        console.error(`[Stats Handler] Failed CPU load bucket calculation: ${error.message}`);
        return { low: 0, medium: totalAllocatedCpus, high: 0 };
    }
};

// Fetches the number of CPUs by state
function getCPUsByState(partition = null) {
    const key = `stats:cpu:${partition || 'all'}`;
    const cached = dataCache.cache.get(key);
    if (cached) {
        console.log(`[Stats Handler] Using cached CPU stats for ${partition || 'all'}`);
        if (!cached.loadGroups) {
            return {
                ...cached,
                loadGroups: {
                    low: 0,
                    medium: Number(cached.allocated) || 0,
                    high: 0
                }
            };
        }
        return cached;
    }

    try {
        let cmdArgs = ['-o', '%C', '--noheader'];
        
        // Validate and add partition parameter if provided
        if (partition) {
            const validatedPartition = validatePartitionName(partition);
            cmdArgs.unshift('-p', validatedPartition);
        }
        
        const safeCommand = createSafeCommand('sinfo', cmdArgs);
        const cmdOutput = executeCommand(safeCommand); // returns cpu utilization in Allocated/Idle/Other/Total
        const parts = cmdOutput.split('/').map(val => {
            const num = Number(val);
            return isNaN(num) ? 0 : num;
        });
        
        const allocated = parts[0] || 0;
        const idle = parts[1] || 0;
        const other = parts[2] || 0;
        const total = parts[3] || 0;
        const loadGroups = getCpuLoadGroups(partition, allocated);
        
        const result = { allocated, idle, other, total, loadGroups };
        dataCache.cache.set(key, result, 5);
        return result;
    } catch (error) {
        console.error('Error in getCPUsByState:', error.message);
        return { allocated: 0, idle: 0, other: 0, total: 0, loadGroups: { low: 0, medium: 0, high: 0 } };
    }
}

function getMemByState(partition = null) {
    const key = `stats:mem:${partition || 'all'}`;
    const cached = dataCache.cache.get(key);
    if (cached) {
        console.log(`[Stats Handler] Using cached Memory stats for ${partition || 'all'}`);
        return cached;
    }

    try {
        const safeCommand = createSafeCommand('scontrol', ['show', 'node', '-o']);
        const cmdOutput = executeCommand(safeCommand);
        const lines = cmdOutput.trim().split("\n");

        let distribution = {
            allocated: 0,
            allocatedUsed: 0,
            idle: 0,
            down: 0,
            other: 0,
            total: 0
        }

        lines.forEach((line) => {
            if (!line.trim()) return;

            //check if node belongs to current partition
            if (partition) {
                // Validate partition name before using it in comparison
                const validatedPartition = validatePartitionName(partition);
                const partitionMatch = line.match(/Partitions=([^\s]+)/);
                if (!partitionMatch || !partitionMatch[1].split(',').includes(validatedPartition)) {
                    return; // Skip this node if it's not in the requested partition
                }
            }

            //extract mem info
            const realMemMatch = line.match(/RealMemory=(\d+)/);
            const allocMemMatch = line.match(/AllocMem=(\d+)/);
            const freeMemMatch = line.match(/FreeMem=(\d+)/);
            const stateMatch = line.match(/State=(\S+)/);

            if (realMemMatch && stateMatch) {
                const nodeState = stateMatch[1].toUpperCase();
                const realMem = parseInt(realMemMatch[1], 10);
                const allocMem = allocMemMatch ? parseInt(allocMemMatch[1], 10) : 0;
                const freeMem = freeMemMatch ? parseInt(freeMemMatch[1], 10) : 0;

                // Add to total memory
                distribution.total += realMem;

                // Categorize memory based on node state
                if (isNodeUnavailable(nodeState)) {
                    distribution.down += realMem;
                } else {
                    distribution.allocated += allocMem;
                    distribution.allocatedUsed += getAllocatedMemoryInUse(realMem, allocMem, freeMem);
                    distribution.idle += freeMem;

                    // Calculate other memory (difference between total, allocated and free)
                    const otherMem = Math.max(0, realMem - allocMem - freeMem);
                    distribution.other += otherMem;
                }
            }
        });

        //convert memory in MB to GB
        Object.keys(distribution).forEach(key => {
            distribution[key] = parseFloat((distribution[key] / 1024).toFixed(2));
        });
        
        dataCache.cache.set(key, distribution, 5);
        return distribution;
    } catch (error) {
        console.error('Error in getMemByState:', error.message);
        return {
            allocated: 0,
            allocatedUsed: 0,
            idle: 0,
            down: 0,
            other: 0,
            total: 0
        };
    }
}

async function getGPUByState(partition = null) {
    const key = `stats:gpu:${partition || 'all'}`;
    const cached = dataCache.cache.get(key);
    if (cached) {
        console.log(`[Stats Handler] Using cached GPU stats for ${partition || 'all'}`);
        return cached;
    }

    try {
        // Get Total GPUs from scontrol
        const scontrolSafeCommand = createSafeCommand('scontrol', ['show', 'node', '-o']);
        const scontrolOutput = await executeCommandStreaming(scontrolSafeCommand);
        const nodeLines = scontrolOutput.trim().split("\n");

        const gpuTotals = {};
        const gpuDownTotals = {};
        const gpuUnknownTotals = {};
        const gresRegex = /gpu:([^:]+):(\d+)/g;

        nodeLines.forEach(line => {
            if (!line.trim()) return;

            // If a partition is specified, filter nodes by checking their Partitions list.
            if (partition) {
                // Validate partition name before using it in comparison
                const validatedPartition = validatePartitionName(partition);
                const partitionMatch = line.match(/Partitions=([^\s]+)/);
                // Skip this node if it doesn't belong to the requested partition.
                if (!partitionMatch || !partitionMatch[1].split(',').includes(validatedPartition)) {
                    return;
                }
            }

            const stateMatch = line.match(/State=(\S+)/);
            const nodeState = stateMatch ? stateMatch[1] : "";

            const gresMatch = line.match(/Gres=([^\s]+)/);
            if (gresMatch) {
                const gresString = gresMatch[1];
                gresRegex.lastIndex = 0;
                let match;
                // Loop through all gpu entries in the gres string (e.g., "gpu:a100:8,gpu:v100:4")
                while ((match = gresRegex.exec(gresString)) !== null) {
                    const gpuType = match[1];
                    const count = Number(match[2]);
                    if (isNodeUnavailable(nodeState)) {
                        if (isNodeDownState(nodeState)) {
                            gpuDownTotals[gpuType] = (gpuDownTotals[gpuType] || 0) + count;
                        } else {
                            gpuUnknownTotals[gpuType] = (gpuUnknownTotals[gpuType] || 0) + count;
                        }
                    } else {
                        gpuTotals[gpuType] = (gpuTotals[gpuType] || 0) + count;
                    }
                }
            }
        });

        // Get Used GPUs from cached jobs data
        const gpuUsed = {};
        const jobsData = dataCache.getData('jobs');
        
        if (jobsData && jobsData.jobs) {
            // Filter for RUNNING jobs and optionally by partition
            const runningJobs = jobsData.jobs.filter(job => {
                if (job.job_state !== 'RUNNING') return false;
                
                // If partition filter is specified, check if job is in that partition
                if (partition) {
                    const validatedPartition = validatePartitionName(partition);
                    return job.partition === validatedPartition;
                }
                
                return true;
            });

            // Aggregate GPU usage from running jobs
            runningJobs.forEach(job => {
                if (job.gpu_allocations && job.gpu_allocations.types) {
                    Object.entries(job.gpu_allocations.types).forEach(([gpuType, count]) => {
                        gpuUsed[gpuType] = (gpuUsed[gpuType] || 0) + count;
                    });
                }
            });
            
            console.log(`[Stats Handler] Calculated GPU usage from ${runningJobs.length} running jobs in cache`);
        } else {
            console.log(`[Stats Handler] No cached jobs data available, GPU used will be 0`);
        }

        // combine totals and used
        const gpuTypes = {};
        const allGpuTypes = new Set([
            ...Object.keys(gpuTotals),
            ...Object.keys(gpuDownTotals),
            ...Object.keys(gpuUnknownTotals),
            ...Object.keys(gpuUsed)
        ]);

        allGpuTypes.forEach(gpuType => {
            gpuTypes[gpuType] = {
                total: gpuTotals[gpuType] || 0,
                down: gpuDownTotals[gpuType] || 0,
                unknown: gpuUnknownTotals[gpuType] || 0,
                used: gpuUsed[gpuType] || 0, // Default to 0 if no GPUs of this type are currently in use.
            };
        });

        // Calculate total GPU count (available + unavailable nodes)
        const totalGPUCount = Object.values(gpuTypes).reduce((sum, typeData) => {
            return sum + typeData.total + typeData.down + typeData.unknown;
        }, 0);

        // genreate response
        const gpuStats = {
            name: "GPU Utilization",
            children: [
                { name: "Used", children: [] },
                { name: "Available", children: [] },
                { name: "Down", children: [] },
                { name: "Unknown", children: [] }
            ],
            totalGPUs: totalGPUCount
        };

        // Handle zero GPU case - add a special child to show "allocated" color
        if (totalGPUCount === 0) {
            gpuStats.children = [{ name: "No GPUs", value: 1, children: [] }];
            dataCache.cache.set(key, gpuStats, 5);
            return gpuStats;
        }

        Object.keys(gpuTypes).forEach(gpuType => {
            const typeData = gpuTypes[gpuType];
            const used = typeData.used;
            // Ensure 'available' is not negative due to any transient mis-sync in Slurm states.
            const available = Math.max(0, typeData.total - used);
            const down = Math.max(0, typeData.down);
            const unknown = Math.max(0, typeData.unknown);

            if (used > 0) {
                gpuStats.children[0].children.push({ name: gpuType, value: used });
            }
            if (available > 0) {
                gpuStats.children[1].children.push({ name: gpuType, value: available });
            }
            if (down > 0) {
                gpuStats.children[2].children.push({ name: gpuType, value: down });
            }
            if (unknown > 0) {
                gpuStats.children[3].children.push({ name: gpuType, value: unknown });
            }
        });

        dataCache.cache.set(key, gpuStats, 5);
        return gpuStats;

    } catch (error) {
        console.error('Error in getGPUByState:', error.message);
        // Return a consistent error structure for the frontend to handle.
        return {
            name: "GPU Utilization",
            children: [{ name: "Error", value: 1, message: error.message }],
            totalGPUs: 0
        };
    }
}

module.exports = {
    getCPUsByState,
    getMemByState,
    getGPUByState
}