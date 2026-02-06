const { executeCommand } = require("../helpers/executeCmd");
const { createSafeCommand, validatePartitionName } = require("../helpers/inputValidation");
const { parseTres, checkResources } = require("../helpers/tresUtils");
const { 
    getJobPriority, 
    getCompetingJobs, 
    getRunningJobsCount,
    calculateContributions 
} = require("../helpers/priorityUtils");
const dataCache = require("../modules/dataCache");

const getPendingReason = async (jobId) => {
    // Check cache first
    const cached = dataCache.getPendingReason(jobId);
    if (cached) return cached;

    try {
        // Fetch Job Details
        const jobCmd = createSafeCommand('scontrol', ['show', 'job', jobId]);
        const jobOutput = executeCommand(jobCmd);
        
        const jobData = parseJobData(jobOutput);
        
        if (jobData.JobState !== 'PENDING') {
            return { type: 'Status', message: `Job is ${jobData.JobState}` };
        }
        
        // Route to appropriate handler based on pending reason
        let result;
        if (jobData.Reason === 'Resources') {
            result = analyzeResourcesPending(jobId, jobData);
        } else if (jobData.Reason === 'Priority') {
            result = analyzePriorityPending(jobId, jobData);
        } else if (jobData.Reason === 'Dependency') {
            result = analyzeDependencyPending(jobId, jobData);
        } else if (jobData.Reason === 'DependencyNeverSatisfied') {
            result = analyzeDependencyNeverSatisfied(jobId, jobData);
        } else if (jobData.Reason === 'AssocGrpMemLimit') {
            result = analyzeAssocGrpMemLimit(jobId, jobData);
        } else if (jobData.Reason === 'AssocGrpCpuLimit') {
            result = analyzeAssocGrpCPULimit(jobId, jobData);
        } else if (jobData.Reason === 'AssocGrpGRES') {
            result = analyzeAssocGrpGRES(jobId, jobData);
        } else if (jobData.Reason === 'AssocGrpMemRunMinutes') {
            result = analyzeAssocGrpMemRunMinutes(jobId, jobData);
        } else {
            result = { type: 'Other', message: `Pending reason: ${jobData.Reason}` };
        }

        // Cache result (short TTL as resources/priorities change)
        dataCache.setPendingReason(jobId, result);
        
        return result;

    } catch (error) {
        console.error(`Error fetching pending reason for job ${jobId}:`, error.message);
        return { type: 'Error', message: error.message };
    }
};

/**
 * Analyze a job pending due to resources
 * @param {string} jobId - Job ID
 * @param {Object} jobData - Parsed job data from scontrol
 * @returns {Object} Resources analysis result
 */
const analyzeResourcesPending = (jobId, jobData) => {
    // Identify Target Nodes
    let targetNodes = [];
    let scope = 'Partition';

    if (jobData.SchedNodeList && jobData.SchedNodeList !== '(null)') {
        targetNodes = [jobData.SchedNodeList];
        scope = 'Scheduled Node';
    } else if (jobData.ReqNodeList && jobData.ReqNodeList !== '(null)') {
        targetNodes = [jobData.ReqNodeList];
        scope = 'Requested Node';
    } else {
        // Fetch all nodes in partition
        const partCmd = createSafeCommand('sinfo', ['-p', jobData.Partition, '-h', '-o', '%N']);
        const partOutput = executeCommand(partCmd);
        targetNodes = partOutput.trim().split(',').filter(n => n);
    }

    // Analyze Nodes       
    const nodesCmdArgs = ['show', 'node', targetNodes.join(',')];
    const nodesCmd = createSafeCommand('scontrol', nodesCmdArgs);
    const nodesOutput = executeCommand(nodesCmd);
    
    const nodesAnalysis = analyzeNodes(nodesOutput, jobData.ReqTRES);

    return {
        type: 'Resources',
        scope: scope,
        jobId: jobId,
        reqTres: jobData.ReqTRES,
        summary: summarizeAnalysis(nodesAnalysis, targetNodes.length),
        details: nodesAnalysis
    };
};

/**
 * Analyze a job pending due to priority
 * @param {string} jobId - Job ID
 * @param {Object} jobData - Parsed job data from scontrol
 * @returns {Object} Priority analysis result
 */
const analyzePriorityPending = (jobId, jobData) => {
    try {
        // Get job priority breakdown
        const priorityData = getJobPriority(jobId);
        
        // Get competing jobs (limit to 5)
        const competition = getCompetingJobs(jobData.Partition, priorityData.priority, 5);
        
        // Get running jobs count
        const runningCount = getRunningJobsCount(jobData.Partition);
        
        // Calculate percentage contributions
        const contributions = calculateContributions(
            priorityData.components, 
            priorityData.weights
        );

        // Calculate estimated position in queue
        const queuePosition = competition.higherPriorityCount + 1;

        return {
            type: 'Priority',
            jobId: jobId,
            partition: jobData.Partition,
            priority: {
                total: priorityData.priority,
                components: priorityData.components,
                weights: priorityData.weights,
                contributions: contributions
            },
            competition: {
                higherPriorityCount: competition.higherPriorityCount,
                topCompetitors: competition.competitors,
                totalPending: competition.totalPending,
                runningJobs: runningCount
            },
            queuePosition: queuePosition
        };
    } catch (error) {
        console.error(`Error analyzing priority for job ${jobId}:`, error.message);
        // Fallback to simple message if priority analysis fails
        return { 
            type: 'Other', 
            message: `Pending reason: Priority (detailed analysis unavailable: ${error.message})` 
        };
    }
};
/**
 * Analyze a job pending due to dependency
 * @param {string} jobId - Job ID
 * @param {Object} jobData - Parsed job data from scontrol
 * @returns {Object} Dependency analysis result
 */
