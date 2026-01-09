const { executeCommand } = require("../helpers/executeCmd");
const dataCache = require("../modules/dataCache");

function getPartitions() {
    const cacheKey = 'partitions';
    
    // Check cache first (10 minute TTL is reasonable for partitions)
    const cached = dataCache.cache.get(cacheKey);
    if (cached) {
        console.log('[Partitions Handler] Using cached partitions data');
        return cached;
    }
    
    try {
        const cmdOutput = executeCommand('sinfo --noheader --format="%P"');
        const partitions = cmdOutput.trim().split('\n')
            .map(partition => partition.trim())
            .filter(partition => partition.length > 0) // Filter out empty lines
            .map(partition => {
                // Remove trailing asterisk which indicates default partition
                const name = partition.replace('*', '');
                return {
                    id: name,
                    name: name.charAt(0).toUpperCase() + name.slice(1)// Capitalize first letter
                };
            });
        
        // Add "All Partitions" as the first option
        partitions.unshift({ id: 'all', name: 'All Partitions' });
        
        // Cache for 10 minutes (600 seconds)
        dataCache.cache.set(cacheKey, partitions, 600);
        
        return partitions;
    } catch (error) {
        console.error('Error in getPartitions:', error.message);
        throw error;
    }
}

module.exports = {
    getPartitions
}