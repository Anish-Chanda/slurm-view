const { executeCommand } = require("../helpers/executeCmd.js");

// Fetches the number of CPUs by state
function getCPUsByState() {
    try {
        const cmdOutput = executeCommand("sinfo -o '%C' --noheader") // returns cpu utilization in Allocated/Idle/Other/Total
        const [allocated, idle, other, total] = cmdOutput.split('/').map(Number);
        return { allocated, idle, other, total };
    } catch (error) {
        console.error('Error in getCPUsByState:', err.message);
        return `<p>Error retrieving utilization statistics: ${err.message}</p>`;
    }
}

module.exports = {
    getCPUsByState
}