/**
 * Input validation helpers to prevent command injection attacks
 * These functions validate user input before it's used in shell commands
 */

/**
 * Validates and sanitizes a SLURM job ID
 * Supports standard Slurm job ID formats:
 * - Basic job ID: "12345"
 * - Array job: "12345_1" 
 * - Job step: "12345.0", "12345.batch", "12345.extern"
 * @param {string} jobId - The job ID to validate
 * @returns {string} - The validated job ID
 * @throws {Error} - If the job ID format is invalid
 */
function validateJobId(jobId) {
    if (typeof jobId !== 'string') {
        throw new Error('Job ID must be a string');
    }

    // Slurm job ID format: job_id[_array_index][.step_name]
    // Examples: 12345, 12345_1, 12345.0, 12345.batch, 12345.extern, 12345_1.0
    const jobIdRegex = /^[0-9]+(_[0-9]+)?(\.(batch|extern|[0-9]+))?$/;
    
    if (!jobIdRegex.test(jobId)) {
        throw new Error('Invalid Job ID format. Expected format: jobid[_arrayindex][.stepname]');
    }

    return jobId;
}

/**
 * Validates and sanitizes a SLURM partition name
 * Allows only alphanumeric characters, hyphens, and underscores
 * Enforces Slurm's MAX_SLURM_NAME limit of 64 characters
 * @param {string} partition - The partition name to validate
 * @returns {string} - The validated partition name
 * @throws {Error} - If the partition name format is invalid
 */
function validatePartitionName(partition) {
    if (typeof partition !== 'string') {
        throw new Error('Partition name must be a string');
    }

    // Allow only alphanumeric characters, hyphens, and underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(partition)) {
        throw new Error('Invalid partition name. Only alphanumeric characters, hyphens, and underscores are allowed.');
    }

    // Enforce Slurm's MAX_SLURM_NAME limit (64 characters)
    if (partition.length > 64) {
        throw new Error('Partition name exceeds Slurm MAX_SLURM_NAME limit (64 characters)');
    }

    return partition;
}

/**
 * Validates page number for pagination
 * @param {string|number} page - The page number
 * @returns {number} - The validated page number
 * @throws {Error} - If the page number is invalid
 */
function validatePageNumber(page) {
    const pageNum = parseInt(page);
    
    if (isNaN(pageNum) || pageNum < 1) {
        throw new Error('Page number must be a positive integer');
    }
    
    // No upper limit - let users paginate as needed
    
    return pageNum;
}

/**
 * Validates page size for pagination
 * @param {string|number} pageSize - The page size
 * @returns {number} - The validated page size
 * @throws {Error} - If the page size is invalid
 */
function validatePageSize(pageSize) {
    const pageSizeNum = parseInt(pageSize);
    
    if (isNaN(pageSizeNum) || pageSizeNum < 1) {
        throw new Error('Page size must be a positive integer');
    }
    
    if (pageSizeNum > 1000) { // Reasonable upper limit to prevent DoS
        throw new Error('Page size is too large (maximum: 1000)');
    }
    
    return pageSizeNum;
}

/**
 * Validates filter values to prevent injection in filter operations
 * @param {string} filterValue - The filter value
 * @returns {string} - The validated filter value
 * @throws {Error} - If the filter value contains dangerous characters
 */
function validateFilterValue(filterValue) {
    if (typeof filterValue !== 'string') {
        throw new Error('Filter value must be a string');
    }

    // Prevent dangerous characters that could be used for injection
    if (/[;&|`$(){}[\]\\<>]/.test(filterValue)) {
        throw new Error('Filter value contains invalid characters');
    }

    // Length check
    if (filterValue.length > 200) {
        throw new Error('Filter value is too long');
    }

    return filterValue;
}

/**
 * Creates a safe command string by validating and escaping shell arguments
 * This is a more robust approach than string concatenation
 * @param {string} baseCommand - The base command (e.g., "sinfo", "seff")
 * @param {Array<string>} args - Array of command arguments
 * @returns {string} - The safe command string
 */
function createSafeCommand(baseCommand, args = []) {
    // Validate base command (only allow commands used by this codebase)
    const allowedCommands = ['sinfo', 'squeue', 'scontrol', 'seff'];
    if (!allowedCommands.includes(baseCommand)) {
        throw new Error(`Command '${baseCommand}' is not allowed`);
    }

    // Escape each argument properly
    const escapedArgs = args.map(arg => {
        if (typeof arg !== 'string') {
            throw new Error('All command arguments must be strings');
        }
        
        // wrap in single quotes and escape any single quotes
        return `'${arg.replace(/'/g, "'\"'\"'")}'`;
    });

    return [baseCommand, ...escapedArgs].join(' ');
}

module.exports = {
    validateJobId,
    validatePartitionName,
    validatePageNumber,
    validatePageSize,
    validateFilterValue,
    createSafeCommand
};