const analyzeDependencyPending = (jobId, jobData) => {
    try {
        // Parse dependency string
        const dependency = jobData.Dependency || '';
        
        if (!dependency || dependency === '(null)') {
            return {
                type: 'Dependency',
                message: 'Job has dependency but details unavailable'
            };
        }

        // Parse dependency format: type:jobid[:jobid]...
        // Examples: afterok:123, afterany:456:789, singleton
        const parsed = parseDependencyString(dependency);
        const dependencies = parsed.dependencies;
        const operator = parsed.operator;
        
        // Get status of dependent jobs
        const dependencyDetails = dependencies.map(dep => {
            if (dep.type === 'singleton') {
                return {
                    type: 'singleton',
                    description: 'Only one job with this name can run at a time',
                    status: 'active',
                    satisfied: false
                };
            }
            
            // Fetch dependent job(s) status
            const jobStatuses = dep.jobIds.map(depJobId => {
                const statusFromDep = dep.statusMap ? dep.statusMap[depJobId] : null;
                
                // If status is 'failed' or 'unfulfilled', we know the dependency is not satisfied
                if (statusFromDep === 'failed' || statusFromDep === 'unfulfilled') {
                    return {
                        jobId: depJobId,
                        state: statusFromDep === 'failed' ? 'FAILED' : 'UNKNOWN',
                        exitCode: 'N/A',
                        endTime: 'N/A',
                        satisfied: false,
                        statusMarker: statusFromDep
                    };
                }
                
                // Try to get from cache first
                let depJobData = dataCache.getJobById(depJobId);
                let fromCache = !!depJobData;
                
                if (!depJobData) {
                    // Query Slurm if not in cache
                    try {
                        const depCmd = createSafeCommand('scontrol', ['show', 'job', depJobId]);
                        const depOutput = executeCommand(depCmd);
                        depJobData = parseJobData(depOutput);
                    } catch (error) {
                        // Job might not exist anymore (completed and cleaned up)
                        return {
                            jobId: depJobId,
                            state: 'UNKNOWN',
                            exitCode: 'N/A',
                            endTime: 'Unknown',
                            satisfied: false,
                            error: 'Job not found - may have been cleaned up',
                            statusMarker: statusFromDep
                        };
                    }
                }
                
                return {
                    jobId: depJobId,
                    state: depJobData.JobState || depJobData.job_state,
                    exitCode: depJobData.ExitCode || depJobData.exit_code || depJobData.derived_exit_code || 'N/A',
                    endTime: depJobData.EndTime || depJobData.end_time || 'Running',
                    satisfied: checkDependencySatisfied(dep.type, depJobData),
                    statusMarker: statusFromDep,
                    fromCache: fromCache
                };
            });

            return {
                type: dep.type,
                description: getDependencyTypeDescription(dep.type),
                jobs: jobStatuses,
                satisfied: jobStatuses.every(j => j.satisfied)
            };
        });

        // Determine overall status
        // For AND (,): all must be satisfied
        // For OR (?): at least one must be satisfied
        let allSatisfied, anySatisfied;
        if (operator === 'OR') {
            allSatisfied = dependencyDetails.some(d => d.satisfied);
            anySatisfied = dependencyDetails.some(d => d.satisfied);
        } else { // AND
            allSatisfied = dependencyDetails.every(d => d.satisfied);
            anySatisfied = dependencyDetails.some(d => d.satisfied);
        }
        
        return {
            type: 'Dependency',
            jobId: jobId,
            rawDependency: dependency,
            operator: operator,
            dependencies: dependencyDetails,
            allSatisfied: allSatisfied,
            anySatisfied: anySatisfied
        };

    } catch (error) {
        console.error(`Error analyzing dependency for job ${jobId}:`, error.message);
        return { 
            type: 'Other', 
            message: `Pending reason: Dependency (detailed analysis unavailable: ${error.message})` 
        };
    }
};

/**
 * Analyze a job with DependencyNeverSatisfied reason
 * @param {string} jobId - Job ID
 * @param {Object} jobData - Parsed job data from scontrol
 * @returns {Object} DependencyNeverSatisfied analysis result
 */
const analyzeDependencyNeverSatisfied = (jobId, jobData) => {
    try {
        // Parse dependency string
        const dependency = jobData.Dependency || '';
        
        if (!dependency || dependency === '(null)') {
            return {
                type: 'DependencyNeverSatisfied',
                message: 'Job dependency will never be satisfied, but details unavailable',
                canBeFixed: false
            };
        }

        // Parse dependency format
        const parsed = parseDependencyString(dependency);
        const dependencies = parsed.dependencies;
        const operator = parsed.operator;
        
        // Get status of dependent jobs
        const dependencyDetails = dependencies.map(dep => {
            if (dep.type === 'singleton') {
                return {
                    type: 'singleton',
                    description: 'Only one job with this name can run at a time',
                    status: 'never_satisfied',
                    reason: 'Another job with the same name is blocking this job indefinitely'
                };
            }
            
            // Fetch dependent job(s) status
            const jobStatuses = dep.jobIds.map(depJobId => {
                const statusFromDep = dep.statusMap ? dep.statusMap[depJobId] : null;
                
                // If status is 'failed', we know why it will never be satisfied
                if (statusFromDep === 'failed') {
                    return {
                        jobId: depJobId,
                        state: 'FAILED',
                        exitCode: 'N/A',
                        endTime: 'N/A',
                        satisfied: false,
                        statusMarker: statusFromDep,
                        reason: `Dependent job ${depJobId} failed and has been cleaned up`
                    };
                }
                
                // Try to get from cache first
                let depJobData = dataCache.getJobById(depJobId);
                let fromCache = !!depJobData;
                
                if (!depJobData) {
                    // Query Slurm if not in cache
                    try {
                        const depCmd = createSafeCommand('scontrol', ['show', 'job', depJobId]);
                        const depOutput = executeCommand(depCmd);
                        depJobData = parseJobData(depOutput);
                    } catch (error) {
                        // Job doesn't exist - this is likely why it will never be satisfied
                        return {
                            jobId: depJobId,
                            state: 'NOT_FOUND',
                            exitCode: 'N/A',
                            endTime: 'N/A',
                            satisfied: false,
                            error: true,
                            statusMarker: statusFromDep,
                            reason: `Job ${depJobId} no longer exists (likely failed and cleaned up)`
                        };
                    }
                }
                
                const satisfied = checkDependencySatisfied(dep.type, depJobData);
                let reason = '';
                
                if (!satisfied) {
                    const jobState = depJobData.JobState || depJobData.job_state;
                    const exitCode = depJobData.ExitCode || depJobData.exit_code || depJobData.derived_exit_code;
                    
                    if (jobState === 'FAILED' || jobState === 'CANCELLED') {
                        reason = `Job ${depJobId} ${jobState.toLowerCase()} with exit code ${exitCode}`;
                    } else if (jobState === 'TIMEOUT') {
                        reason = `Job ${depJobId} timed out`;
                    } else {
                        reason = `Job ${depJobId} is in ${jobState} state`;
                    }
                }
                
                return {
                    jobId: depJobId,
                    state: depJobData.JobState || depJobData.job_state,
                    exitCode: depJobData.ExitCode || depJobData.exit_code || depJobData.derived_exit_code || 'N/A',
                    endTime: depJobData.EndTime || depJobData.end_time || 'N/A',
                    satisfied: satisfied,
                    statusMarker: statusFromDep,
                    reason: reason,
                    fromCache: fromCache
                };
            });

            return {
                type: dep.type,
                description: getDependencyTypeDescription(dep.type),
                jobs: jobStatuses,
                satisfied: false, // Always false for DependencyNeverSatisfied
                reason: 'One or more dependent jobs failed or cannot be satisfied'
            };
        });

        return {
            type: 'DependencyNeverSatisfied',
            jobId: jobId,
            rawDependency: dependency,
            operator: operator,
            dependencies: dependencyDetails,
            canBeFixed: false,
            recommendation: 'This job will never run. You need to cancel it and resubmit with corrected dependencies.'
        };

    } catch (error) {
        console.error(`Error analyzing DependencyNeverSatisfied for job ${jobId}:`, error.message);
        return { 
            type: 'DependencyNeverSatisfied', 
            message: `Job dependency will never be satisfied (detailed analysis unavailable: ${error.message})`,
            canBeFixed: false
        };
    }
};

