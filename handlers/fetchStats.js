const { executeCommand, executeCommandStreaming } = require("../helpers/executeCmd.js");
const { validatePartitionName, createSafeCommand } = require("../helpers/inputValidation");
const dataCache = require("../modules/dataCache.js");

// Fetches the number of CPUs by state
function getCPUsByState(partition = null) {
    const key = `stats:cpu:${partition || 'all'}`;
    const cached = dataCache.cache.get(key);
    if (cached) {
        console.log(`[Stats Handler] Using cached CPU stats for ${partition || 'all'}`);
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
        
        const result = { allocated, idle, other, total };
        dataCache.cache.set(key, result, 5);
        return result;
    } catch (error) {
        console.error('Error in getCPUsByState:', error.message);
        return { allocated: 0, idle: 0, other: 0, total: 0 };
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
                if (nodeState.includes("DOWN") || nodeState.includes("DRAIN")) {
                    distribution.down += realMem;
                } else {
                    distribution.allocated += allocMem;
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

            const gresMatch = line.match(/Gres=([^\s]+)/);
            if (gresMatch) {
                const gresString = gresMatch[1];
                let match;
                // Loop through all gpu entries in the gres string (e.g., "gpu:a100:8,gpu:v100:4")
                while ((match = gresRegex.exec(gresString)) !== null) {
                    const gpuType = match[1];
                    const count = Number(match[2]);
                    gpuTotals[gpuType] = (gpuTotals[gpuType] || 0) + count;
                }
            }
        });

        // Get Used GPUs from sinfo
        let usedGPUsOutput = "";
        try {
            let sinfoArgs = ['-h', '-O', 'GresUsed'];
            
            // Validate and add partition parameter if provided
            if (partition) {
                const validatedPartition = validatePartitionName(partition);
                sinfoArgs.unshift('-p', validatedPartition);
            }
            
            const sinfoCommand = createSafeCommand('sinfo', sinfoArgs);
            // Note: We can't easily make the grep commands safe with createSafeCommand since they're piped
            // Instead, we'll get the raw output and filter in JavaScript
            const rawOutput = executeCommand(sinfoCommand);
            
            // Filter the output in JavaScript instead of using shell pipes
            usedGPUsOutput = rawOutput
                .split('\n')
                .filter(line => line.trim() && !line.includes('(null)') && line.includes('gpu'))
                .join('\n');
        } catch (error) {
            // Command can fail if no GPUs are in use or partition has no GPUs - this is expected
            console.log(`No GPU usage found for partition ${partition || 'all'}: ${error.message}`);
            usedGPUsOutput = "";
        }
        const usedLines = usedGPUsOutput.trim() ? usedGPUsOutput.trim().split("\n") : []; // Handle empty output safely

        const gpuUsed = {};
        const usedRegex = /gpu:([^:(]+):(\d+)/g;

        usedLines.forEach(line => {
            let match;
            while ((match = usedRegex.exec(line)) !== null) {
                const gpuType = match[1];
                const count = Number(match[2]);
                gpuUsed[gpuType] = (gpuUsed[gpuType] || 0) + count;
            }
        });

        // combine totals and used
        const gpuTypes = {};
        Object.keys(gpuTotals).forEach(gpuType => {
            gpuTypes[gpuType] = {
                total: gpuTotals[gpuType],
                used: gpuUsed[gpuType] || 0, // Default to 0 if no GPUs of this type are currently in use.
            };
        });

        // Calculate total GPU count
        const totalGPUCount = Object.values(gpuTotals).reduce((sum, count) => sum + count, 0);

        // genreate response
        const gpuStats = {
            name: "GPU Utilization",
            children: [{ name: "Used", children: [] }, { name: "Available", children: [] }],
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

            if (used > 0) {
                gpuStats.children[0].children.push({ name: gpuType, value: used });
            }
            if (available > 0) {
                gpuStats.children[1].children.push({ name: gpuType, value: available });
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