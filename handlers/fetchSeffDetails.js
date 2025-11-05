const { executeCommand, executeCommandForgiving } = require("../helpers/executeCmd");
const { validateJobId, createSafeCommand } = require("../helpers/inputValidation");

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
    return details;
}

function getSeffDetails(jobId) {
    // Validate and sanitize the job ID to prevent command injection
    const validatedJobId = validateJobId(jobId);

    // try {
    // TODO: use exec cmd instead of forgiving onse seff is fixed
    const safeCommand = createSafeCommand('seff', [validatedJobId]);
    const { stdout, stderr, error } = executeCommandForgiving(safeCommand);
    if (stdout && stdout.includes("CPU Efficiency")) {
        // We have valid output, even if the command crashed.
        if (error) {
            console.warn(`[seff handler] The 'seff ${validatedJobId}' command exited with an error but provided valid output. Ignoring error. Stderr: ${stderr}`);
        }
        return parseSeffOutput(stdout);
    } else {
        // This is a true failure. We got no usable output.
        console.error(`[seff handler] Failed to get valid output from 'seff ${validatedJobId}'. Stderr: ${stderr}`);
        throw {
            error: true,
            message: `Could not get efficiency report for Job ${validatedJobId}. The command failed to produce valid output.`
        };
    }
    // const ouptut = executeCommand(`seff ${validatedJobId}`);
    // const seffData = parseSeffOutput(ouptut);
    // return seffData;
    // } catch (e) {
    //     console.log(`seff error for job ${validatedJobId}: ${e.message}`);
    //     throw {
    //         error: true,
    //         message: `Could not get efficiency report for Job ${validatedJobId}.`
    //     };
    // }
}

module.exports = {
    getSeffDetails,
    parseSeffOutput //for testing purposes
}