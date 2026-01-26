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
const { getTresvalue, parseGpuAllocations } = require("../../helpers/getTresValue");

describe("getTresvalue", () => {
    test("should extract cpu value", () => {
        const tres = "cpu=8,mem=30400M,node=1,billing=8";
        expect(getTresvalue(tres, "cpu")).toBe("8");
    });

    test("should extract mem value", () => {
        const tres = "cpu=8,mem=30400M,node=1,billing=8";
        expect(getTresvalue(tres, "mem")).toBe("30400M");
    });

    test("should extract gres/gpu value", () => {
        const tres = "cpu=8,mem=30400M,node=1,billing=8,gres/gpu=8";
        expect(getTresvalue(tres, "gres/gpu")).toBe("8");
    });

    test("should return N/A for missing key", () => {
        const tres = "cpu=8,mem=30400M";
        expect(getTresvalue(tres, "gres/gpu")).toBe("N/A");
    });

    test("should return N/A for null input", () => {
        expect(getTresvalue(null, "cpu")).toBe("N/A");
    });
});

describe("parseGpuAllocations", () => {
    describe("gres_detail array format", () => {
        test("should parse single GPU type from gres_detail", () => {
            const gresDetail = ["gpu:a100:2(IDX:2-3)"];
            const result = parseGpuAllocations(gresDetail);
            
            expect(result.total).toBe(2);
            expect(result.types).toEqual({ a100: 2 });
        });

        test("should parse multiple GPU entries", () => {
            const gresDetail = ["gpu:a100:4(IDX:0-3)", "gpu:v100:2(IDX:0-1)"];
            const result = parseGpuAllocations(gresDetail);
            
            expect(result.total).toBe(6);
            expect(result.types).toEqual({ a100: 4, v100: 2 });
        });

        test("should handle GPU types with hyphens", () => {
            const gresDetail = ["gpu:a100-pcie:1(IDX:0)"];
            const result = parseGpuAllocations(gresDetail);
            
            expect(result.total).toBe(1);
            expect(result.types).toEqual({ "a100-pcie": 1 });
        });

        test("should aggregate same GPU types", () => {
            const gresDetail = ["gpu:a100:2(IDX:0-1)", "gpu:a100:3(IDX:2-4)"];
            const result = parseGpuAllocations(gresDetail);
            
            expect(result.total).toBe(5);
            expect(result.types).toEqual({ a100: 5 });
        });
    });

    describe("tres string format", () => {
        test("should parse GPU types from tres_req_str", () => {
            const tres = "cpu=1,mem=100G,node=1,billing=2,gres/gpu=2,gres/gpu:a100=2";
            const result = parseGpuAllocations(tres);
            
            expect(result.total).toBe(2);
            expect(result.types).toEqual({ a100: 2 });
        });

        test("should parse multiple GPU types from tres string", () => {
            const tres = "cpu=4,mem=200G,gres/gpu=6,gres/gpu:a100=4,gres/gpu:v100=2";
            const result = parseGpuAllocations(tres);
            
            expect(result.total).toBe(6);
            expect(result.types).toEqual({ a100: 4, v100: 2 });
        });

        test("should handle generic gres/gpu without type", () => {
            const tres = "cpu=2,mem=50G,gres/gpu=3";
            const result = parseGpuAllocations(tres);
            
            expect(result.total).toBe(3);
            expect(result.types).toEqual({ unknown: 3 });
        });

        test("should handle GPU types with special characters", () => {
            const tres = "cpu=1,gres/gpu:v100-sxm2-32G=1";
            const result = parseGpuAllocations(tres);
            
            expect(result.total).toBe(1);
            expect(result.types).toEqual({ "v100-sxm2-32G": 1 });
        });
    });

    describe("edge cases", () => {
        test("should return zero for null input", () => {
            const result = parseGpuAllocations(null);
            
            expect(result.total).toBe(0);
            expect(result.types).toEqual({});
        });

        test("should return zero for undefined input", () => {
            const result = parseGpuAllocations(undefined);
            
            expect(result.total).toBe(0);
            expect(result.types).toEqual({});
        });

        test("should return zero for empty array", () => {
            const result = parseGpuAllocations([]);
            
            expect(result.total).toBe(0);
            expect(result.types).toEqual({});
        });

        test("should return zero for empty string", () => {
            const result = parseGpuAllocations("");
            
            expect(result.total).toBe(0);
            expect(result.types).toEqual({});
        });

        test("should handle malformed gres_detail entries", () => {
            const gresDetail = ["invalid:entry", "gpu:a100:2(IDX:0-1)"];
            const result = parseGpuAllocations(gresDetail);
            
            expect(result.total).toBe(2);
            expect(result.types).toEqual({ a100: 2 });
        });
    });
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