/**
 * Parse dependency string into structured format
 * @param {string} depString - Dependency string from Slurm
 * @returns {Object} Dependency object with type (AND/OR) and dependencies array
 */
const parseDependencyString = (depString) => {
    const result = {
        operator: 'AND', // default
        dependencies: []
    };
    
    // Handle singleton special case
    if (depString.includes('singleton')) {
        result.dependencies.push({ type: 'singleton', jobIds: [] });
        return result;
    }
    
    // Determine operator - check for ? (OR) or , (AND)
    let parts;
    if (depString.includes('?')) {
        result.operator = 'OR';
        parts = depString.split('?');
    } else {
        result.operator = 'AND';
        parts = depString.split(',');
    }
    
    parts.forEach(part => {
        // Match pattern like: afterok:123(unfulfilled) or afterok:123_*(failed) or after:123+60
        const match = part.match(/^([^:]+):(.+)$/);
        if (match) {
            const type = match[1];
            const jobPart = match[2];
            
            // Extract job IDs, status markers, and time delays
            const jobIds = [];
            const statusMap = {};
            const timeDelays = {};
            
            // Split by colon to handle multiple job IDs
            const jobSegments = jobPart.split(':');
            jobSegments.forEach(segment => {
                // Extract job ID, time delay, and status
                // Pattern: 123+60(unfulfilled) or 123_*(failed) or 123+60 or 123(unfulfilled)
                const jobMatch = segment.match(/^(\d+)(?:\+(\d+))?(?:_\*)?(?:\(([^)]+)\))?$/);
                if (jobMatch) {
                    const jobId = jobMatch[1];
                    const timeDelay = jobMatch[2]; // Time delay in minutes
                    const status = jobMatch[3]; // 'unfulfilled', 'failed', etc.
                    
                    jobIds.push(jobId);
                    if (status) {
                        statusMap[jobId] = status;
                    }
                    if (timeDelay) {
                        timeDelays[jobId] = parseInt(timeDelay);
                    }
                }
            });
            
            result.dependencies.push({ type, jobIds, statusMap, timeDelays });
        }
    });
    
    return result;
};

/**
 * Check if a dependency condition is satisfied
 * @param {string} depType - Type of dependency
 * @param {Object} jobData - Job data for the dependent job (supports both scontrol and JSON formats)
 * @returns {boolean} Whether dependency is satisfied
 */
const checkDependencySatisfied = (depType, jobData) => {
    // Support both scontrol format (JobState) and JSON format (job_state)
    const state = jobData.JobState || jobData.job_state;
    
    // Parse exit code - handle multiple formats
    let exitCode = 0;
    if (jobData.DerivedExitCode || jobData.derived_exit_code) {
        const rawCode = jobData.DerivedExitCode || jobData.derived_exit_code;
        exitCode = typeof rawCode === 'string' ? parseInt(rawCode.split(':')[0]) : rawCode;
    } else if (jobData.ExitCode || jobData.exit_code) {
        const rawCode = jobData.ExitCode || jobData.exit_code;
        exitCode = typeof rawCode === 'string' ? parseInt(rawCode.split(':')[0]) : rawCode;
    }
    
    switch(depType) {
        case 'afterok':
            // Job must complete successfully (exit code 0)
            return state === 'COMPLETED' && exitCode === 0;
        
        case 'afternotok':
            // Job must fail (non-zero exit code)
            return state === 'COMPLETED' && exitCode !== 0;
        
        case 'afterany':
            // Job must be done (any state)
            return state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED';
        
        case 'after':
            // Job must have started or been cancelled
            return state !== 'PENDING';
        
        case 'aftercorr':
            // Array task correlation
            return state === 'COMPLETED' && exitCode === 0;
        
        case 'afterburstbuffer':
            // Must complete with burst buffer cleanup
            return state === 'COMPLETED';
        
        default:
            return false;
    }
};

/**
 * Get human-readable description for dependency type
 * @param {string} type - Dependency type
 * @returns {string} Description
 */
