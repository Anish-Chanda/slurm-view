const { executeCommand } = require("../helpers/executeCmd");

function getPartitions() {
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
                    name: name.charAt(0).toUpperCase() + name.slice(1) // Capitalize first letter
                };
            });
        
        // Add "All Partitions" as the first option
        partitions.unshift({ id: 'all', name: 'All Partitions' });
        
        return partitions;
    } catch (error) {
        console.error('Error in getPartitions:', error.message);
        throw error;
    }
}

module.exports = {
    getPartitions
}