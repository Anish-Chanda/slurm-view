const { getPendingReason } = require("../../handlers/fetchPendingReason");
const { executeCommand } = require("../../helpers/executeCmd");
const dataCache = require("../../modules/dataCache");

jest.mock("../../helpers/executeCmd");
jest.mock("../../modules/dataCache", () => ({
    getPendingReason: jest.fn(),
    setPendingReason: jest.fn()
}));

describe("getPendingReason", () => {
    beforeEach(() => {
        jest.resetAllMocks();
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

    it("should return other reason message if reason is not Resources", async () => {
        executeCommand.mockReturnValue("JobId=123 JobState=PENDING Reason=Priority");
        
        const result = await getPendingReason('123');
        expect(result.type).toBe('Other');
        expect(result.message).toContain('Priority');
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

    it("should handle errors gracefully", async () => {
        executeCommand.mockImplementation(() => {
            throw new Error("Command failed");
        });

        const result = await getPendingReason('123');
        expect(result.type).toBe('Error');
        expect(result.message).toBe('Command failed');
    });
});