const getDependencyTypeDescription = (type) => {
    const descriptions = {
        'after': 'After job starts or is cancelled (with optional time delay)',
        'afterok': 'After successful completion (exit code 0)',
        'afternotok': 'After failed completion (non-zero exit code)',
        'afterany': 'After completion (any exit code)',
        'aftercorr': 'After corresponding array task completes successfully',
        'afterburstbuffer': 'After burst buffer stage-out completes',
        'singleton': 'Only one job with this name can run at once'
    };
    
    return descriptions[type] || `After ${type} condition`;
};
// Helper to parse scontrol show job output
const parseJobData = (output) => {
    const data = {};
    const lines = output.split('\n');
    
    // Simple parser for key=value pairs
    lines.forEach(line => {
        const pairs = line.trim().split(/\s+/);
        pairs.forEach(pair => {
            const [key, val] = pair.split('=');
            if (key && val) {
                data[key] = val;
            }
        });
    });

    // Extract TRES
    const reqTresMatch = output.match(/ReqTRES=([^\s]+)/);
    if (reqTresMatch) {
        data.ReqTRES = parseTres(reqTresMatch[1]);
    }
    
    const allocTresMatch = output.match(/AllocTRES=([^\s]+)/);
    if (allocTresMatch) {
        data.AllocTRES = parseTres(allocTresMatch[1]);
    }

    return data;
};

// Helper to analyze node output
const analyzeNodes = (output, reqTres) => {
    const nodes = [];
    const blocks = output.split('\n\n');

    blocks.forEach(block => {
        if (!block.trim()) return;
        
        const nodeNameMatch = block.match(/NodeName=([^\s]+)/);
        const cfgTresMatch = block.match(/CfgTRES=([^\s]+)/);
        const allocTresMatch = block.match(/AllocTRES=([^\s]+)/);
        
        if (!nodeNameMatch) return;

        const name = nodeNameMatch[1];
        const cfg = parseTres(cfgTresMatch ? cfgTresMatch[1] : '');
        const alloc = parseTres(allocTresMatch ? allocTresMatch[1] : '');

        // Calculate Available
        const available = {
            cpu: cfg.cpu - alloc.cpu,
            mem: cfg.mem - alloc.mem,
            gpu: {
                total: cfg.gpu.total - alloc.gpu.total,
                types: {}
            }
        };

        // Calculate GPU types availability
        Object.keys(cfg.gpu.types).forEach(type => {
            const total = cfg.gpu.types[type];
            const used = alloc.gpu.types[type] || 0;
            available.gpu.types[type] = total - used;
        });

        const bottlenecks = checkResources(reqTres, available);

        nodes.push({
            name,
            available,
            bottlenecks,
            isBlocked: bottlenecks.length > 0
        });
    });

    return nodes;
};

const summarizeAnalysis = (nodes, totalNodes) => {
    const blockedNodes = nodes.filter(n => n.isBlocked);
    const freeNodes = nodes.length - blockedNodes.length;
    
    // Count bottlenecks
    const bottleneckCounts = {};
    blockedNodes.forEach(node => {
        node.bottlenecks.forEach(b => {
            bottleneckCounts[b.resource] = (bottleneckCounts[b.resource] || 0) + 1;
        });
    });

    return {
        totalNodesAnalyzed: nodes.length,
        blockedNodes: blockedNodes.length,
        freeNodes: freeNodes,
        bottlenecks: bottleneckCounts
    };
};

/**
 * Analyze a job pending due to AssocGrpMemRunMinutes
 * @param {string} jobId - Job ID
 * @param {Object} jobData - Parsed job data from scontrol
 * @returns {Object} Memory run-minutes limit analysis result
 */
