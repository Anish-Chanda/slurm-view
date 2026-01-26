const { getCPUsByState, getMemByState, getGPUByState } = require("../../handlers/fetchStats");
const { executeCommand, executeCommandStreaming } = require("../../helpers/executeCmd");

// Mock the executeCommand dependency
jest.mock("../../helpers/executeCmd");

// Mock dataCache to prevent caching interference in tests
jest.mock("../../modules/dataCache", () => ({
    cache: {
        get: jest.fn(),
        set: jest.fn(),
        getStats: jest.fn()
    },
    getData: jest.fn(),
    logStats: jest.fn()
}));

describe("getCPUsByState", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return correct CPU distribution when successful", () => {
    // Mock successful command output
    executeCommand.mockReturnValue("500/1500/200/2200");

    const result = getCPUsByState();

    expect(executeCommand).toHaveBeenCalledWith("sinfo '-o' '%C' '--noheader'");
    expect(result).toEqual({
      allocated: 500,
      idle: 1500,
      other: 200,
      total: 2200,
    });
  });

  it("should return cached data if available", () => {
    const cachedData = { allocated: 100, idle: 100, other: 0, total: 200 };
    // Mock cache hit
    require("../../modules/dataCache").cache.get.mockReturnValueOnce(cachedData);
    
    const result = getCPUsByState();
    
    expect(result).toEqual(cachedData);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("should handle errors properly", () => {
    // Mock error case
    const errorMessage = "Command failed";
    executeCommand.mockImplementation(() => {
      throw new Error(errorMessage);
    });

    // Spy on console.error
    jest.spyOn(console, "error").mockImplementation(() => { });

    const result = getCPUsByState();

    expect(console.error).toHaveBeenCalled();
    // The function now returns a map with zero values when an error occurs
    expect(result).toEqual({
      allocated: 0,
      idle: 0,
      other: 0,
      total: 0
    });
  });

  it("should handle partition parameter when provided", () => {
    executeCommand.mockReturnValue("100/200/30/330");

    const result = getCPUsByState("partition");

    expect(executeCommand).toHaveBeenCalledWith("sinfo '-p' 'partition' '-o' '%C' '--noheader'");
    expect(result).toEqual({
      allocated: 100,
      idle: 200,
      other: 30,
      total: 330,
    });
  });
});

