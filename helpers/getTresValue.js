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
            // Skip null or undefined entries
            if (!entry) return;
            
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

function parsePerNodeCpuAllocations(tresPerNode) {
    if (!tresPerNode) return [];

    const entries = Array.isArray(tresPerNode) ? tresPerNode : [tresPerNode];
    const perNodeAllocations = [];

    entries.forEach((entry) => {
        if (typeof entry !== 'string') return;

        const cpuToken = entry
            .split(',')
            .map(token => token.trim())
            .find(token => token.startsWith('cpu='));

        if (!cpuToken) return;

        const rawCpuValue = cpuToken.split('=')[1];
        if (!rawCpuValue) return;

        const repeatedMatch = rawCpuValue.match(/^(\d+(?:\.\d+)?)\*(\d+)$/);
        if (repeatedMatch) {
            const perNodeValue = Number(repeatedMatch[1]);
            const repeatCount = Number(repeatedMatch[2]);

            if (!Number.isFinite(perNodeValue) || !Number.isFinite(repeatCount)) return;

            for (let i = 0; i < repeatCount; i += 1) {
                perNodeAllocations.push(perNodeValue);
            }
            return;
        }

        const numericMatch = rawCpuValue.match(/^(\d+(?:\.\d+)?)/);
        if (!numericMatch) return;

        const parsed = Number(numericMatch[1]);
        if (!Number.isFinite(parsed)) return;

        perNodeAllocations.push(parsed);
    });

    return perNodeAllocations;
}

module.exports = {
    getTresvalue,
    parseGpuAllocations,
    parsePerNodeCpuAllocations
}