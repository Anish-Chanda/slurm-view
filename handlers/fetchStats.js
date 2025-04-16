const { executeCommand } = require("../helpers/executeCmd.js");

// Fetches the number of CPUs by state
function getCPUsByState() {
    try {
        const cmdOutput = executeCommand("sinfo -o '%C' --noheader") // returns cpu utilization in Allocated/Idle/Other/Total
        const [allocated, idle, other, total] = cmdOutput.split('/').map(Number);
        return { allocated, idle, other, total };
    } catch (error) {
        console.error('Error in getCPUsByState:', error.message);
        return `<p>Error retrieving utilization statistics: ${error.message}</p>`;
    }
}

function getMemByState() {
    try {
        const cmdOutput = executeCommand("sinfo -N -o '%m %t' --noheader")
        const lines = cmdOutput.trim().split("\n");
        let distribution = {
            allocated: 0,
            idle: 0,
            down: 0,
            // mix: 0,
            other: 0,
            total: 0
        }

        lines.forEach((line) => {
            if (!line) return;
            const [memStr, state] = line.trim().split(/\s+/);
            const memory = Number(memStr);
            if (state.includes("alloc")) {
                distribution.allocated += memory;
            } else if (state.includes("idle")) {
                distribution.idle += memory;
            } else if (state.includes("down")) {
                distribution.down += memory;
            } else {
                distribution.other += memory;
            }
            distribution.total += memory;
        })

        //convert memory in MB to GB
        Object.keys(distribution).forEach(key => {
            distribution[key] = (distribution[key] / 1024).toFixed(2);
        });
        return distribution;
    } catch (error) {
        console.error('Error in getMemByState:', error.message);
        return `<p>Error retrieving memory statistics: ${error.message}</p>`;
    }
}

module.exports = {
    getCPUsByState,
    getMemByState
}