describe("getMemByState", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should calculate memory distribution correctly", () => {
    // Mock successful command output with multiple nodes
    executeCommand.mockReturnValue(`
NodeName=node1 State=IDLE RealMemory=50000 AllocMem=0 FreeMem=48000 Partitions=compute,debug
NodeName=node2 State=ALLOCATED RealMemory=50000 AllocMem=40000 FreeMem=8000 Partitions=compute
NodeName=node3 State=DOWN RealMemory=50000 AllocMem=0 FreeMem=0 Partitions=compute
NodeName=node4 State=MIXED RealMemory=50000 AllocMem=25000 FreeMem=20000 Partitions=compute,gpu
    `);

    const result = getMemByState();

    expect(executeCommand).toHaveBeenCalledWith(
      "scontrol 'show' 'node' '-o'"
    );
    // Calculate expected values
    const totalMem = 200000;
    const allocatedMem = 40000 + 25000; // node2 + node4
    const idleMem = 48000 + 8000 + 20000; // node1 + node2 + node4
    const downMem = 50000; // node3
    const otherMem = 2000 + 2000 + 5000; // node1 + node2 + node4 (RealMemory - AllocMem - FreeMem)
    
    expect(result).toEqual({
      allocated: parseFloat((allocatedMem / 1024).toFixed(2)),
      idle: parseFloat((idleMem / 1024).toFixed(2)),
      down: parseFloat((downMem / 1024).toFixed(2)),
      other: parseFloat((otherMem / 1024).toFixed(2)),
      total: parseFloat((totalMem / 1024).toFixed(2)),
    });
  });

  it("should filter nodes by partition when specified", () => {
    // Mock successful command output with multiple nodes
    executeCommand.mockReturnValue(`
NodeName=node1 State=IDLE RealMemory=50000 AllocMem=0 FreeMem=48000 Partitions=compute,debug
NodeName=node2 State=ALLOCATED RealMemory=50000 AllocMem=40000 FreeMem=8000 Partitions=compute
NodeName=node3 State=DOWN RealMemory=50000 AllocMem=0 FreeMem=0 Partitions=gpu
NodeName=node4 State=MIXED RealMemory=50000 AllocMem=25000 FreeMem=20000 Partitions=gpu,debug
    `);

    const result = getMemByState("gpu");

    expect(executeCommand).toHaveBeenCalledWith("scontrol 'show' 'node' '-o'");
    
    // Only node3 and node4 should be included (gpu partition)
    const totalMem = 100000; // node3 + node4
    const allocatedMem = 25000; // node4
    const idleMem = 20000; // node4
    const downMem = 50000; // node3
    const otherMem = 5000; // node4 (RealMemory - AllocMem - FreeMem)
    
    expect(result).toEqual({
      allocated: parseFloat((allocatedMem / 1024).toFixed(2)),
      idle: parseFloat((idleMem / 1024).toFixed(2)),
      down: parseFloat((downMem / 1024).toFixed(2)),
      other: parseFloat((otherMem / 1024).toFixed(2)),
      total: parseFloat((totalMem / 1024).toFixed(2)),
    });
  });

   it("should handle empty lines and irregular formats in command output", () => {
    // Output with empty lines and incomplete data
    executeCommand.mockReturnValue(`
NodeName=node1 State=IDLE RealMemory=50000 AllocMem=0 FreeMem=48000 Partitions=compute

NodeName=node2 State=ALLOCATED Partitions=compute
NodeName=node3 RealMemory=50000 AllocMem=0 FreeMem=48000 Partitions=compute
    `);

    const result = getMemByState();
    
    // Only node1 has complete data, node2 missing memory, node3 missing state
    const totalMem = 50000; // only node1
    const allocatedMem = 0; // node1
    const idleMem = 48000; // node1
    const otherMem = 2000; // node1 (RealMemory - AllocMem - FreeMem)
    
    expect(result).toEqual({
      allocated: parseFloat((allocatedMem / 1024).toFixed(2)),
      idle: parseFloat((idleMem / 1024).toFixed(2)),
      down: 0,
      other: parseFloat((otherMem / 1024).toFixed(2)),
      total: parseFloat((totalMem / 1024).toFixed(2)),
    });
  });

  it("should handle errors properly", () => {
    // Mock error case
    const errorMessage = "Command failed";
    executeCommand.mockImplementation(() => {
      throw new Error(errorMessage);
    });

    // Spy on console.error
    jest.spyOn(console, "error").mockImplementation(() => { });

    const result = getMemByState();

    expect(console.error).toHaveBeenCalled();
    // The function now returns a map with zero values when an error occurs
    expect(result).toEqual({
      allocated: 0,
      down: 0,
      idle: 0,
      other: 0,
      total: 0
    });
  });

  it("should handle partition parameter when provided", () => {
    executeCommand.mockReturnValue("100/200/30/330");

    const result = getCPUsByState("partition");

    expect(executeCommand).toHaveBeenCalledWith("sinfo '-p' 'partition' '-o' '%C' '--noheader'");
    expect(result).toEqual({
      allocated: 100,
      idle: 200,
      other: 30,
      total: 330,
    });
  });
});