const analyzeAssocGrpMemRunMinutes = (jobId, jobData) => {
    try {
        const { buildAncestorChain, formatMemory, parseMemoryToMB } = require('../helpers/accountLimits.js');
        const { calculateJobRunMinutes, formatRunMinutes } = require('../helpers/runMinutesUtils.js');
        
        // Get account limits from cache
        const allLimits = dataCache.getAccountLimits();
        if (!allLimits) {
            return { type: 'Error', message: 'Account limits not available' };
        }
        
        const account = jobData.Account;
        const user = jobData.UserId ? jobData.UserId.split('(')[0] : null;
        
        // Get job memory request and time limit
        const jobMemory = jobData.ReqTRES?.mem || 0;
        const jobTimeLimit = jobData.TimeLimit;
        
        // Calculate job's contribution
        // Pass memory as "XXXM" format (e.g., "4194304M") for proper parsing
        const jobForCalc = {
            alloc_memory: jobMemory + 'M',
            time_limit: jobTimeLimit,
            start_time: null
        };
        const jobContribution = calculateJobRunMinutes(jobForCalc, 'mem');
        
        if (jobContribution === null) {
            return {
                type: 'Info',
                message: 'Job has UNLIMITED time limit - cannot calculate run-minutes contribution'
            };
        }
        
        // Build ancestor chain
        const chain = buildAncestorChain(account, allLimits);
        
        // Find which level hit the limit
        let limitingAccount = null;
        let limitingLevel = null;
        
        for (let i = 0; i < chain.length; i++) {
            const ancestorAccount = chain[i];
            const ancestorData = allLimits.accounts[ancestorAccount];
            
            if (!ancestorData || !ancestorData.grpTRESRunMins || !ancestorData.grpTRESRunMins.mem) continue;
            
            // Calculate current usage for this account (including all children)
            const usage = calculateRunMinutesUsage(ancestorAccount, 'mem', allLimits, true);
            
            // Check if adding this job would exceed the limit
            if (usage.total + jobContribution > ancestorData.grpTRESRunMins.mem) {
                limitingAccount = ancestorAccount;
                limitingLevel = i;
                break;
            }
        }
        
        if (!limitingAccount) {
            return { 
                type: 'Info', 
                message: 'Cache shows all accounts below limit, but Slurm reports limit reached',
                details: 'This indicates jobs recently started/completed. Cache updates every 30 seconds - check back shortly.'
            };
        }
        
        const limitingData = allLimits.accounts[limitingAccount];
        const usage = calculateRunMinutesUsage(limitingAccount, 'mem', allLimits, true);
        
        // Format values
        const limitFormatted = formatRunMinutes(limitingData.grpTRESRunMins.mem, 'mem');
        const usageFormatted = formatRunMinutes(usage.total, 'mem');
        const availableFormatted = formatRunMinutes(Math.max(0, limitingData.grpTRESRunMins.mem - usage.total), 'mem');
        const jobContributionFormatted = formatRunMinutes(jobContribution, 'mem');
        const shortfall = Math.min(0, limitingData.grpTRESRunMins.mem - usage.total - jobContribution);
        const shortfallFormatted = formatRunMinutes(Math.abs(shortfall), 'mem');
        
        // Build hierarchy info
        const hierarchy = chain.map((acc, index) => {
            const accData = allLimits.accounts[acc];
            const accUsage = calculateRunMinutesUsage(acc, 'mem', allLimits, true);
            
            return {
                account: acc,
                level: index,
                hasLimit: !!accData.grpTRESRunMins?.mem,
                isLimiting: acc === limitingAccount,
                limit: accData.grpTRESRunMins?.mem ? {
                    value: accData.grpTRESRunMins.mem,
                    formatted: formatRunMinutes(accData.grpTRESRunMins.mem, 'mem').display
                } : null,
                usage: accData.grpTRESRunMins?.mem ? {
                    value: accUsage.total,
                    formatted: formatRunMinutes(accUsage.total, 'mem').display,
                    percent: ((accUsage.total / accData.grpTRESRunMins.mem) * 100).toFixed(1),
                    runningJobs: accUsage.jobCount
                } : null,
                available: accData.grpTRESRunMins?.mem ? {
                    value: Math.max(0, accData.grpTRESRunMins.mem - accUsage.total),
                    formatted: formatRunMinutes(Math.max(0, accData.grpTRESRunMins.mem - accUsage.total), 'mem').display
                } : null,
                parent: accData.parent
            };
        });
        
        return {
            type: 'AssocGrpMemRunMinutes',
            jobId: jobId,
            account: account,
            user: user,
            limitingAccount: limitingAccount,
            limitingLevel: limitingLevel,
            isDirectAccount: limitingAccount === account,
            hierarchy: hierarchy,
            job: {
                account: account,
                user: user,
                requested: {
                    memory: jobMemory,
                    memoryFormatted: formatMemory(jobMemory),
                    timeLimit: jobTimeLimit,
                    contribution: jobContribution,
                    contributionFormatted: jobContributionFormatted.display
                }
            },
            analysis: {
                limitingAccount: limitingAccount,
                limit: limitingData.grpTRESRunMins.mem,
                limitFormatted: limitFormatted.display,
                limitTooltip: limitFormatted.tooltip,
                currentUsage: usage.total,
                currentUsageFormatted: usageFormatted.display,
                currentUsageTooltip: usageFormatted.tooltip,
                percentUsed: ((usage.total / limitingData.grpTRESRunMins.mem) * 100).toFixed(1),
                available: Math.max(0, limitingData.grpTRESRunMins.mem - usage.total),
                availableFormatted: availableFormatted.display,
                availableTooltip: availableFormatted.tooltip,
                shortfall: shortfall,
                shortfallFormatted: shortfallFormatted.display,
                runningJobs: usage.jobCount,
                topConsumers: usage.topConsumers || []
            }
        };
        
    } catch (error) {
        console.error(`Error analyzing AssocGrpMemRunMinutes for job ${jobId}:`, error.message);
        return { type: 'Error', message: error.message };
    }
};

/**
 * Calculate run-minutes usage for an account and resource
 * @param {string} account - Account name
 * @param {string} resource - Resource type ('cpu', 'mem', 'node')
 * @param {Object} allLimits - All account limits data
 * @param {boolean} includeChildren - Whether to include child account usage
 * @returns {Object} - { total, jobCount, topConsumers: [] }
 */
function calculateRunMinutesUsage(account, resource, allLimits, includeChildren = false) {
    const { calculateJobRunMinutes } = require('../helpers/runMinutesUtils.js');
    
    const jobsData = dataCache.getData('jobs');
    const usage = { total: 0, jobCount: 0, topConsumers: [] };
    
    if (!jobsData || !jobsData.jobs) {
        return usage;
    }
    
    // Get list of accounts to check
    let accountsToCheck = [account];
    if (includeChildren) {
        accountsToCheck = getAllDescendantAccounts(account, allLimits);
    }
    
    const jobContributions = [];
    
    // Sum usage from RUNNING jobs
    jobsData.jobs.forEach(job => {
        if (job.job_state === 'RUNNING' && accountsToCheck.includes(job.account)) {
            const contribution = calculateJobRunMinutes(job, resource);
            
            // Skip jobs with UNLIMITED time limit
            if (contribution !== null && contribution > 0) {
                usage.total += contribution;
                usage.jobCount++;
                
                jobContributions.push({
                    jobId: job.job_id,
                    user: job.user_name,
                    account: job.account,
                    contribution: contribution
                });
            }
        }
    });
    
    // Sort by contribution and get top 10
    jobContributions.sort((a, b) => b.contribution - a.contribution);
    usage.topConsumers = jobContributions.slice(0, 10);
    
    return usage;
}

/**
 * Analyze a job pending due to AssocGrpMemLimit
 * @param {string} jobId - Job ID
 * @param {Object} jobData - Parsed job data from scontrol
 * @returns {Object} Memory limit analysis result
 */
