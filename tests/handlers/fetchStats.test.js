const { getCPUsByState, getMemByState, getGPUByState } = require("../../handlers/fetchStats");
const { executeCommand, executeCommandStreaming } = require("../../helpers/executeCmd");

// Mock the executeCommand dependency
jest.mock("../../helpers/executeCmd");

describe("getCPUsByState", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return correct CPU distribution when successful", () => {
    // Mock successful command output
    executeCommand.mockReturnValue("500/1500/200/2200");

    const result = getCPUsByState();

    expect(executeCommand).toHaveBeenCalledWith("sinfo  -o '%C' --noheader");
    expect(result).toEqual({
      allocated: 500,
      idle: 1500,
      other: 200,
      total: 2200,
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

    expect(executeCommand).toHaveBeenCalledWith("sinfo -p partition -o '%C' --noheader");
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
      "scontrol show node -o"
    );
    // Calculate expected values
    const totalMem = 200000;
    const allocatedMem = 40000 + 25000; // node2 + node4
    const idleMem = 48000 + 8000 + 20000; // node1 + node2 + node4
    const downMem = 50000; // node3
    const otherMem = 2000 + 2000 + 5000; // node1 + node2 + node4 (RealMemory - AllocMem - FreeMem)
    
    expect(result).toEqual({
      allocated: (allocatedMem / 1024).toFixed(2),
      idle: (idleMem / 1024).toFixed(2),
      down: (downMem / 1024).toFixed(2),
      other: (otherMem / 1024).toFixed(2),
      total: (totalMem / 1024).toFixed(2),
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

    expect(executeCommand).toHaveBeenCalledWith("scontrol show node -o");
    
    // Only node3 and node4 should be included (gpu partition)
    const totalMem = 100000; // node3 + node4
    const allocatedMem = 25000; // node4
    const idleMem = 20000; // node4
    const downMem = 50000; // node3
    const otherMem = 5000; // node4 (RealMemory - AllocMem - FreeMem)
    
    expect(result).toEqual({
      allocated: (allocatedMem / 1024).toFixed(2),
      idle: (idleMem / 1024).toFixed(2),
      down: (downMem / 1024).toFixed(2),
      other: (otherMem / 1024).toFixed(2),
      total: (totalMem / 1024).toFixed(2),
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
      allocated: (allocatedMem / 1024).toFixed(2),
      idle: (idleMem / 1024).toFixed(2),
      down: "0.00",
      other: (otherMem / 1024).toFixed(2),
      total: (totalMem / 1024).toFixed(2),
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

    expect(executeCommand).toHaveBeenCalledWith("sinfo -p partition -o '%C' --noheader");
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

  it("should return correct structure with GPU data", async () => {
    // Mock node data output
    const mockNodeData = `
NodeName=node1 Gres=gpu:a100:4 State=IDLE
NodeName=node2 Gres=gpu:v100:2 State=MIXED
NodeName=node3 Gres=gpu:a40:4 State=ALLOCATED
`;
    // Mock GPU used data
    const mockUsedGPUs = `
gpu:a100:2
gpu:v100:1
gpu:a40:0
`;

    executeCommandStreaming.mockResolvedValue(mockNodeData);
    executeCommand.mockReturnValue(mockUsedGPUs);

    const result = await getGPUByState();

    // Verify executeCommandStreaming was called with the right command
    expect(executeCommandStreaming).toHaveBeenCalledWith('scontrol show node -o');
    // Verify executeCommand was called with the right command
    expect(executeCommand).toHaveBeenCalledWith('sinfo  -h -O GresUsed | grep -v \'(null)\' | grep gpu');

    // Check structure
    expect(result.name).toBe("GPU Utilization");
    expect(result.children).toHaveLength(2); // Used and Available categories
    expect(result.children[0].name).toBe("Used");
    expect(result.children[1].name).toBe("Available");
    expect(result.totalGPUs).toBe(10); // 4 + 2 + 4 = 10 total GPUs

    // Check data
    const usedGPUs = result.children[0].children;
    const availableGPUs = result.children[1].children;

    // Find a100 in used GPUs
    const usedA100 = usedGPUs.find((gpu) => gpu.name === "a100");
    expect(usedA100).toBeDefined();
    expect(usedA100.value).toBe(2);

    // Find v100 in used GPUs
    const usedV100 = usedGPUs.find((gpu) => gpu.name === "v100");
    expect(usedV100).toBeDefined();
    expect(usedV100.value).toBe(1);

    // Check available GPUs
    const availableA100 = availableGPUs.find((gpu) => gpu.name === "a100");
    expect(availableA100).toBeDefined();
    expect(availableA100.value).toBe(2); // 4 total - 2 used

    // a40 should be fully available
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
    executeCommand.mockReturnValue("");

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
    executeCommand.mockReturnValue("gpu:a100:2");
    
    const result = await getGPUByState("gpu");
    
    // Check that commands were called with the partition flag
    expect(executeCommandStreaming).toHaveBeenCalledWith('scontrol show node -o');
    expect(executeCommand).toHaveBeenCalledWith('sinfo -p gpu -h -O GresUsed | grep -v \'(null)\' | grep gpu');
    
    // Should include totalGPUs field
    expect(result.totalGPUs).toBe(8); // 4 a100 + 4 a40 = 8 total GPUs in gpu partition
  });

  it("should filter nodes by partition when specified", async () => {
    executeCommandStreaming.mockResolvedValue(`
NodeName=node1 Gres=gpu:a100:4 Partitions=compute,gpu State=IDLE
NodeName=node2 Gres=gpu:v100:2 Partitions=compute State=MIXED
NodeName=node3 Gres=gpu:a40:4 Partitions=gpu State=ALLOCATED
`);
    executeCommand.mockReturnValue("gpu:a100:1\ngpu:a40:2");
    
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
    executeCommand.mockReturnValue(""); // No GPU usage in reserved partition
    
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
    expect(executeCommandStreaming).toHaveBeenCalledWith('scontrol show node -o');
    expect(executeCommand).toHaveBeenCalledWith('sinfo -p reserved -h -O GresUsed | grep -v \'(null)\' | grep gpu');
  });
});
