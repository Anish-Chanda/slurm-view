const { executeCommand } = require("../helpers/executeCmd");
const dataCache = require("../modules/dataCache");

function getJobStates() {
    const cacheKey = 'jobStates';
    
    // Check cache first (10 minute TTL)
    const cached = dataCache.cache.get(cacheKey);
    if (cached) {
        console.log('[JobStates Handler] Using cached job states data');
        return cached;
    }
    
    try {
        // squeue --helpstate prints the list of states to stdout
        const cmdOutput = executeCommand('squeue --helpstate');
        
        const jobStates = cmdOutput.trim().split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(state => ({
                id: state.toUpperCase(),
                name: state.charAt(0).toUpperCase() + state.slice(1).toLowerCase()
            }));
        
        // Cache for 10 minutes (600 seconds)
        dataCache.cache.set(cacheKey, jobStates, 600);
        
        return jobStates;
    } catch (error) {
        console.error('Error in getJobStates:', error.message);
        throw error;
    }
}

module.exports = {
    getJobStates
};
