const { executeCommand } = require("../helpers/executeCmd");

function getJobStates() {
    try {
        // squeue --helpstate prints the list of states to stdout
        const cmdOutput = executeCommand('squeue --helpstate');
        
        return cmdOutput.trim().split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(state => ({
                id: state.toUpperCase(),
                name: state.charAt(0).toUpperCase() + state.slice(1).toLowerCase()
            }));
    } catch (error) {
        console.error('Error in getJobStates:', error.message);
        throw error;
    }
}

module.exports = {
    getJobStates
};