describe("getGPUByState", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return correct structure with GPU data from cached jobs", async () => {
    // Mock node data output
    const mockNodeData = `
NodeName=node1 Gres=gpu:a100:4 State=IDLE
NodeName=node2 Gres=gpu:v100:2 State=MIXED
NodeName=node3 Gres=gpu:a40:4 State=ALLOCATED
`;
    
    // Mock cached jobs data with GPU allocations
    const mockJobsData = {
      jobs: [
        { 
          job_id: "1001", 
          job_state: "RUNNING", 
          partition: "nova",
          gpu_allocations: { total: 2, types: { a100: 2 } }
        },
        { 
          job_id: "1002", 
          job_state: "RUNNING", 
          partition: "nova",
          gpu_allocations: { total: 1, types: { v100: 1 } }
        },
        { 
          job_id: "1003", 
          job_state: "RUNNING", 
          partition: "nova",
          gpu_allocations: { total: 1, types: { a100: 1 } }
        },
        { 
          job_id: "1004", 
          job_state: "PENDING", 
          partition: "nova",
          gpu_allocations: { total: 2, types: { a100: 2 } } // Should be ignored
        }
      ]
    };

    executeCommandStreaming.mockResolvedValue(mockNodeData);
    
    // Mock dataCache.getData to return jobs
    const dataCache = require("../../modules/dataCache");
    dataCache.getData.mockReturnValue(mockJobsData);

    const result = await getGPUByState();

    // Verify executeCommandStreaming was called with the right command
    expect(executeCommandStreaming).toHaveBeenCalledWith("scontrol 'show' 'node' '-o'");
    
    // Verify we're using cached jobs data (no squeue call)
    expect(executeCommand).not.toHaveBeenCalled();

    // Check structure
    expect(result.name).toBe("GPU Utilization");
    expect(result.children).toHaveLength(2); // Used and Available categories
    expect(result.children[0].name).toBe("Used");
    expect(result.children[1].name).toBe("Available");
    expect(result.totalGPUs).toBe(10); // 4 + 2 + 4 = 10 total GPUs

    // Check data
    const usedGPUs = result.children[0].children;
    const availableGPUs = result.children[1].children;

    // Find a100 in used GPUs (2 explicit + 1 implicit = 3 total)
    const usedA100 = usedGPUs.find((gpu) => gpu.name === "a100");
    expect(usedA100).toBeDefined();
    expect(usedA100.value).toBe(3);

    // Find v100 in used GPUs
    const usedV100 = usedGPUs.find((gpu) => gpu.name === "v100");
    expect(usedV100).toBeDefined();
    expect(usedV100.value).toBe(1);

    // Check available GPUs
    const availableA100 = availableGPUs.find((gpu) => gpu.name === "a100");
    expect(availableA100).toBeDefined();
    expect(availableA100.value).toBe(1); // 4 total - 3 used

    // a40 should be fully available (no jobs using it)
    const availableA40 = availableGPUs.find((gpu) => gpu.name === "a40");
    expect(availableA40).toBeDefined();
    expect(availableA40.value).toBe(4);
  });

  it("should handle errors gracefully", async () => {
    executeCommandStreaming.mockRejectedValue(new Error("Command failed"));

    // Spy on console.error
    jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await getGPUByState();

    expect(console.error).toHaveBeenCalled();
    expect(result.name).toBe("GPU Utilization");
    expect(result.totalGPUs).toBe(0);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe("Error");
  });

  it("should handle empty GPU data", async () => {
    executeCommandStreaming.mockResolvedValue("");
    
    // Mock empty jobs data
    const dataCache = require("../../modules/dataCache"); dataCache.getData.mockReturnValue({ jobs: [] });

    const result = await getGPUByState();

    expect(result.name).toBe("GPU Utilization");
    expect(result.totalGPUs).toBe(0);
    // Should have "No GPUs" child for zero GPU case
    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe("No GPUs");
    expect(result.children[0].value).toBe(1);
  });

  it("should handle partition parameter when provided", async () => {
    executeCommandStreaming.mockResolvedValue(`
NodeName=node1 Gres=gpu:a100:4 Partitions=compute,gpu State=IDLE
NodeName=node2 Gres=gpu:v100:2 Partitions=compute State=MIXED
NodeName=node3 Gres=gpu:a40:4 Partitions=gpu State=ALLOCATED
`);
    
    const mockJobsData = {
      jobs: [
        { job_id: "1", job_state: "RUNNING", partition: "gpu", gpu_allocations: { total: 2, types: { a100: 2 } } },
        { job_id: "2", job_state: "RUNNING", partition: "compute", gpu_allocations: { total: 1, types: { v100: 1 } } } // Should be filtered out
      ]
    };
    const dataCache = require("../../modules/dataCache"); dataCache.getData.mockReturnValue(mockJobsData);
    
    const result = await getGPUByState("gpu");
    
    // Check that commands were called with the partition flag
    expect(executeCommandStreaming).toHaveBeenCalledWith("scontrol 'show' 'node' '-o'");
    expect(executeCommand).not.toHaveBeenCalled(); // Should use cached jobs, not squeue
    
    // Should include totalGPUs field
    expect(result.totalGPUs).toBe(8); // 4 a100 + 4 a40 = 8 total GPUs in gpu partition
  });

  it("should filter nodes by partition when specified", async () => {
    executeCommandStreaming.mockResolvedValue(`
NodeName=node1 Gres=gpu:a100:4 Partitions=compute,gpu State=IDLE
NodeName=node2 Gres=gpu:v100:2 Partitions=compute State=MIXED
NodeName=node3 Gres=gpu:a40:4 Partitions=gpu State=ALLOCATED
`);
    
    const mockJobsData = {
      jobs: [
        { job_id: "1", job_state: "RUNNING", partition: "gpu", gpu_allocations: { total: 1, types: { a100: 1 } } },
        { job_id: "2", job_state: "RUNNING", partition: "gpu", gpu_allocations: { total: 2, types: { a40: 2 } } },
        { job_id: "3", job_state: "RUNNING", partition: "compute", gpu_allocations: { total: 1, types: { v100: 1 } } } // Filtered
      ]
    };
    const dataCache = require("../../modules/dataCache"); dataCache.getData.mockReturnValue(mockJobsData);
    
    const result = await getGPUByState("gpu");
    
    // Verify GPU counts are filtered to only include gpu partition
    const usedGPUs = result.children[0].children;
    const availableGPUs = result.children[1].children;
    
    // Check that we only have a100 and a40 GPUs (from node1 and node3)
    expect(usedGPUs.find(gpu => gpu.name === "v100")).toBeUndefined();
    
    // Check proper counts for a100 
    const usedA100 = usedGPUs.find(gpu => gpu.name === "a100");
    expect(usedA100).toBeDefined();
    expect(usedA100.value).toBe(1);
    
    const availableA100 = availableGPUs.find(gpu => gpu.name === "a100");
    expect(availableA100).toBeDefined();
    expect(availableA100.value).toBe(3); // 4 total - 1 used
    
    // Check proper counts for a40
    const usedA40 = usedGPUs.find(gpu => gpu.name === "a40");
    expect(usedA40).toBeDefined();
    expect(usedA40.value).toBe(2);
    
    const availableA40 = availableGPUs.find(gpu => gpu.name === "a40");
    expect(availableA40).toBeDefined();
    expect(availableA40.value).toBe(2); // 4 total - 2 used
  });

  it("should handle partition with no GPUs correctly", async () => {
    // Mock nodes in reserved partition without GPU resources
    executeCommandStreaming.mockResolvedValue(`
NodeName=node1 Gres=(null) Partitions=reserved State=IDLE
NodeName=node2 Gres=(null) Partitions=reserved State=ALLOCATED
NodeName=node3 Gres=gpu:a100:4 Partitions=compute State=IDLE
`);
    // No GPU output for reserved partition
    executeCommand.mockReturnValue("");
    
    const result = await getGPUByState("reserved");
    
    // Should return structure with special handling for 0 GPUs
    expect(result.name).toBe("GPU Utilization");
    expect(result.totalGPUs).toBe(0);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe("No GPUs");
    expect(result.children[0].value).toBe(1);
    expect(result.children[0].children).toHaveLength(0);
  });

  it("should handle reserved partition scenario from issue", async () => {
    // Specific test for the issue: reserved partition with no GPUs
    executeCommandStreaming.mockResolvedValue(`
NodeName=reserved-node1 Gres=(null) Partitions=reserved State=IDLE RealMemory=128000
NodeName=reserved-node2 Gres=(null) Partitions=reserved State=ALLOCATED RealMemory=128000
NodeName=compute-node1 Gres=gpu:a100:8 Partitions=compute State=IDLE RealMemory=256000
`);
    
    // Mock empty jobs for reserved partition
    const dataCache = require("../../modules/dataCache"); dataCache.getData.mockReturnValue({ jobs: [] });
    
    const result = await getGPUByState("reserved");
    
    // Verify the result matches the expected fix:
    // - GPU Total: 0
    // - No ring (single "No GPUs" element instead of Used/Available)
    // - Uses "allocated" color semantics (red) to indicate no available GPUs
    expect(result.name).toBe("GPU Utilization");
    expect(result.totalGPUs).toBe(0);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe("No GPUs");
    expect(result.children[0].value).toBe(1); // This will render with "allocated" red color
    expect(result.children[0].children).toHaveLength(0);
    
    // Verify commands were called with correct partition filter
    expect(executeCommandStreaming).toHaveBeenCalledWith("scontrol 'show' 'node' '-o'");
    expect(executeCommand).not.toHaveBeenCalled(); // Using cached jobs
  });

  it("should correctly handle mixed GPU allocation formats (with and without explicit count)", async () => {
    // Real-world scenario: some jobs specify count, some don't (defaults to 1)
    executeCommandStreaming.mockResolvedValue(`
NodeName=node1 Gres=gpu:a100:8 Partitions=nova State=MIXED
NodeName=node2 Gres=gpu:a100-pcie:4 Partitions=nova State=MIXED
NodeName=node3 Gres=gpu:a100:8 Partitions=nova State=MIXED
`);
    
    const mockJobsData = {
      jobs: [
        { job_id: "1", job_state: "RUNNING", partition: "nova", gpu_allocations: { total: 4, types: { a100: 4 } } },
        { job_id: "2", job_state: "RUNNING", partition: "nova", gpu_allocations: { total: 2, types: { a100: 2 } } },
        { job_id: "3", job_state: "RUNNING", partition: "nova", gpu_allocations: { total: 1, types: { a100: 1 } } },
        { job_id: "4", job_state: "RUNNING", partition: "nova", gpu_allocations: { total: 1, types: { a100: 1 } } },
        { job_id: "5", job_state: "RUNNING", partition: "nova", gpu_allocations: { total: 1, types: { a100: 1 } } },
        { job_id: "6", job_state: "RUNNING", partition: "nova", gpu_allocations: { total: 1, types: { a100: 1 } } },
        { job_id: "7", job_state: "RUNNING", partition: "nova", gpu_allocations: { total: 1, types: { "a100-pcie": 1 } } },
        { job_id: "8", job_state: "RUNNING", partition: "nova", gpu_allocations: { total: 1, types: { "a100-pcie": 1 } } }
      ]
    };
    const dataCache = require("../../modules/dataCache"); dataCache.getData.mockReturnValue(mockJobsData);
    
    const result = await getGPUByState();
    
    // Total GPUs in cluster: 8 + 4 + 8 = 20
    expect(result.totalGPUs).toBe(20);
    
    const usedGPUs = result.children[0].children;
    
    // Calculate expected A100 usage:
    // 4 + 2 + 1 + 1 + 1 + 1 = 10 A100 GPUs
    const usedA100 = usedGPUs.find(gpu => gpu.name === "a100");
    expect(usedA100).toBeDefined();
    expect(usedA100.value).toBe(10);
    
    // Calculate expected A100-PCIE usage:
    // 1 + 1 = 2 A100-PCIE GPUs
    const usedA100Pcie = usedGPUs.find(gpu => gpu.name === "a100-pcie");
    expect(usedA100Pcie).toBeDefined();
    expect(usedA100Pcie.value).toBe(2);
    
    // Check available GPUs
    const availableGPUs = result.children[1].children;
    
    // A100 available: 16 total - 10 used = 6
    const availableA100 = availableGPUs.find(gpu => gpu.name === "a100");
    expect(availableA100).toBeDefined();
    expect(availableA100.value).toBe(6);
    
    // A100-PCIE available: 4 total - 2 used = 2
    const availableA100Pcie = availableGPUs.find(gpu => gpu.name === "a100-pcie");
    expect(availableA100Pcie).toBeDefined();
    expect(availableA100Pcie.value).toBe(2);
  });
});