const analyzeAssocGrpMemLimit = (jobId, jobData) => {
    try {
        const { buildAncestorChain, getEffectiveLimit, formatMemory, parseMemoryToMB } = require('../helpers/accountLimits.js');
        
        // Get account limits from cache
        const allLimits = dataCache.getAccountLimits();
        if (!allLimits) {
            return { type: 'Error', message: 'Account limits not available' };
        }
        
        const account = jobData.Account;
        const user = jobData.UserId ? jobData.UserId.split('(')[0] : null;
        
        // Get job memory request from parsed TRES (use ReqTRES for pending jobs)
        const jobMemory = jobData.ReqTRES?.mem || 0;
        
        // Build ancestor chain
        const chain = buildAncestorChain(account, allLimits);
        
        // Find which level hit the limit
        let limitingAccount = null;
        let limitingLevel = null;
        
        for (let i = 0; i < chain.length; i++) {
            const ancestorAccount = chain[i];
            const ancestorData = allLimits.accounts[ancestorAccount];
            
            if (!ancestorData || !ancestorData.grpMem) continue;
            
            // Calculate current usage for this account (including all children)
            const usage = calculateAccountUsage(ancestorAccount, allLimits, true);
            
            // Check if adding this job would exceed the limit
            // Slurm uses: if (current_usage + job_request > limit) then block
            if (usage.memory + jobMemory > ancestorData.grpMem) {
                limitingAccount = ancestorAccount;
                limitingLevel = i;
                break;
            }
        }
        
        if (!limitingAccount) {
            return { 
                type: 'Info', 
                message: 'Cache shows all accounts below limit, but Slurm reports limit reached',
                details: 'This indicates jobs recently started/completed. Cache updates every 30 seconds - check back shortly.'
            };
        }
        
        const limitingData = allLimits.accounts[limitingAccount];
        const usage = calculateAccountUsage(limitingAccount, allLimits, true);
        
        // Build hierarchy info
        const hierarchy = chain.map((acc, index) => {
            const accData = allLimits.accounts[acc];
            const accUsage = calculateAccountUsage(acc, allLimits, true);
            
            return {
                account: acc,
                level: index,
                hasLimit: !!accData.grpMem,
                isLimiting: acc === limitingAccount,
                limit: accData.grpMem ? {
                    value: accData.grpMem,
                    formatted: formatMemory(accData.grpMem)
                } : null,
                usage: accData.grpMem ? {
                    value: accUsage.memory,
                    formatted: formatMemory(accUsage.memory),
                    percent: ((accUsage.memory / accData.grpMem) * 100).toFixed(1),
                    runningJobs: accUsage.jobCount
                } : null,
                available: accData.grpMem ? {
                    value: Math.max(0, accData.grpMem - accUsage.memory),
                    formatted: formatMemory(Math.max(0, accData.grpMem - accUsage.memory))
                } : null,
                parent: accData.parent
            };
        });
        
        return {
            type: 'AssocGrpMemLimit',
            jobId: jobId,
            account: account,
            user: user,
            limitingAccount: limitingAccount,
            limitingLevel: limitingLevel,
            isDirectAccount: limitingAccount === account,
            hierarchy: hierarchy,
            job: {
                account: account,
                user: user,
                requested: {
                    memory: jobMemory,
                    formatted: formatMemory(jobMemory)
                }
            },
            analysis: {
                limitingAccount: limitingAccount,
                limit: limitingData.grpMem,
                limitFormatted: formatMemory(limitingData.grpMem),
                currentUsage: usage.memory,
                currentUsageFormatted: formatMemory(usage.memory),
                percentUsed: ((usage.memory / limitingData.grpMem) * 100).toFixed(1),
                available: Math.max(0, limitingData.grpMem - usage.memory),
                availableFormatted: formatMemory(Math.max(0, limitingData.grpMem - usage.memory)),
                shortfall: Math.min(0, limitingData.grpMem - usage.memory - jobMemory),
                shortfallFormatted: formatMemory(Math.abs(Math.min(0, limitingData.grpMem - usage.memory - jobMemory))),
                runningJobs: usage.jobCount
            }
        };
        
    } catch (error) {
        console.error(`Error analyzing AssocGrpMemLimit for job ${jobId}:`, error.message);
        return { type: 'Error', message: error.message };
    }
};

/**
 * Analyze a job pending due to AssocGrpCPULimit
 * @param {string} jobId - Job ID
 * @param {Object} jobData - Parsed job data from scontrol
 * @returns {Object} CPU limit analysis result
 */
const analyzeAssocGrpCPULimit = (jobId, jobData) => {
    try {
        const { buildAncestorChain, getEffectiveLimit } = require('../helpers/accountLimits.js');
        
        // Get account limits from cache
        const allLimits = dataCache.getAccountLimits();
        if (!allLimits) {
            return { type: 'Error', message: 'Account limits not available' };
        }
        
        const account = jobData.Account;
        const user = jobData.UserId ? jobData.UserId.split('(')[0] : null;
        
        // Get job CPU request from parsed TRES (use ReqTRES for pending jobs)
        const jobCPUs = jobData.ReqTRES?.cpu || 0;
        
        // Build ancestor chain
        const chain = buildAncestorChain(account, allLimits);
        
        // Find which level hit the limit
        let limitingAccount = null;
        let limitingLevel = null;
        
        for (let i = 0; i < chain.length; i++) {
            const ancestorAccount = chain[i];
            const ancestorData = allLimits.accounts[ancestorAccount];
            
            if (!ancestorData || !ancestorData.grpCPUs) continue;
            
            // Calculate current usage for this account (including all children)
            const usage = calculateAccountUsage(ancestorAccount, allLimits, true);
            
            // Check if adding this job would exceed the limit
            // Slurm uses: if (current_usage + job_request > limit) then block
            if (usage.cpus + jobCPUs > ancestorData.grpCPUs) {
                limitingAccount = ancestorAccount;
                limitingLevel = i;
                break;
            }
        }
        
        if (!limitingAccount) {
            return { 
                type: 'Info', 
                message: 'Cache shows all accounts below limit, but Slurm reports limit reached',
                details: 'This indicates jobs recently started/completed. Cache updates every 30 seconds - check back shortly.'
            };
        }
        
        const limitingData = allLimits.accounts[limitingAccount];
        const usage = calculateAccountUsage(limitingAccount, allLimits, true);
        
        // Build hierarchy info
        const hierarchy = chain.map((acc, index) => {
            const accData = allLimits.accounts[acc];
            const accUsage = calculateAccountUsage(acc, allLimits, true);
            
            return {
                account: acc,
                level: index,
                hasLimit: !!accData.grpCPUs,
                isLimiting: acc === limitingAccount,
                limit: accData.grpCPUs ? {
                    value: accData.grpCPUs,
                    formatted: accData.grpCPUs.toLocaleString()
                } : null,
                usage: accData.grpCPUs ? {
                    value: accUsage.cpus,
                    formatted: accUsage.cpus.toLocaleString(),
                    percent: ((accUsage.cpus / accData.grpCPUs) * 100).toFixed(1),
                    runningJobs: accUsage.jobCount
                } : null,
                available: accData.grpCPUs ? {
                    value: Math.max(0, accData.grpCPUs - accUsage.cpus),
                    formatted: Math.max(0, accData.grpCPUs - accUsage.cpus).toLocaleString()
                } : null,
                parent: accData.parent
            };
        });
        
        return {
            type: 'AssocGrpCpuLimit',
            jobId: jobId,
            account: account,
            user: user,
            limitingAccount: limitingAccount,
            limitingLevel: limitingLevel,
            isDirectAccount: limitingAccount === account,
            hierarchy: hierarchy,
            job: {
                account: account,
                user: user,
                requested: {
                    cpus: jobCPUs,
                    formatted: jobCPUs.toLocaleString()
                }
            },
            analysis: {
                limitingAccount: limitingAccount,
                limit: limitingData.grpCPUs,
                limitFormatted: limitingData.grpCPUs.toLocaleString(),
                currentUsage: usage.cpus,
                currentUsageFormatted: usage.cpus.toLocaleString(),
                percentUsed: ((usage.cpus / limitingData.grpCPUs) * 100).toFixed(1),
                available: Math.max(0, limitingData.grpCPUs - usage.cpus),
                availableFormatted: Math.max(0, limitingData.grpCPUs - usage.cpus).toLocaleString(),
                shortfall: Math.min(0, limitingData.grpCPUs - usage.cpus - jobCPUs),
                shortfallFormatted: Math.abs(Math.min(0, limitingData.grpCPUs - usage.cpus - jobCPUs)).toLocaleString(),
                runningJobs: usage.jobCount
            }
        };
        
    } catch (error) {
        console.error(`Error analyzing AssocGrpCpuLimit for job ${jobId}:`, error.message);
        return { type: 'Error', message: error.message };
    }
};

