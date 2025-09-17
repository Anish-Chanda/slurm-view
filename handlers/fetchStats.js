const { executeCommand, executeCommandStreaming } = require("../helpers/executeCmd.js");

// Fetches the number of CPUs by state
function getCPUsByState(partition = null) {
    try {
        const partitionFlag = partition ? `-p ${partition}` : '';
        const cmdOutput = executeCommand(`sinfo ${partitionFlag} -o '%C' --noheader`) // returns cpu utilization in Allocated/Idle/Other/Total
        const [allocated, idle, other, total] = cmdOutput.split('/').map(Number);
        return { allocated, idle, other, total };
    } catch (error) {
        console.error('Error in getCPUsByState:', error.message);
        return { allocated: 0, idle: 0, other: 0, total: 0 };
    }
}

function getMemByState(partition = null) {
    try {
        const cmdOutput = executeCommand(`scontrol show node -o`);
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
                const partitionMatch = line.match(/Partitions=([^\s]+)/);
                if (!partitionMatch || !partitionMatch[1].split(',').includes(partition)) {
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
            distribution[key] = (distribution[key] / 1024).toFixed(2);
        });
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
    try {
        const partitionFlag = partition ? `-p ${partition}` : '';

        // Get Total GPUs from scontrol
        const scontrolOutput = await executeCommandStreaming('scontrol show node -o');
        const nodeLines = scontrolOutput.trim().split("\n");

        const gpuTotals = {};
        const gresRegex = /gpu:([^:]+):(\d+)/g;

        nodeLines.forEach(line => {
            if (!line.trim()) return;

            // If a partition is specified, filter nodes by checking their Partitions list.
            if (partition) {
                const partitionMatch = line.match(/Partitions=([^\s]+)/);
                // Skip this node if it doesn't belong to the requested partition.
                if (!partitionMatch || !partitionMatch[1].split(',').includes(partition)) {
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
            usedGPUsOutput = executeCommand(`sinfo ${partitionFlag} -h -O GresUsed | grep -v '(null)' | grep gpu`);
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