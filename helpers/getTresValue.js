function getTresvalue(tresStr, key) {
    if (!tresStr) return "N/A"
    const match = tresStr.match(new RegExp(`${key}=([^,]+)`));
    return match ? match[1] : 'N/A';
}

/**
 * Parse GPU allocations from gres_detail or tres string
 * Returns object with total count and type breakdown
 * @param {Array|string} gresDetail - gres_detail array or tres string
 * @returns {Object} { total: number, types: { gpuType: count } }
 */
function parseGpuAllocations(gresDetail) {
    const result = {
        total: 0,
        types: {}
    };

    if (!gresDetail) return result;

    // Handle gres_detail array format: ["gpu:a100:2(IDX:2-3)"]
    if (Array.isArray(gresDetail)) {
        gresDetail.forEach(entry => {
            // Match patterns like "gpu:a100:2(IDX:...)" or "gpu:v100:1"
            const match = entry.match(/gpu:([^:]+):(\d+)/);
            if (match) {
                const gpuType = match[1];
                const count = parseInt(match[2], 10);
                result.types[gpuType] = (result.types[gpuType] || 0) + count;
                result.total += count;
            }
        });
    } 
    // Handle tres string format: "cpu=1,mem=100G,gres/gpu:a100=2"
    else if (typeof gresDetail === 'string') {
        // Match gres/gpu:TYPE=COUNT patterns
        const gpuMatches = gresDetail.matchAll(/gres\/gpu:([^=]+)=(\d+)/g);
        for (const match of gpuMatches) {
            const gpuType = match[1];
            const count = parseInt(match[2], 10);
            result.types[gpuType] = (result.types[gpuType] || 0) + count;
            result.total += count;
        }
        
        // If no type-specific matches, try generic gres/gpu=COUNT
        if (result.total === 0) {
            const genericMatch = gresDetail.match(/gres\/gpu=(\d+)/);
            if (genericMatch) {
                result.total = parseInt(genericMatch[1], 10);
                result.types['unknown'] = result.total;
            }
        }
    }

    return result;
}

module.exports = {
    getTresvalue,
    parseGpuAllocations
}