/**
 * Analyze a job pending due to AssocGrpGRES
 * @param {string} jobId - Job ID
 * @param {Object} jobData - Parsed job data from scontrol
 * @returns {Object} GRES limit analysis result
 */
const analyzeAssocGrpGRES = (jobId, jobData) => {
    try {
        const { buildAncestorChain } = require('../helpers/accountLimits.js');
        
        // Get account limits from cache
        const allLimits = dataCache.getAccountLimits();
        if (!allLimits) {
            return { type: 'Error', message: 'Account limits not available' };
        }
        
        const account = jobData.Account;
        const user = jobData.UserId ? jobData.UserId.split('(')[0] : null;
        
        // Get job GRES request from parsed TRES (use ReqTRES for pending jobs)
        const jobGres = jobData.ReqTRES?.gpu || { total: 0, types: {} };
        
        // Build ancestor chain
        const chain = buildAncestorChain(account, allLimits);
        
        // Find which level hit the limit
        let limitingAccount = null;
        let limitingLevel = null;
        let limitingGresType = 'gpu'; // Default to total GPU
        
        for (let i = 0; i < chain.length; i++) {
            const ancestorAccount = chain[i];
            const ancestorData = allLimits.accounts[ancestorAccount];
            
            if (!ancestorData || !ancestorData.grpTRES || !ancestorData.grpTRES.gres) continue;
            
            // Calculate current usage for this account (including all children)
            const usage = calculateAccountGRESUsage(ancestorAccount, allLimits, true);
            
            // Check total GPU limit if it exists
            if (ancestorData.grpTRES.gres.gpu) {
                const limit = ancestorData.grpTRES.gres.gpu;
                if (usage.total + jobGres.total > limit) {
                    limitingAccount = ancestorAccount;
                    limitingLevel = i;
                    limitingGresType = 'gpu';
                    break;
                }
            }
            
            // Check specific GPU type limits
            for (const gresType in ancestorData.grpTRES.gres) {
                if (gresType === 'gpu') continue; // Already checked total
                
                const limit = ancestorData.grpTRES.gres[gresType];
                
                // Extract the GPU type name from the key (e.g., 'gpu:a100' -> 'a100')
                const typeName = gresType.includes(':') ? gresType.split(':')[1] : gresType;
                const jobRequest = jobGres.types[typeName] || 0;
                const currentUsage = usage.types[typeName] || 0;
                
                if (currentUsage + jobRequest > limit) {
                    limitingAccount = ancestorAccount;
                    limitingLevel = i;
                    limitingGresType = gresType;
                    break;
                }
            }
            
            if (limitingAccount) break;
        }
        
        if (!limitingAccount) {
            return { 
                type: 'Info', 
                message: 'Cache shows all accounts below limit, but Slurm reports limit reached',
                details: 'This indicates jobs recently started/completed. Cache updates every 30 seconds - check back shortly.'
            };
        }
        
        const limitingData = allLimits.accounts[limitingAccount];
        const usage = calculateAccountGRESUsage(limitingAccount, allLimits, true);
        
        // Determine limit and usage for the limiting GRES type
        const limit = limitingGresType === 'gpu' 
            ? limitingData.grpTRES.gres.gpu 
            : limitingData.grpTRES.gres[limitingGresType];
        
        // Extract type name for usage/request lookup (e.g., 'gpu:a100' -> 'a100')
        const typeName = limitingGresType.includes(':') ? limitingGresType.split(':')[1] : limitingGresType;
        const currentUsage = limitingGresType === 'gpu' 
            ? usage.total 
            : (usage.types[typeName] || 0);
        const jobRequest = limitingGresType === 'gpu' 
            ? jobGres.total 
            : (jobGres.types[typeName] || 0);
        
        // Build hierarchy info
        const hierarchy = chain.map((acc, index) => {
            const accData = allLimits.accounts[acc];
            const accUsage = calculateAccountGRESUsage(acc, allLimits, true);
            
            // Get limit for this GRES type at this level
            const accLimit = accData.grpTRES?.gres?.[limitingGresType] || null;
            
            // Extract type name for usage lookup
            const typeName = limitingGresType.includes(':') ? limitingGresType.split(':')[1] : limitingGresType;
            const accCurrentUsage = limitingGresType === 'gpu' 
                ? accUsage.total 
                : (accUsage.types[typeName] || 0);
            
            return {
                account: acc,
                level: index,
                hasLimit: !!accLimit,
                isLimiting: acc === limitingAccount,
                limit: accLimit ? {
                    value: accLimit,
                    formatted: accLimit.toLocaleString()
                } : null,
                usage: accLimit ? {
                    value: accCurrentUsage,
                    formatted: accCurrentUsage.toLocaleString(),
                    percent: ((accCurrentUsage / accLimit) * 100).toFixed(1),
                    runningJobs: accUsage.jobCount
                } : null,
                available: accLimit ? {
                    value: Math.max(0, accLimit - accCurrentUsage),
                    formatted: Math.max(0, accLimit - accCurrentUsage).toLocaleString()
                } : null,
                parent: accData.parent
            };
        });
        
        return {
            type: 'AssocGrpGRES',
            jobId: jobId,
            account: account,
            user: user,
            limitingAccount: limitingAccount,
            limitingLevel: limitingLevel,
            isDirectAccount: limitingAccount === account,
            gresType: limitingGresType,
            hierarchy: hierarchy,
            job: {
                account: account,
                user: user,
                requested: {
                    gres: jobRequest,
                    formatted: `${jobRequest} ${limitingGresType}`
                }
            },
            analysis: {
                limitingAccount: limitingAccount,
                gresType: limitingGresType,
                limit: limit,
                limitFormatted: limit.toLocaleString(),
                currentUsage: currentUsage,
                currentUsageFormatted: currentUsage.toLocaleString(),
                percentUsed: ((currentUsage / limit) * 100).toFixed(1),
                available: Math.max(0, limit - currentUsage),
                availableFormatted: Math.max(0, limit - currentUsage).toLocaleString(),
                shortfall: Math.min(0, limit - currentUsage - jobRequest),
                shortfallFormatted: Math.abs(Math.min(0, limit - currentUsage - jobRequest)).toLocaleString(),
                runningJobs: usage.jobCount
            }
        };
        
    } catch (error) {
        console.error(`Error analyzing AssocGrpGRES for job ${jobId}:`, error.message);
        return { type: 'Error', message: error.message };
    }
};

