const { executeCommand, executeCommandForgiving } = require("../helpers/executeCmd");

function parseSeffOutput(seffOutput) {
    var details = {};
    const relevantKeys = [
        "CPU Efficiency",
        "Memory Efficiency",
        "CPU Utilized",
        "Memory Utilized",
        "Job Wall-clock time",
    ];
    seffOutput.split("\n").forEach(line => {
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim();

            // If the key is one we care about, add it to our details object.
            if (relevantKeys.includes(key)) {
                details[key] = value;
            }
        }
    });
    console.log("[DEBUG] Parsed seff output:", details);
    return details;
}

function getSeffDetails(jobId) {
    if (!/^\d+(\.\d+)?$/.test(jobId)) { // Allow for array job IDs like 12345_1 and normal job ids only
        throw new Error("Invalid JobID format for seff.");
    }

    // try {
    // TODO: use exec cmd instead of forgiving onse seff is fixed
    const { stdout, stderr, error } = executeCommandForgiving(`seff ${jobId}`);
    if (stdout && stdout.includes("CPU Efficiency")) {
        // We have valid output, even if the command crashed.
        if (error) {
            console.warn(`[seff handler] The 'seff ${jobId}' command exited with an error but provided valid output. Ignoring error. Stderr: ${stderr}`);
        }
        return parseSeffOutput(stdout);
    } else {
        // This is a true failure. We got no usable output.
        console.error(`[seff handler] Failed to get valid output from 'seff ${jobId}'. Stderr: ${stderr}`);
        throw {
            error: true,
            message: `Could not get efficiency report for Job ${jobId}. The command failed to produce valid output.`
        };
    }
    // const ouptut = executeCommand(`seff ${jobId}`);
    // const seffData = parseSeffOutput(ouptut);
    // return seffData;
    // } catch (e) {
    //     console.log(`seff error for job ${jobId}: ${e.message}`);
    //     throw {
    //         error: true,
    //         message: `Could not get efficiency report for Job ${jobId}.`
    //     };
    // }
}

module.exports = {
    getSeffDetails,
    parseSeffOutput //for testing purposes
}