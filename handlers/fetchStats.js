const { executeCommand } = require("../helpers/executeCmd.js");

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
            if(!line.trim()) return;

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

function getGPUByState(partition = null) {
    try {
        const partitionFlag = partition ? `-p ${partition}` : '';
        const availableGPUsOutput = executeCommand(`sinfo ${partitionFlag} -h -O Gres | grep -v '(null)' | grep gpu`);
        const usedGPUsOutput = executeCommand(`sinfo ${partitionFlag} -h -O GresUsed | grep -v '(null)' | grep gpu`);

        // Parse available GPUs
        const gpuTypes = {};
        let totalGPUs = 0;
        let totalUsed = 0;
        
        const availableLines = availableGPUsOutput.trim().split("\n");

        availableLines.forEach(line => {
            // Extract GPU type and count
            const match = line.match(/gpu:([^:(]+)(?:[^:]*):(\d+)/);
            if (match) {
                const gpuType = match[1].trim();
                const count = parseInt(match[2], 10);
                
                if (!gpuTypes[gpuType]) {
                    gpuTypes[gpuType] = { total: 0, used: 0 };
                }
                
                gpuTypes[gpuType].total += count;
                totalGPUs += count;
            }
        });

        // Parse used GPUs
        const usedLines = usedGPUsOutput.trim().split("\n");
        
        usedLines.forEach(line => {
            const match = line.match(/gpu:([^:(]+)(?:[^:]*):(\d+)/);
            if (match) {
                const gpuType = match[1].trim();
                const usedCount = parseInt(match[2], 10);
                
                if (gpuTypes[gpuType]) {
                    gpuTypes[gpuType].used += usedCount;
                    totalUsed += usedCount;
                }
            }
        });

        // Create hierarchical structure with Used/Available as first level
        // and GPU types as second level
        const gpuStats = {
            name: "GPU Utilization",
            children: [
                {
                    name: "Used",
                    children: []
                },
                {
                    name: "Available",
                    children: []
                }
            ]
        };
        
        // Add GPU types as second level
        Object.keys(gpuTypes).forEach(gpuType => {
            const typeData = gpuTypes[gpuType];
            const used = typeData.used;
            const available = typeData.total - typeData.used;
            
            // Add to Used category if there are used GPUs of this type
            if (used > 0) {
                gpuStats.children[0].children.push({
                    name: gpuType,
                    value: used
                });
            }
            
            // Add to Available category if there are available GPUs of this type
            if (available > 0) {
                gpuStats.children[1].children.push({
                    name: gpuType,
                    value: available
                });
            }
        });
        
        return gpuStats;

    } catch (error) {
        console.error('Error in getGPUByState:', error.message);
        return {
            name: "GPU Utilization",
            children: [
                { name: "Error", value: 1 }
            ]
        };
    }
}

module.exports = {
    getCPUsByState,
    getMemByState,
    getGPUByState
}