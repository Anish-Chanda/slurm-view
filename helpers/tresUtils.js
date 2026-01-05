const parseMemory = (memStr) => {
    if (!memStr) return 0;
    // Fix: Case insensitive, support P, anchor to end
    const match = memStr.match(/^(\d+)([KMGTP]?)$/i);
    if (!match) return 0;
    
    let value = parseInt(match[1], 10);
    const unit = match[2] ? match[2].toUpperCase() : 'M';
    
    switch(unit) {
        case 'P': value *= 1024 * 1024 * 1024; break;
        case 'T': value *= 1024 * 1024; break;
        case 'G': value *= 1024; break;
        case 'M': break;
        case 'K': value /= 1024; break;
        default: break; 
    }
    return Math.floor(value); // Return in MB
};

const parseTres = (tresStr) => {
    const result = {
        cpu: 0,
        mem: 0, // in MB
        gpu: {
            total: 0,
            types: {}
        }
    };

    if (!tresStr || tresStr === '(null)') return result;

    const parts = tresStr.split(',');
    parts.forEach(part => {
        const [key, val] = part.split('=');
        
        if (key === 'cpu') {
            result.cpu = parseInt(val, 10);
        } else if (key === 'mem') {
            result.mem = parseMemory(val);
        } else if (key === 'gres/gpu') {
            result.gpu.total = parseInt(val, 10);
        } else if (key.startsWith('gres/gpu:')) {
            const type = key.split(':')[1];
            result.gpu.types[type] = parseInt(val, 10);
        }
    });

    return result;
};

const checkResources = (required, available) => {
    const bottlenecks = [];

    if (required.cpu > available.cpu) {
        bottlenecks.push({
            resource: 'CPU',
            required: required.cpu,
            available: available.cpu,
            unit: 'cores'
        });
    }

    if (required.mem > available.mem) {
        bottlenecks.push({
            resource: 'Memory',
            required: required.mem,
            available: available.mem,
            unit: 'MB'
        });
    }

    if (required.gpu.total > available.gpu.total) {
        bottlenecks.push({
            resource: 'GPU (Total)',
            required: required.gpu.total,
            available: available.gpu.total,
            unit: 'cards'
        });
    }

    Object.keys(required.gpu.types).forEach(type => {
        const reqCount = required.gpu.types[type];
        const availCount = available.gpu.types[type] || 0;
        
        if (reqCount > availCount) {
            bottlenecks.push({
                resource: `GPU (${type})`,
                required: reqCount,
                available: availCount,
                unit: 'cards'
            });
        }
    });

    return bottlenecks;
};

module.exports = {
    parseMemory,
    parseTres,
    checkResources
};
