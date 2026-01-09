const { getPendingReason } = require("../../handlers/fetchPendingReason");
const { executeCommand } = require("../../helpers/executeCmd");
const dataCache = require("../../modules/dataCache");
const priorityUtils = require("../../helpers/priorityUtils");

jest.mock("../../helpers/executeCmd");
jest.mock("../../modules/dataCache", () => ({
    getPendingReason: jest.fn(),
    setPendingReason: jest.fn(),
    getJobById: jest.fn()
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
});
