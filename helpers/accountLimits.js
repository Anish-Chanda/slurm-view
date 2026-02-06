const { executeCommand } = require("./executeCmd");
const { createSafeCommand } = require("./inputValidation");

/**
 * Parse memory string to MB
 * @param {string} memStr - Memory string (e.g., "1000M", "10G", "1T")
 * @returns {number} - Memory in MB
 */
function parseMemoryToMB(memStr) {
    if (!memStr || memStr === 'N/A') return 0;
    
    const str = String(memStr).toUpperCase();
    const match = str.match(/^(\d+(?:\.\d+)?)\s*([KMGT]?)$/);
    
    if (!match) return 0;
    
    const value = parseFloat(match[1]);
    const unit = match[2] || 'M'; // Default to MB
    
    const multipliers = {
        'K': 1 / 1024,
        'M': 1,
        'G': 1024,
        'T': 1024 * 1024
    };
    
    return Math.floor(value * (multipliers[unit] || 1));
}

/**
 * Parse TRES string into structured format
 * @param {string} tresStr - E.g., "cpu=7200,gres/gpu=5,mem=38000000M"
 * @returns {Object} - { cpu, mem, node, gres: {gpu, ...} }
 */
function parseTRESLimits(tresStr) {
    const limits = {
        cpu: null,
        mem: null,
        node: null,
        gres: {}
    };
    
    if (!tresStr) return limits;
    
    const parts = tresStr.split(',');
    parts.forEach(part => {
        const [key, value] = part.split('=');
        
        if (key === 'cpu') {
            limits.cpu = parseInt(value) || null;
        } else if (key === 'mem') {
            limits.mem = parseMemoryToMB(value);
        } else if (key === 'node') {
            limits.node = parseInt(value) || null;
        } else if (key.startsWith('gres/')) {
            // Extract resource name: "gres/gpu" or "gres/gpu:a100"
            const resName = key.substring(5); // Remove "gres/" prefix
            limits.gres[resName] = parseInt(value) || 0;
        }
    });
    
    return limits;
}

/**
 * Fetch all account association limits from Slurm
 * @returns {Object} - { timestamp, accounts: {accountName: {...limits}} }
 */
function fetchAccountLimits() {
    const cmd = createSafeCommand('sacctmgr', [
        'list', 'assoc',
        'format=cluster,account,user,parentname,grpmem,grpcpus,grptres,grptresrunmins,grpsubmitjobs,maxjobs,maxsubmitjobs',
        '-p'
    ]);
    
    const output = executeCommand(cmd);
    const lines = output.trim().split('\n').slice(1); // Skip header
    
    const accounts = {};
    
    lines.forEach(line => {
        const [cluster, account, user, parentName, grpMem, grpCPUs, grpTRES, grpTRESRunMins, grpSubmit, maxJobs, maxSubmit] = line.split('|');
        
        // Only process account-level limits (user is empty)
        if (!user && account) {
            // Initialize account if not exists
            if (!accounts[account]) {
                accounts[account] = {
                    account: account,
                    parent: parentName || null,
                    grpCPUs: null,
                    grpMem: null,
                    grpSubmitJobs: null,
                    grpTRES: { cpu: null, mem: null, node: null, gres: {} },
                    grpTRESRunMins: { cpu: null, mem: null, node: null, gres: {} },
                    maxJobs: null,
                    maxSubmitJobs: null,
                    users: {}
                };
            }
            
            // Update with actual limits if they exist
            if (grpMem) accounts[account].grpMem = parseInt(grpMem);
            if (grpCPUs) accounts[account].grpCPUs = parseInt(grpCPUs);
            if (grpSubmit) accounts[account].grpSubmitJobs = parseInt(grpSubmit);
            if (maxJobs) accounts[account].maxJobs = parseInt(maxJobs);
            if (maxSubmit) accounts[account].maxSubmitJobs = parseInt(maxSubmit);
            if (grpTRES) accounts[account].grpTRES = parseTRESLimits(grpTRES);
            if (grpTRESRunMins) accounts[account].grpTRESRunMins = parseTRESLimits(grpTRESRunMins);
        } else if (user && account) {
            // User-level limits
            if (!accounts[account]) {
                accounts[account] = {
                    account: account,
                    parent: parentName || null,
                    grpCPUs: null,
                    grpMem: null,
                    grpSubmitJobs: null,
                    grpTRES: { cpu: null, mem: null, node: null, gres: {} },
                    grpTRESRunMins: { cpu: null, mem: null, node: null, gres: {} },
                    maxJobs: null,
                    maxSubmitJobs: null,
                    users: {}
                };
            }
            
            // Store user-specific limits if they exist
            if (grpMem || grpCPUs || grpTRES || grpTRESRunMins) {
                accounts[account].users[user] = {
                    user: user,
                    grpCPUs: grpCPUs ? parseInt(grpCPUs) : null,
                    grpMem: grpMem ? parseInt(grpMem) : null,
                    grpTRES: grpTRES ? parseTRESLimits(grpTRES) : { cpu: null, mem: null, node: null, gres: {} },
                    grpTRESRunMins: grpTRESRunMins ? parseTRESLimits(grpTRESRunMins) : { cpu: null, mem: null, node: null, gres: {} }
                };
            }
        }
    });
    
    return {
        timestamp: Date.now(),
        accounts: accounts
    };
}

/**
 * Build ancestor chain for an account
 * @param {string} account - Account name
 * @param {Object} allLimits - All account limits data
 * @returns {Array<string>} - Chain of accounts from child to root
 */
function buildAncestorChain(account, allLimits) {
    const chain = [account];
    let current = account;
    let depth = 0;
    const maxDepth = 20; // limit
    
    while (allLimits.accounts[current]?.parent && depth < maxDepth) {
        const parent = allLimits.accounts[current].parent;
        if (parent && parent !== current) {
            chain.push(parent);
            current = parent;
        } else {
            break;
        }
        depth++;
    }
    
    return chain;
}

/**
 * Get effective limit for a user (check user-level, then account-level)
 * @param {string} account - Account name
 * @param {string} user - Username
 * @param {string} limitType - 'grpMem', 'grpCPUs', etc.
 * @param {Object} allLimits - All account limits data
 * @returns {number|null} - Limit value or null
 */
function getEffectiveLimit(account, user, limitType, allLimits) {
    const accountData = allLimits.accounts[account];
    if (!accountData) return null;
    
    // Check user-specific limit first
    if (accountData.users[user]?.[limitType]) {
        return accountData.users[user][limitType];
    }
    
    // Fall back to account-level limit
    return accountData[limitType] || null;
}

/**
 * Format memory value for display
 * @param {number} memMB - Memory in MB
 * @returns {string} - Formatted string
 */
function formatMemory(memMB) {
    if (!memMB || memMB === 0) return '0 MB';
    
    if (memMB >= 1024 * 1024) {
        return `${(memMB / (1024 * 1024)).toLocaleString('en-US', {maximumFractionDigits: 1})} TB`;
    } else if (memMB >= 1024) {
        return `${(memMB / 1024).toLocaleString('en-US', {maximumFractionDigits: 1})} GB`;
    } else {
        return `${memMB.toLocaleString('en-US')} MB`;
    }
}

module.exports = {
    fetchAccountLimits,
    parseTRESLimits,
    parseMemoryToMB,
    buildAncestorChain,
    getEffectiveLimit,
    formatMemory
};
