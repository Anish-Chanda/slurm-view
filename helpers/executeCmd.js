const { execSync } = require('child_process');

// This function is used to execute shell commands and return the output.
function executeCommand(command) {
    try {
        const output = execSync(command, { maxBuffer: 1024 * 1024 * 20 });
        return output.toString().trim();
    } catch (e) {
        throw new Error("Failed to execute command: " + command + " message: " + e.message);
    }
}

module.exports = {
    executeCommand
}