/**
 * Calculate account GRES usage from cached jobs
 * @param {string} account - Account name
 * @param {Object} allLimits - All account limits data
 * @param {boolean} includeChildren - Whether to include child account usage
 * @returns {Object} - { total, types: {}, jobCount }
 */
function calculateAccountGRESUsage(account, allLimits, includeChildren = false) {
    const jobsData = dataCache.getData('jobs');
    const usage = { total: 0, types: {}, jobCount: 0 };
    
    if (!jobsData || !jobsData.jobs) {
        return usage;
    }
    
    // Get list of accounts to check
    let accountsToCheck = [account];
    if (includeChildren) {
        accountsToCheck = getAllDescendantAccounts(account, allLimits);
    }
    
    // Sum usage from RUNNING jobs
    jobsData.jobs.forEach(job => {
        if (job.job_state === 'RUNNING' && accountsToCheck.includes(job.account)) {
            const gpusToUse = parseInt(job.alloc_gpus || job.total_gpus) || 0;
            usage.total += gpusToUse;
            
            // Track GPU types if available
            if (job.gpu_allocations && Array.isArray(job.gpu_allocations)) {
                job.gpu_allocations.forEach(alloc => {
                    const type = alloc.type || 'gpu';
                    usage.types[type] = (usage.types[type] || 0) + (alloc.count || 0);
                });
            }
            
            if (gpusToUse > 0) {
                usage.jobCount++;
            }
        }
    });
    
    return usage;
}

/**
 * Calculate account usage (memory, CPUs, GPUs) from cached jobs
 * @param {string} account - Account name
 * @param {Object} allLimits - All account limits data
 * @param {boolean} includeChildren - Whether to include child account usage
 * @returns {Object} - { memory, cpus, gpus, jobCount }
 */
function calculateAccountUsage(account, allLimits, includeChildren = false) {
    const jobsData = dataCache.getData('jobs');
    const usage = { memory: 0, cpus: 0, gpus: 0, jobCount: 0 };
    
    if (!jobsData || !jobsData.jobs) {
        return usage;
    }
    
    // Get list of accounts to check
    let accountsToCheck = [account];
    if (includeChildren) {
        accountsToCheck = getAllDescendantAccounts(account, allLimits);
    }
    
    const { parseMemoryToMB } = require('../helpers/accountLimits.js');
    
    // Sum usage from RUNNING jobs
    // Note: We need to use allocated resources (AllocTRES), not requested (ReqTRES)
    // because Slurm counts what's actually allocated toward the limit
    jobsData.jobs.forEach(job => {
        if (job.job_state === 'RUNNING' && accountsToCheck.includes(job.account)) {
            // For running jobs, use alloc_tres if available (actual allocation),
            // otherwise fall back to total_memory (which comes from ReqTRES)
            const memToUse = job.alloc_memory || job.total_memory;
            const cpusToUse = job.alloc_cpus || job.total_cpus;
            const gpusToUse = job.alloc_gpus || job.total_gpus;
            
            usage.memory += parseMemoryToMB(memToUse);
            usage.cpus += parseInt(cpusToUse) || 0;
            usage.gpus += parseInt(gpusToUse) || 0;
            usage.jobCount++;
        }
    });
    
    return usage;
}

/**
 * Get all descendant accounts (children, grandchildren, etc.)
 * @param {string} parentAccount - Parent account name
 * @param {Object} allLimits - All account limits data
 * @returns {Array<string>} - List of account names including parent
 */
function getAllDescendantAccounts(parentAccount, allLimits) {
    const descendants = [parentAccount];
    
    Object.keys(allLimits.accounts).forEach(account => {
        if (allLimits.accounts[account].parent === parentAccount) {
            descendants.push(account);
            // Recursively get their children
            const childDescendants = getAllDescendantAccounts(account, allLimits);
            childDescendants.forEach(desc => {
                if (!descendants.includes(desc)) {
                    descendants.push(desc);
                }
            });
        }
    });
    
    return descendants;
}

module.exports = {
    getPendingReason
};
