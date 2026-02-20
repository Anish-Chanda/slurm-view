const { getPendingReason } = require("../../handlers/fetchPendingReason");
const { executeCommand } = require("../../helpers/executeCmd");
const dataCache = require("../../modules/dataCache");
const priorityUtils = require("../../helpers/priorityUtils");

jest.mock("../../helpers/executeCmd");
jest.mock("../../modules/dataCache", () => ({
    getPendingReason: jest.fn(),
    setPendingReason: jest.fn(),
    getJobById: jest.fn(),
    getAccountLimits: jest.fn(),
    getData: jest.fn()
}));
jest.mock("../../helpers/priorityUtils");

describe("getPendingReason", () => {
    beforeEach(() => {
        jest.resetAllMocks();
        // Default: no job in cache (fallback to scontrol)
        dataCache.getJobById.mockReturnValue(null);
    });

    it("should return cached data if available", async () => {
        const cachedData = { type: 'Resources', summary: {} };
        dataCache.getPendingReason.mockReturnValue(cachedData);

        const result = await getPendingReason('123');
        expect(result).toEqual(cachedData);
        expect(executeCommand).not.toHaveBeenCalled();
    });

    it("should return status message if job is not pending", async () => {
        executeCommand.mockReturnValue("JobId=123 JobState=RUNNING Reason=None");
        
        const result = await getPendingReason('123');
        expect(result.type).toBe('Status');
        expect(result.message).toContain('RUNNING');
    });

    it("should return other reason message if reason is not Resources or Priority", async () => {
        executeCommand.mockReturnValue("JobId=123 JobState=PENDING Reason=Licenses");
        
        const result = await getPendingReason('123');
        expect(result.type).toBe('Other');
        expect(result.message).toContain('Licenses');
    });

    it("should analyze specific node if SchedNodeList is present", async () => {
        // Mock Job Info
        executeCommand.mockReturnValueOnce(
            "JobId=123 JobState=PENDING Reason=Resources ReqTRES=cpu=10,mem=100G SchedNodeList=node1 Partition=debug"
        );

        // Mock Node Info
        executeCommand.mockReturnValueOnce(
            "NodeName=node1 CfgTRES=cpu=20,mem=200G AllocTRES=cpu=15,mem=150G"
        );

        const result = await getPendingReason('123');
        
        expect(result.type).toBe('Resources');
        expect(result.scope).toBe('Scheduled Node');
        expect(result.details).toHaveLength(1);
        expect(result.details[0].name).toBe('node1');
        
        // Available: CPU=5, Mem=50G. Req: CPU=10, Mem=100G. Both bottleneck.
        expect(result.details[0].bottlenecks).toHaveLength(2);
        expect(result.details[0].isBlocked).toBe(true);
    });

    it("should analyze partition nodes if no specific node requested", async () => {
        // Mock Job Info
        executeCommand.mockReturnValueOnce(
            "JobId=123 JobState=PENDING Reason=Resources ReqTRES=cpu=10,mem=100G Partition=debug"
        );

        // Mock Partition Info (sinfo)
        executeCommand.mockReturnValueOnce("node1,node2");

        // Mock Node Info (scontrol show node node1,node2)
        executeCommand.mockReturnValueOnce(
            "NodeName=node1 CfgTRES=cpu=20,mem=200G AllocTRES=cpu=15,mem=150G\n\n" +
            "NodeName=node2 CfgTRES=cpu=20,mem=200G AllocTRES=cpu=5,mem=50G"
        );

        const result = await getPendingReason('123');
        
        expect(result.scope).toBe('Partition');
        expect(result.details).toHaveLength(2);
        
        // Node1: Avail CPU=5, Mem=50G. Req: 10, 100G. Blocked.
        const node1 = result.details.find(n => n.name === 'node1');
        expect(node1.isBlocked).toBe(true);
        
        // Node2: Avail CPU=15, Mem=150G. Req: 10, 100G. Not Blocked.
        const node2 = result.details.find(n => n.name === 'node2');
        expect(node2.isBlocked).toBe(false);
        
        expect(result.summary.blockedNodes).toBe(1);
        expect(result.summary.freeNodes).toBe(1);
    });

    it("should analyze priority pending reason", async () => {
        // Mock Job Info
        executeCommand.mockReturnValue(
            "JobId=9156162 JobState=PENDING Reason=Priority Partition=nova"
        );

        // Mock priority utils
        priorityUtils.getJobPriority.mockReturnValue({
            jobId: '9156162',
            partition: 'nova',
            priority: 35940,
            components: {
                site: 0,
                age: 1000,
                fairshare: 24923,
                jobsize: 17,
                partition: 10000,
                qos: 0
            },
            weights: {
                site: 1,
                age: 1000,
                fairshare: 100000,
                jobsize: 10000,
                partition: 100000,
                qos: 1
            }
        });

        priorityUtils.getCompetingJobs.mockReturnValue({
            higherPriorityCount: 5,
            competitors: [
                { jobId: '9244468', priority: 60954, user: 'ecoppen', state: 'PENDING' },
                { jobId: '9234494', priority: 61682, user: 'isaakd', state: 'PENDING' }
            ],
            totalPending: 20
        });

        priorityUtils.getRunningJobsCount.mockReturnValue(15);

        priorityUtils.calculateContributions.mockReturnValue({
            site: '0.0',
            age: '0.0',
            fairshare: '71.3',
            jobsize: '0.0',
            partition: '28.6',
            qos: '0.0'
        });

        const result = await getPendingReason('9156162');

        expect(result.type).toBe('Priority');
        expect(result.jobId).toBe('9156162');
        expect(result.partition).toBe('nova');
        expect(result.priority.total).toBe(35940);
        expect(result.competition.higherPriorityCount).toBe(5);
        expect(result.competition.runningJobs).toBe(15);
        expect(result.queuePosition).toBe(6);
        expect(dataCache.setPendingReason).toHaveBeenCalled();
    });

    it("should fallback to Other type if priority analysis fails", async () => {
        executeCommand.mockReturnValue("JobId=123 JobState=PENDING Reason=Priority Partition=nova");
        
        priorityUtils.getJobPriority.mockImplementation(() => {
            throw new Error("sprio command failed");
        });

        const result = await getPendingReason('123');

        expect(result.type).toBe('Other');
        expect(result.message).toContain('Priority');
        expect(result.message).toContain('detailed analysis unavailable');
    });

    it("should handle errors gracefully", async () => {
        executeCommand.mockImplementation(() => {
            throw new Error("Command failed");
        });

        const result = await getPendingReason('123');
        expect(result.type).toBe('Error');
        expect(result.message).toBe('Command failed');
    });

    describe("Dependency pending reason", () => {
        it("should analyze dependency with afterok type", async () => {
            // Mock Job Info with Dependency
            executeCommand.mockReturnValueOnce(
                "JobId=456 JobState=PENDING Reason=Dependency Dependency=afterok:123 Partition=debug"
            );

            // Mock dependent job info
            executeCommand.mockReturnValueOnce(
                "JobId=123 JobState=COMPLETED ExitCode=0:0 EndTime=2024-01-09T10:00:00"
            );

            const result = await getPendingReason('456');

            expect(result.type).toBe('Dependency');
            expect(result.jobId).toBe('456');
            expect(result.rawDependency).toBe('afterok:123');
            expect(result.dependencies).toHaveLength(1);
            expect(result.dependencies[0].type).toBe('afterok');
            expect(result.dependencies[0].jobs).toHaveLength(1);
            expect(result.dependencies[0].jobs[0].jobId).toBe('123');
            expect(result.dependencies[0].jobs[0].state).toBe('COMPLETED');
            expect(result.dependencies[0].satisfied).toBe(true);
            expect(result.allSatisfied).toBe(true);
        });

        it("should handle dependency with multiple jobs", async () => {
            // Mock Job Info
            executeCommand.mockReturnValueOnce(
                "JobId=789 JobState=PENDING Reason=Dependency Dependency=afterok:123:456 Partition=debug"
            );

            // Mock first dependent job (completed successfully)
            executeCommand.mockReturnValueOnce(
                "JobId=123 JobState=COMPLETED ExitCode=0:0 EndTime=2024-01-09T10:00:00"
            );

            // Mock second dependent job (still running)
            executeCommand.mockReturnValueOnce(
                "JobId=456 JobState=RUNNING Partition=debug"
            );

            const result = await getPendingReason('789');

            expect(result.type).toBe('Dependency');
            expect(result.dependencies).toHaveLength(1);
            expect(result.dependencies[0].jobs).toHaveLength(2);
            expect(result.dependencies[0].jobs[0].satisfied).toBe(true);
            expect(result.dependencies[0].jobs[1].satisfied).toBe(false);
            expect(result.dependencies[0].satisfied).toBe(false);
            expect(result.allSatisfied).toBe(false);
        });

        it("should handle afterany dependency", async () => {
            // Mock Job Info
            executeCommand.mockReturnValueOnce(
                "JobId=999 JobState=PENDING Reason=Dependency Dependency=afterany:888 Partition=debug"
            );

            // Mock dependent job (failed)
            executeCommand.mockReturnValueOnce(
                "JobId=888 JobState=COMPLETED ExitCode=1:0 EndTime=2024-01-09T10:00:00"
            );

            const result = await getPendingReason('999');

            expect(result.type).toBe('Dependency');
            expect(result.dependencies[0].type).toBe('afterany');
            expect(result.dependencies[0].jobs[0].satisfied).toBe(true);
            expect(result.allSatisfied).toBe(true);
        });

        it("should handle afternotok dependency", async () => {
            // Mock Job Info
            executeCommand.mockReturnValueOnce(
                "JobId=555 JobState=PENDING Reason=Dependency Dependency=afternotok:444 Partition=debug"
            );

            // Mock dependent job (failed with non-zero exit code)
            executeCommand.mockReturnValueOnce(
                "JobId=444 JobState=COMPLETED ExitCode=5:0 EndTime=2024-01-09T10:00:00"
            );

            const result = await getPendingReason('555');

            expect(result.type).toBe('Dependency');
            expect(result.dependencies[0].type).toBe('afternotok');
            expect(result.dependencies[0].jobs[0].exitCode).toBe('5:0');
            expect(result.dependencies[0].jobs[0].satisfied).toBe(true);
            expect(result.allSatisfied).toBe(true);
        });

        it("should handle singleton dependency", async () => {
            // Mock Job Info
            executeCommand.mockReturnValueOnce(
                "JobId=777 JobState=PENDING Reason=Dependency Dependency=singleton Partition=debug"
            );

            const result = await getPendingReason('777');

            expect(result.type).toBe('Dependency');
            expect(result.dependencies).toHaveLength(1);
            expect(result.dependencies[0].type).toBe('singleton');
            expect(result.dependencies[0].description).toContain('one job');
        });

        it("should handle job not found error for dependency", async () => {
            // Mock Job Info
            executeCommand.mockReturnValueOnce(
                "JobId=666 JobState=PENDING Reason=Dependency Dependency=afterok:333 Partition=debug"
            );

            // Mock dependent job not found
            executeCommand.mockImplementationOnce(() => {
                throw new Error("Invalid job id specified");
            });

            const result = await getPendingReason('666');

            expect(result.type).toBe('Dependency');
            expect(result.dependencies[0].jobs[0].state).toBe('UNKNOWN');
            expect(result.dependencies[0].jobs[0].error).toContain('not found');
            expect(result.dependencies[0].satisfied).toBe(false);
        });

        it("should handle null or missing dependency field", async () => {
            // Mock Job Info with null dependency
            executeCommand.mockReturnValueOnce(
                "JobId=111 JobState=PENDING Reason=Dependency Dependency=(null) Partition=debug"
            );

            const result = await getPendingReason('111');

            expect(result.type).toBe('Dependency');
            expect(result.message).toContain('unavailable');
        });

        it("should fallback to Other type if dependency analysis fails", async () => {
            executeCommand.mockReturnValueOnce(
                "JobId=222 JobState=PENDING Reason=Dependency Dependency=afterok:123 Partition=debug"
            );

            // Make executeCommand fail on dependent job query
            executeCommand.mockImplementationOnce(() => {
                throw new Error("Critical error");
            });

            const result = await getPendingReason('222');

            // Should handle gracefully and still return Dependency type
            expect(result.type).toBe('Dependency');
        });
    });

    describe('AssocGrpMemLimit', () => {
        beforeEach(() => {
            jest.resetAllMocks();
            dataCache.getPendingReason = jest.fn().mockReturnValue(null);
        });

        it('should analyze account memory limits for pending job', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'niemi-lab': {
                        parent: 'stat',
                        grpMem: 38000000,
                        grpCPUs: 7200,
                        grpTRES: { mem: 38000000, cpu: 7200 },
                        users: ['user1']
                    },
                    'stat': {
                        parent: 'las',
                        grpMem: null,
                        grpCPUs: null,
                        grpTRES: { mem: null, cpu: null },
                        users: []
                    },
                    'las': {
                        parent: 'research',
                        grpMem: 93959424,
                        grpCPUs: 17000,
                        grpTRES: { mem: 93959424, cpu: 17000 },
                        users: []
                    },
                    'research': {
                        parent: 'root',
                        grpMem: null,
                        grpCPUs: null,
                        grpTRES: { mem: null, cpu: null },
                        users: []
                    },
                    'root': {
                        parent: null,
                        grpMem: null,
                        grpCPUs: null,
                        grpTRES: { mem: null, cpu: null },
                        users: []
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'niemi-lab',
                        job_state: 'RUNNING',
                        alloc_memory: 1000000,
                        alloc_cpus: 10
                    },
                    {
                        job_id: 101,
                        account: 'niemi-lab',
                        job_state: 'RUNNING',
                        alloc_memory: 37500000,
                        alloc_cpus: 100
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'niemi-lab',
                job_state: ['PENDING'],
                total_memory: 378000,
                total_cpus: 10
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpMemLimit Account=niemi-lab ReqTRES=cpu=10,mem=378000M Partition=debug"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocGrpMemLimit');
            expect(result.hierarchy).toBeDefined();
            expect(result.hierarchy.find(acc => acc.account === 'niemi-lab')).toBeDefined();
            expect(result.limitingAccount).toBe('niemi-lab');
        });

        it('should handle missing account limits data', async () => {
            dataCache.getAccountLimits = jest.fn().mockReturnValue(null);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'niemi-lab',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpMemLimit Account=niemi-lab"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('Error');
            expect(result.message).toContain('Account limits not available');
        });

        it('should identify limiting account in hierarchy', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'child-account': {
                        parent: 'parent-account',
                        grpMem: 10000,
                        grpCPUs: 100,
                        grpTRES: { mem: 10000, cpu: 100 }
                    },
                    'parent-account': {
                        parent: 'root',
                        grpMem: 50000,
                        grpCPUs: 500,
                        grpTRES: { mem: 50000, cpu: 500 }
                    },
                    'root': {
                        parent: null,
                        grpMem: null,
                        grpCPUs: null,
                        grpTRES: { mem: null, cpu: null }
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'child-account',
                        job_state: 'RUNNING',
                        alloc_memory: 9000,
                        alloc_cpus: 50
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'child-account',
                total_memory: 2000,
                total_cpus: 10
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpMemLimit Account=child-account ReqTRES=cpu=10,mem=2000M"
            );

            const result = await getPendingReason('200');

            expect(result.limitingAccount).toBe('child-account');
            expect(result.hierarchy.find(acc => acc.account === 'child-account').usage.value).toBeGreaterThan(0);
        });
    });

    describe('AssocGrpCpuLimit', () => {
        beforeEach(() => {
            jest.resetAllMocks();
            dataCache.getPendingReason = jest.fn().mockReturnValue(null);
        });

        it('should analyze account CPU limits for pending job', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'test-account': {
                        parent: 'root',
                        grpMem: 100000,
                        grpCPUs: 500,
                        grpTRES: { mem: 100000, cpu: 500 },
                        users: ['user1']
                    },
                    'root': {
                        parent: null,
                        grpMem: null,
                        grpCPUs: null,
                        grpTRES: { mem: null, cpu: null },
                        users: []
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        alloc_cpus: 495,
                        alloc_memory: 50000
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                total_cpus: 20,
                total_memory: 10000
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpCpuLimit Account=test-account ReqTRES=cpu=20,mem=10000M"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocGrpCpuLimit');
            expect(result.limitingAccount).toBe('test-account');
            expect(result.hierarchy[0].usage.value).toBe(495);
            expect(result.hierarchy[0].limit.value).toBe(500);
        });

        it('should handle missing account limits data for CPU', async () => {
            dataCache.getAccountLimits = jest.fn().mockReturnValue(null);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account'
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpCpuLimit Account=test-account"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('Error');
            expect(result.message).toContain('Account limits not available');
        });
    });

    describe('AssocGrpGRES', () => {
        beforeEach(() => {
            jest.resetAllMocks();
            dataCache.getPendingReason = jest.fn().mockReturnValue(null);
        });

        it('should analyze account GRES limits for pending job', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'test-account': {
                        parent: 'root',
                        grpMem: 100000,
                        grpCPUs: 500,
                        grpTRES: { 
                            mem: 100000, 
                            cpu: 500,
                            gres: {
                                gpu: 20
                            }
                        },
                        users: ['user1']
                    },
                    'root': {
                        parent: null,
                        grpMem: null,
                        grpCPUs: null,
                        grpTRES: { mem: null, cpu: null, gres: {} },
                        users: []
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        alloc_gpus: 18,
                        alloc_cpus: 100,
                        alloc_memory: 50000,
                        gpu_allocations: [
                            { type: 'gpu', count: 18 }
                        ]
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                total_gpus: 4,
                total_cpus: 20,
                total_memory: 10000
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpGRES Account=test-account UserId=user1(1000) ReqTRES=cpu=20,mem=10000M,gres/gpu=4"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocGrpGRES');
            expect(result.limitingAccount).toBe('test-account');
            expect(result.gresType).toBe('gpu');
            expect(result.analysis.limit).toBe(20);
            expect(result.analysis.currentUsage).toBe(18);
            expect(result.analysis.available).toBe(2);
            expect(result.analysis.shortfall).toBe(-2); // Would exceed by 2
        });

        it('should handle specific GPU type limits', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'test-account': {
                        parent: 'root',
                        grpMem: 100000,
                        grpCPUs: 500,
                        grpTRES: { 
                            mem: 100000, 
                            cpu: 500,
                            gres: {
                                gpu: 50,
                                'gpu:a100': 10
                            }
                        },
                        users: ['user1']
                    },
                    'root': {
                        parent: null,
                        grpMem: null,
                        grpCPUs: null,
                        grpTRES: { mem: null, cpu: null, gres: {} },
                        users: []
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        alloc_gpus: 8,
                        alloc_cpus: 100,
                        alloc_memory: 50000,
                        gpu_allocations: [
                            { type: 'a100', count: 8 }
                        ]
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                total_gpus: 4,
                gpu_allocations: [{ type: 'a100', count: 4 }]
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpGRES Account=test-account UserId=user1(1000) ReqTRES=cpu=20,mem=10000M,gres/gpu:a100=4"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocGrpGRES');
            expect(result.limitingAccount).toBe('test-account');
            expect(result.gresType).toBe('gpu:a100');
            expect(result.analysis.limit).toBe(10);
            expect(result.analysis.currentUsage).toBe(8);
        });

        it('should identify parent account as limiter for GRES', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'root': {
                        parent: null,
                        grpMem: 500000,
                        grpCPUs: 2000,
                        grpTRES: { 
                            mem: 500000, 
                            cpu: 2000,
                            gres: {
                                gpu: 30
                            }
                        },
                        users: []
                    },
                    'child-account': {
                        parent: 'root',
                        grpMem: 100000,
                        grpCPUs: 500,
                        grpTRES: { 
                            mem: 100000, 
                            cpu: 500,
                            gres: {
                                gpu: 50 // More than parent, but parent is the limit
                            }
                        },
                        users: ['user1']
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'child-account',
                        job_state: 'RUNNING',
                        alloc_gpus: 28,
                        alloc_cpus: 100,
                        alloc_memory: 50000,
                        gpu_allocations: [
                            { type: 'gpu', count: 28 }
                        ]
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'child-account',
                total_gpus: 4
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpGRES Account=child-account UserId=user1(1000) ReqTRES=cpu=20,mem=10000M,gres/gpu=4"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocGrpGRES');
            expect(result.limitingAccount).toBe('root');
            expect(result.isDirectAccount).toBe(false);
            expect(result.analysis.limit).toBe(30);
            expect(result.analysis.currentUsage).toBe(28);
        });

        it('should handle missing GRES limits', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'test-account': {
                        parent: 'root',
                        grpMem: 100000,
                        grpCPUs: 500,
                        grpTRES: { 
                            mem: 100000, 
                            cpu: 500,
                            gres: {} // No GRES limits
                        },
                        users: ['user1']
                    },
                    'root': {
                        parent: null,
                        grpMem: null,
                        grpCPUs: null,
                        grpTRES: { mem: null, cpu: null, gres: {} },
                        users: []
                    }
                }
            };

            const mockJobs = {
                jobs: []
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                total_gpus: 4
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpGRES Account=test-account UserId=user1(1000) ReqTRES=cpu=20,mem=10000M,gres/gpu=4"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('Info');
            expect(result.message).toContain('Cache shows all accounts below limit');
        });

        it('should handle missing account limits data for GRES', async () => {
            dataCache.getAccountLimits = jest.fn().mockReturnValue(null);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account'
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpGRES Account=test-account"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('Error');
            expect(result.message).toContain('Account limits not available');
        });
    });

    describe('AssocMaxJobsLimit', () => {
        beforeEach(() => {
            jest.resetAllMocks();
            dataCache.getPendingReason = jest.fn().mockReturnValue(null);
        });

        it('should analyze user job limit for pending job', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'test-account': {
                        parent: 'root',
                        grpMem: 100000,
                        grpCPUs: 500,
                        grpTRES: { mem: 100000, cpu: 500, node: null, gres: {} },
                        grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} },
                        maxJobs: null,
                        maxSubmitJobs: null,
                        users: {
                            'testuser': {
                                user: 'testuser',
                                grpCPUs: null,
                                grpMem: null,
                                grpTRES: { mem: null, cpu: null, node: null, gres: {} },
                                grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} },
                                maxJobs: 10,
                                maxSubmitJobs: null
                            }
                        }
                    },
                    'root': {
                        parent: null,
                        grpMem: null,
                        grpCPUs: null,
                        grpTRES: { mem: null, cpu: null, node: null, gres: {} },
                        grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} },
                        maxJobs: null,
                        maxSubmitJobs: null,
                        users: {}
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job1',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:00:00'
                    },
                    {
                        job_id: 101,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job2',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:05:00'
                    },
                    {
                        job_id: 102,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job3',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:10:00'
                    },
                    {
                        job_id: 103,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job4',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:15:00'
                    },
                    {
                        job_id: 104,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job5',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:20:00'
                    },
                    {
                        job_id: 105,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job6',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:25:00'
                    },
                    {
                        job_id: 106,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job7',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:30:00'
                    },
                    {
                        job_id: 107,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job8',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:35:00'
                    },
                    {
                        job_id: 108,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job9',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:40:00'
                    },
                    {
                        job_id: 109,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job10',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:45:00'
                    },
                    {
                        job_id: 110,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'otheruser',
                        job_name: 'other-job',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 11:00:00'
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocMaxJobsLimit Account=test-account UserId=testuser(1000)"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocMaxJobsLimit');
            expect(result.limitingAccount).toBe('test-account');
            expect(result.user).toBe('testuser');
            expect(result.analysis.limit).toBe(10);
            expect(result.analysis.currentJobs).toBe(10);
            expect(result.analysis.percentUsed).toBe('100.0');
            expect(result.analysis.available).toBe(0);
            expect(result.userJobs).toBeDefined();
            expect(result.userJobs.length).toBe(10);
        });

        it('should handle hierarchical account limits', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'child-account': {
                        parent: 'parent-account',
                        grpMem: null,
                        grpCPUs: null,
                        grpTRES: { mem: null, cpu: null, node: null, gres: {} },
                        grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} },
                        maxJobs: null,
                        maxSubmitJobs: null,
                        users: {}
                    },
                    'parent-account': {
                        parent: 'root',
                        grpMem: null,
                        grpCPUs: null,
                        grpTRES: { mem: null, cpu: null, node: null, gres: {} },
                        grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} },
                        maxJobs: null,
                        maxSubmitJobs: null,
                        users: {
                            'testuser': {
                                user: 'testuser',
                                grpCPUs: null,
                                grpMem: null,
                                grpTRES: { mem: null, cpu: null, node: null, gres: {} },
                                grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} },
                                maxJobs: 5,
                                maxSubmitJobs: null
                            }
                        }
                    },
                    'root': {
                        parent: null,
                        grpMem: null,
                        grpCPUs: null,
                        grpTRES: { mem: null, cpu: null, node: null, gres: {} },
                        grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} },
                        maxJobs: null,
                        maxSubmitJobs: null,
                        users: {}
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'child-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job1',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:00:00'
                    },
                    {
                        job_id: 101,
                        account: 'child-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job2',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:05:00'
                    },
                    {
                        job_id: 102,
                        account: 'child-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job3',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:10:00'
                    },
                    {
                        job_id: 103,
                        account: 'child-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job4',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:15:00'
                    },
                    {
                        job_id: 104,
                        account: 'child-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job5',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:20:00'
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'child-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocMaxJobsLimit Account=child-account UserId=testuser(1000)"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocMaxJobsLimit');
            expect(result.limitingAccount).toBe('parent-account');
            expect(result.isDirectAccount).toBe(false);
            expect(result.analysis.limit).toBe(5);
            expect(result.analysis.currentJobs).toBe(5);
        });

        it('should handle missing account limits data', async () => {
            dataCache.getAccountLimits = jest.fn().mockReturnValue(null);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocMaxJobsLimit Account=test-account UserId=testuser(1000)"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('Error');
            expect(result.message).toContain('Account limits not available');
        });

        it('should handle missing user information', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'test-account': {
                        parent: 'root',
                        maxJobs: 10,
                        users: {}
                    },
                    'root': {
                        parent: null,
                        maxJobs: null,
                        users: {}
                    }
                }
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue({ jobs: [] });
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocMaxJobsLimit Account=test-account"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('Error');
            expect(result.message).toContain('User information not available');
        });

        it('should only count running jobs, not pending jobs', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'test-account': {
                        parent: 'root',
                        maxJobs: null,
                        grpTRES: { mem: null, cpu: null, node: null, gres: {} },
                        grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} },
                        users: {
                            'testuser': {
                                user: 'testuser',
                                grpCPUs: null,
                                grpMem: null,
                                grpTRES: { mem: null, cpu: null, node: null, gres: {} },
                                grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} },
                                maxJobs: 3,
                                maxSubmitJobs: null
                            }
                        }
                    },
                    'root': {
                        parent: null,
                        maxJobs: null,
                        grpTRES: { mem: null, cpu: null, node: null, gres: {} },
                        grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} },
                        users: {}
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job1',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:00:00'
                    },
                    {
                        job_id: 101,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job2',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:05:00'
                    },
                    {
                        job_id: 102,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        user_name: 'testuser',
                        job_name: 'job3',
                        partition: 'debug',
                        start_time_formatted: '2024-01-15 10:10:00'
                    },
                    {
                        job_id: 103,
                        account: 'test-account',
                        job_state: 'PENDING',
                        user_name: 'testuser',
                        job_name: 'pending-job',
                        partition: 'debug'
                    },
                    {
                        job_id: 104,
                        account: 'test-account',
                        job_state: 'COMPLETED',
                        user_name: 'testuser',
                        job_name: 'completed-job',
                        partition: 'debug'
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocMaxJobsLimit Account=test-account UserId=testuser(1000)"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocMaxJobsLimit');
            expect(result.analysis.currentJobs).toBe(3);  // Only RUNNING jobs
            expect(result.userJobs.length).toBe(3);
        });
    });

    describe('AssocGrpMemRunMinutes', () => {
        it('should analyze AssocGrpMemRunMinutes limit correctly', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'test-account': {
                        parent: 'root',
                        grpTRESRunMins: {
                            mem: 1474560000, // ~1000 GB-days = 1,474,560,000 MB-minutes
                            cpu: null,
                            node: null,
                            gres: {}
                        }
                    },
                    'root': {
                        parent: null,
                        grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} }
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        alloc_memory: '512G',
                        time_limit: '2-00:00:00', // 2 days = 2880 minutes
                        start_time: Math.floor(Date.now() / 1000) - 3600 // Started 1 hour ago
                        // Contribution: 524,288 MB × 2820 remaining min ≈ 1,478,451,840 MB-min
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpMemRunMinutes Account=test-account UserId=user1(1000) TimeLimit=1-00:00:00 ReqTRES=cpu=20,mem=256G,node=1"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocGrpMemRunMinutes');
            expect(result.analysis).toBeDefined();
            expect(result.analysis.limitingAccount).toBe('test-account');
            expect(result.analysis.limit).toBe(1474560000);
            expect(result.job.requested.memory).toBe(262144); // 256GB in MB
            expect(result.job.requested.contribution).toBeGreaterThan(0);
        });

        it('should handle UNLIMITED time limit', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'test-account': {
                        parent: 'root',
                        grpTRESRunMins: {
                            mem: 1474560000,
                            cpu: null,
                            node: null,
                            gres: {}
                        }
                    },
                    'root': {
                        parent: null,
                        grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} }
                    }
                }
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue({ jobs: [] });
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpMemRunMinutes Account=test-account TimeLimit=UNLIMITED ReqTRES=cpu=20,mem=256G,node=1"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('Info');
            expect(result.message).toContain('UNLIMITED time limit');
        });

        it('should identify parent account as limiting', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'child-account': {
                        parent: 'parent-account',
                        grpTRESRunMins: {
                            mem: 5000000000, // Large child limit
                            cpu: null,
                            node: null,
                            gres: {}
                        }
                    },
                    'parent-account': {
                        parent: 'root',
                        grpTRESRunMins: {
                            mem: 1474560000, // Smaller parent limit
                            cpu: null,
                            node: null,
                            gres: {}
                        }
                    },
                    'root': {
                        parent: null,
                        grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} }
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'child-account',
                        job_state: 'RUNNING',
                        alloc_memory: '512G',
                        time_limit: '2-00:00:00',
                        start_time: Math.floor(Date.now() / 1000) - 3600
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'child-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpMemRunMinutes Account=child-account UserId=user1(1000) TimeLimit=1-00:00:00 ReqTRES=cpu=20,mem=256G,node=1"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocGrpMemRunMinutes');
            expect(result.limitingAccount).toBe('parent-account'); // Parent should be limiting
            expect(result.isDirectAccount).toBe(false);
            expect(result.hierarchy.find(acc => acc.account === 'parent-account' && acc.isLimiting)).toBeDefined();
        });

        it('should calculate usage from multiple running jobs', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'test-account': {
                        parent: 'root',
                        grpTRESRunMins: {
                            mem: 4423680000, // ~3000 GB-days
                            cpu: null,
                            node: null,
                            gres: {}
                        }
                    },
                    'root': {
                        parent: null,
                        grpTRESRunMins: { mem: null, cpu: null, node: null, gres: {} }
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        alloc_memory: '256G',
                        time_limit: '2-00:00:00',
                        start_time: Math.floor(Date.now() / 1000) - 3600
                    },
                    {
                        job_id: 101,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        alloc_memory: '256G',
                        time_limit: '2-00:00:00',
                        start_time: Math.floor(Date.now() / 1000) - 7200
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpMemRunMinutes Account=test-account TimeLimit=5-00:00:00 ReqTRES=cpu=20,mem=1T,node=1"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocGrpMemRunMinutes');
            expect(result.analysis.runningJobs).toBe(2);
            expect(result.analysis.currentUsage).toBeGreaterThan(0);
            expect(result.analysis.shortfall).toBeLessThan(0); // Should exceed limit
        });

        it('should handle missing account limits data', async () => {
            dataCache.getAccountLimits = jest.fn().mockReturnValue(null);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpMemRunMinutes Account=test-account TimeLimit=1-00:00:00 ReqTRES=cpu=20,mem=256G,node=1"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('Error');
            expect(result.message).toContain('Account limits not available');
        });
    });

    describe('AssocGrpCPURunMinutes', () => {
        it('should analyze AssocGrpCPURunMinutes limit correctly', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'test-account': {
                        parent: 'root',
                        grpTRESRunMins: {
                            cpu: 2880000, // ~2000 CPU-days = 2,880,000 CPU-minutes
                            mem: null,
                            node: null,
                            gres: {}
                        }
                    },
                    'root': {
                        parent: null,
                        grpTRESRunMins: { cpu: null, mem: null, node: null, gres: {} }
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        alloc_cpus: 128,
                        time_limit: '2-00:00:00', // 2 days = 2880 minutes
                        start_time: Math.floor(Date.now() / 1000) - 3600 // Started 1 hour ago
                        // Contribution: 128 CPU × 2820 remaining min = 360,960 CPU-min
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpCPURunMinutesLimit Account=test-account UserId=user1(1000) TimeLimit=10-00:00:00 ReqTRES=cpu=256,mem=1T,node=4"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocGrpCPURunMinutes');
            expect(result.analysis).toBeDefined();
            expect(result.analysis.limitingAccount).toBe('test-account');
            expect(result.analysis.limit).toBe(2880000);
            expect(result.job.requested.cpus).toBe(256);
            expect(result.job.requested.contribution).toBeGreaterThan(0);
        });

        it('should handle AssocGrpCPURunMinutesLimit reason code', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'test-account': {
                        parent: 'root',
                        grpTRESRunMins: {
                            cpu: 100000, // Small limit to trigger exceeding
                            mem: null,
                            node: null,
                            gres: {}
                        }
                    },
                    'root': {
                        parent: null,
                        grpTRESRunMins: { cpu: null, mem: null, node: null, gres: {} }
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'test-account',
                        job_state: 'RUNNING',
                        alloc_cpus: 32,
                        time_limit: '1-00:00:00',
                        start_time: Math.floor(Date.now() / 1000) - 3600
                        // Contribution: 32 × 1380 ≈ 44,160 CPU-min
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                job_state: ['PENDING']
            });

            // Test the alternate reason code name
            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpCPURunMinutesLimit Account=test-account TimeLimit=1-00:00:00 ReqTRES=cpu=64,mem=256G,node=1"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocGrpCPURunMinutes');
            expect(result.analysis).toBeDefined();
        });

        it('should handle UNLIMITED time limit', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'test-account': {
                        parent: 'root',
                        grpTRESRunMins: {
                            cpu: 2880000,
                            mem: null,
                            node: null,
                            gres: {}
                        }
                    },
                    'root': {
                        parent: null,
                        grpTRESRunMins: { cpu: null, mem: null, node: null, gres: {} }
                    }
                }
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue({ jobs: [] });
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpCPURunMinutesLimit Account=test-account TimeLimit=UNLIMITED ReqTRES=cpu=64,mem=256G,node=1"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('Info');
            expect(result.message).toContain('UNLIMITED time limit');
        });

        it('should identify parent account as limiting', async () => {
            const mockAccountLimits = {
                timestamp: Date.now(),
                accounts: {
                    'child-account': {
                        parent: 'parent-account',
                        grpTRESRunMins: {
                            cpu: 10000000, // Large child limit
                            mem: null,
                            node: null,
                            gres: {}
                        }
                    },
                    'parent-account': {
                        parent: 'root',
                        grpTRESRunMins: {
                            cpu: 2880000, // Smaller parent limit
                            mem: null,
                            node: null,
                            gres: {}
                        }
                    },
                    'root': {
                        parent: null,
                        grpTRESRunMins: { cpu: null, mem: null, node: null, gres: {} }
                    }
                }
            };

            const mockJobs = {
                jobs: [
                    {
                        job_id: 100,
                        account: 'child-account',
                        job_state: 'RUNNING',
                        alloc_cpus: 128,
                        time_limit: '2-00:00:00',
                        start_time: Math.floor(Date.now() / 1000) - 3600
                    }
                ]
            };

            dataCache.getAccountLimits = jest.fn().mockReturnValue(mockAccountLimits);
            dataCache.getData = jest.fn().mockReturnValue(mockJobs);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'child-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpCPURunMinutesLimit Account=child-account UserId=user1(1000) TimeLimit=10-00:00:00 ReqTRES=cpu=256,mem=1T,node=4"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('AssocGrpCPURunMinutes');
            expect(result.limitingAccount).toBe('parent-account'); // Parent should be limiting
            expect(result.isDirectAccount).toBe(false);
            expect(result.hierarchy.find(acc => acc.account === 'parent-account' && acc.isLimiting)).toBeDefined();
        });

        it('should handle missing account limits data', async () => {
            dataCache.getAccountLimits = jest.fn().mockReturnValue(null);
            dataCache.getJobById.mockReturnValue({
                job_id: 200,
                account: 'test-account',
                job_state: ['PENDING']
            });

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=AssocGrpCPURunMinutesLimit Account=test-account TimeLimit=1-00:00:00 ReqTRES=cpu=64,mem=256G,node=1"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('Error');
            expect(result.message).toContain('Account limits not available');
        });
    });

    describe('BeginTime', () => {
        it('should analyze job with future start time', async () => {
            const futureTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
            
            executeCommand.mockReturnValue(
                `JobId=123 JobState=PENDING Reason=BeginTime StartTime=${futureTime} Partition=gpu`
            );

            const result = await getPendingReason('123');

            expect(result.type).toBe('BeginTime');
            expect(result.jobId).toBe('123');
            expect(result.scheduledStartTime).toBe(futureTime);
            expect(result.waitTimeSeconds).toBeGreaterThan(0);
            expect(result.message).toContain('Job scheduled to start');
        });
    });

    describe('JobHeldUser', () => {
        it('should analyze job held by user', async () => {
            executeCommand.mockReturnValue(
                "JobId=123 JobState=PENDING Reason=JobHeldUser UserId=testuser(1001) Partition=gpu"
            );

            const result = await getPendingReason('123');

            expect(result.type).toBe('JobHeldUser');
            expect(result.jobId).toBe('123');
            expect(result.message).toBe('Job is held by user');
            expect(result.action).toContain('scontrol release');
        });
    });

    describe('JobHeldAdmin', () => {
        it('should analyze job held by admin', async () => {
            executeCommand.mockReturnValue(
                "JobId=123 JobState=PENDING Reason=JobHeldAdmin UserId=testuser(1001) Partition=gpu"
            );

            const result = await getPendingReason('123');

            expect(result.type).toBe('JobHeldAdmin');
            expect(result.jobId).toBe('123');
            expect(result.message).toBe('Job is held by system administrator');
            expect(result.action).toContain('Contact your system administrator');
        });
    });

    describe('ReqNodeNotAvail', () => {
        it('should analyze unavailable required nodes', async () => {
            executeCommand
                .mockReturnValueOnce(
                    "JobId=123 JobState=PENDING Reason=ReqNodeNotAvail ReqNodeList=node01 Partition=gpu"
                )
                .mockReturnValueOnce(
                    "NodeName=node01 State=DOWN Reason=Not responding"
                );

            const result = await getPendingReason('123');

            expect(result.type).toBe('ReqNodeNotAvail');
            expect(result.jobId).toBe('123');
            expect(result.requestedNodes).toBe('node01');
            expect(result.nodeStates).toHaveLength(1);
            expect(result.nodeStates[0].name).toBe('node01');
            expect(result.nodeStates[0].state).toBe('DOWN');
        });

        it('should handle node query failure gracefully', async () => {
            executeCommand
                .mockReturnValueOnce(
                    "JobId=123 JobState=PENDING Reason=ReqNodeNotAvail ReqNodeList=node01 Partition=gpu"
                )
                .mockImplementationOnce(() => {
                    throw new Error('Node not found');
                });

            const result = await getPendingReason('123');

            expect(result.type).toBe('ReqNodeNotAvail');
            expect(result.nodeStates).toHaveLength(0);
            expect(result.message).toContain('not available');
        });
    });

    describe('PartitionDown', () => {
        it('should analyze partition down state', async () => {
            executeCommand
                .mockReturnValueOnce(
                    "JobId=123 JobState=PENDING Reason=PartitionDown Partition=maintenance"
                )
                .mockReturnValueOnce(
                    "PartitionName=maintenance State=DOWN TotalNodes=10"
                );

            const result = await getPendingReason('123');

            expect(result.type).toBe('PartitionDown');
            expect(result.jobId).toBe('123');
            expect(result.partition).toBe('maintenance');
            expect(result.partitionState).toBe('DOWN');
            expect(result.message).toContain('DOWN state');
        });
    });

    describe('PartitionInactive', () => {
        it('should analyze inactive partition', async () => {
            executeCommand.mockReturnValue(
                "JobId=123 JobState=PENDING Reason=PartitionInactive Partition=reserved"
            );

            const result = await getPendingReason('123');

            expect(result.type).toBe('PartitionInactive');
            expect(result.jobId).toBe('123');
            expect(result.partition).toBe('reserved');
            expect(result.message).toContain('Inactive');
            expect(result.action).toContain('Contact your system administrator');
        });
    });

    describe('PartitionTimeLimit', () => {
        it('should analyze partition time limit exceeded', async () => {
            executeCommand
                .mockReturnValueOnce(
                    "JobId=123 JobState=PENDING Reason=PartitionTimeLimit Partition=short TimeLimit=2-00:00:00"
                )
                .mockReturnValueOnce(
                    "PartitionName=short State=UP MaxTime=1-00:00:00"
                );

            const result = await getPendingReason('123');

            expect(result.type).toBe('PartitionTimeLimit');
            expect(result.jobId).toBe('123');
            expect(result.partition).toBe('short');
            expect(result.jobTimeLimit).toBe('2-00:00:00');
            expect(result.partitionMaxTime).toBe('1-00:00:00');
            expect(result.message).toContain('exceeds partition');
        });
    });

    describe('PartitionNodeLimit', () => {
        it('should analyze partition node limit exceeded', async () => {
            executeCommand
                .mockReturnValueOnce(
                    "JobId=123 JobState=PENDING Reason=PartitionNodeLimit Partition=small NumNodes=50"
                )
                .mockReturnValueOnce(
                    "PartitionName=small State=UP MaxNodes=32 TotalNodes=32"
                );

            const result = await getPendingReason('123');

            expect(result.type).toBe('PartitionNodeLimit');
            expect(result.jobId).toBe('123');
            expect(result.partition).toBe('small');
            expect(result.requestedNodes).toBe('50');
            expect(result.partitionMaxNodes).toBe('32');
            expect(result.partitionTotalNodes).toBe('32');
            expect(result.message).toContain('exceed partition');
        });
    });

    describe('Reservation', () => {
        it('should analyze reservation waiting', async () => {
            executeCommand
                .mockReturnValueOnce(
                    "JobId=123 JobState=PENDING Reason=Reservation Reservation=maint_2024"
                )
                .mockReturnValueOnce(
                    "ReservationName=maint_2024 StartTime=2024-12-25T00:00:00 EndTime=2024-12-26T00:00:00 State=INACTIVE"
                );

            const result = await getPendingReason('123');

            expect(result.type).toBe('Reservation');
            expect(result.jobId).toBe('123');
            expect(result.reservationName).toBe('maint_2024');
            expect(result.reservationDetails).toBeDefined();
            expect(result.reservationDetails.startTime).toBe('2024-12-25T00:00:00');
            expect(result.reservationDetails.state).toBe('INACTIVE');
        });

        it('should handle reservation query failure', async () => {
            executeCommand
                .mockReturnValueOnce(
                    "JobId=123 JobState=PENDING Reason=Reservation Reservation=maint_2024"
                )
                .mockImplementationOnce(() => {
                    throw new Error('Reservation not found');
                });

            const result = await getPendingReason('123');

            expect(result.type).toBe('Reservation');
            expect(result.reservationDetails).toBeNull();
            expect(result.message).toContain('advanced reservation');
        });
    });

    describe('InvalidQOS', () => {
        it('should analyze invalid QOS', async () => {
            executeCommand.mockReturnValue(
                "JobId=123 JobState=PENDING Reason=InvalidQOS QOS=premium Account=basic-account Partition=gpu"
            );

            const result = await getPendingReason('123');

            expect(result.type).toBe('InvalidQOS');
            expect(result.jobId).toBe('123');
            expect(result.requestedQOS).toBe('premium');
            expect(result.account).toBe('basic-account');
            expect(result.partition).toBe('gpu');
            expect(result.message).toContain('invalid or not allowed');
            expect(result.action).toContain('sacctmgr show assoc');
        });
    });

    describe('JobArrayTaskLimit', () => {
        it('should analyze job array task limit', async () => {
            executeCommand.mockReturnValue(
                "JobId=9785691 JobState=PENDING Reason=JobArrayTaskLimit ArrayJobId=9785691 ArrayTaskId=15-22%4 ArrayTaskThrottle=4 Partition=nova"
            );

            const result = await getPendingReason('9785691');

            expect(result.type).toBe('JobArrayTaskLimit');
            expect(result.jobId).toBe('9785691');
            expect(result.pendingTasks).toBe('15-22%4');
            expect(result.maxSimultaneous).toBe('4');
            expect(result.message).toContain('max 4 tasks running simultaneously');
        });
    });

    describe('QOSGrpCpuLimit', () => {
        beforeEach(() => {
            // Mock QOS limits
            dataCache.getQOSLimits = jest.fn().mockReturnValue({
                timestamp: Date.now(),
                qos: {
                    'normal': {
                        name: 'normal',
                        grpCPUs: 200,
                        grpMem: null,
                        grpNodes: null
                    },
                    'premium': {
                        name: 'premium',
                        grpCPUs: null,
                        grpTRES: {
                            cpu: 500
                        }
                    }
                }
            });

            // Mock running jobs in QOS
            dataCache.getData = jest.fn().mockReturnValue({
                jobs: [
                    { job_id: 100, job_state: 'RUNNING', account: 'test-account', alloc_cpus: 50, user_name: 'user1', qos: 'normal' },
                    { job_id: 101, job_state: 'RUNNING', account: 'test-account', alloc_cpus: 80, user_name: 'user2', qos: 'normal' },
                    { job_id: 102, job_state: 'RUNNING', account: 'other-account', alloc_cpus: 40, user_name: 'user3', qos: 'premium' }
                ]
            });
        });

        it('should analyze QOS CPU limit reached', async () => {
            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=QOSGrpCpuLimit Account=test-account QOS=normal ReqTRES=cpu=100,mem=64G,node=1"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('QOSGrpCpuLimit');
            expect(result.qosName).toBe('normal');
            expect(result.analysis.limit).toBe(200);
            expect(result.analysis.currentUsage).toBe(130); // 50 + 80 from running jobs in normal QOS
            expect(result.analysis.runningJobs).toBe(2);
            expect(result.job.requested.cpus).toBe(100);
        });

        it('should use grpTRES.cpu if grpCPUs not set', async () => {
            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=QOSGrpCpuLimit Account=other-account QOS=premium ReqTRES=cpu=50,mem=64G,node=1"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('QOSGrpCpuLimit');
            expect(result.qosName).toBe('premium');
            expect(result.analysis.limit).toBe(500); // From grpTRES.cpu
            expect(result.analysis.currentUsage).toBe(40); // 40 from premium QOS
        });

        it('should return error if QOS limits not available', async () => {
            dataCache.getQOSLimits = jest.fn().mockReturnValue(null);

            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=QOSGrpCpuLimit Account=test-account QOS=normal ReqTRES=cpu=100,mem=64G,node=1"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('Error');
            expect(result.message).toContain('QOS limits not available');
        });

        it('should return error if QOS not found', async () => {
            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=QOSGrpCpuLimit Account=test-account QOS=nonexistent ReqTRES=cpu=100,mem=64G,node=1"
            );

            const result = await getPendingReason('200');

            expect(result.type).toBe('Error');
            expect(result.message).toContain('not found in limits');
        });

        it('should include top consumers', async () => {
            executeCommand.mockReturnValue(
                "JobId=200 JobState=PENDING Reason=QOSGrpCpuLimit Account=test-account QOS=normal ReqTRES=cpu=100,mem=64G,node=1"
            );

            const result = await getPendingReason('200');

            expect(result.analysis.topConsumers).toHaveLength(2);
            expect(result.analysis.topConsumers[0].cpus).toBe(80); // user2's job (highest)
            expect(result.analysis.topConsumers[1].cpus).toBe(50); // user1's job
        });
    });
});
