const { execSync, spawn } = require('child_process');

// This function is used to execute shell commands and return the output.
function executeCommand(command) {
    try {
        const output = execSync(command, { maxBuffer: 1024 * 1024 * 20 });
        return output.toString().trim();
    } catch (e) {
        throw new Error("Failed to execute command: " + command + " message: " + e.message);
    }
}

function executeCommandStreaming(command) {
    return new Promise((resolve, reject) => {
        const parts = command.split(' ');
        const cmd = parts[0];
        const args = parts.slice(1);
        
        let output = '';
        let error = '';
        
        const process = spawn(cmd, args, { shell: true });
        
        process.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        process.stderr.on('data', (data) => {
            error += data.toString();
        });
        
        process.on('close', (code) => {
            if (code === 0) {
                resolve(output.trim());
            } else {
                reject(new Error(`Command failed with code ${code}: ${error}`));
            }
        });
        
        process.on('error', (err) => {
            reject(new Error(`Failed to start command: ${err.message}`));
        });
    });
}

module.exports = {
    executeCommand,
    executeCommandStreaming
}