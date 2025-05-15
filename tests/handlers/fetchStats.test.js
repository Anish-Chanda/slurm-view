const { getCPUsByState, getMemByState, getGPUByState } = require("../../handlers/fetchStats");
const { executeCommand } = require("../../helpers/executeCmd");

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
    executeCommand.mockReturnValue(
      "32000 alloc\n64000 idle\n16000 down\n8000 inval"
    );

    const result = getMemByState();

    expect(executeCommand).toHaveBeenCalledWith(
      "sinfo  -N -o '%m %t' --noheader"
    );
    expect(result).toEqual({
      allocated: (32000 / 1024).toFixed(2),
      idle: (64000 / 1024).toFixed(2),
      down: (16000 / 1024).toFixed(2),
      other: (8000 / 1024).toFixed(2),
      total: (120000 / 1024).toFixed(2),
    });
  });

  it("should handle empty lines in command output", () => {
    // Output with empty lines
    executeCommand.mockReturnValue("32000 alloc\n\n64000 idle\n");

    const result = getMemByState();

    expect(result.total).toBe((96000 / 1024).toFixed(2));
  });

  it("should handle mixed state nodes correctly", () => {
    // Test nodes with mixed states
    executeCommand.mockReturnValue(
      "32000 alloc*\n64000 idle~\n16000 down#\n8000 other"
    );

    const result = getMemByState();

    expect(result).toEqual({
      allocated: (32000 / 1024).toFixed(2),
      idle: (64000 / 1024).toFixed(2),
      down: (16000 / 1024).toFixed(2),
      other: (8000 / 1024).toFixed(2),
      total: (120000 / 1024).toFixed(2),
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

  it("should return correct structure with GPU data", () => {
    // Mock GPU data
    const mockAvailableGPUs = `
gpu:a100:4(S:0-1)
gpu:v100:2(S:0-1)
gpu:a40:4(S:0)
`;
    const mockUsedGPUs = `
gpu:a100:2(IDX:1,3)
gpu:v100:1(IDX:1)
gpu:a40:0(IDX:N/A)
`;

    executeCommand.mockImplementation((cmd) => {
      if (cmd.includes("Gres ")) {
        return mockAvailableGPUs;
      } else if (cmd.includes("GresUsed")) {
        return mockUsedGPUs;
      }
      return "";
    });

    const result = getGPUByState();

    // Check structure
    expect(result.name).toBe("GPU Utilization");
    expect(result.children).toHaveLength(2); // Used and Available categories
    expect(result.children[0].name).toBe("Used");
    expect(result.children[1].name).toBe("Available");

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

  it("should handle errors gracefully", () => {
    executeCommand.mockImplementation(() => {
      throw new Error("Command failed");
    });

    // Spy on console.error
    jest.spyOn(console, "error").mockImplementation(() => { });

    const result = getGPUByState();

    expect(console.error).toHaveBeenCalled();
    expect(result.name).toBe("GPU Utilization");
    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe("Error");
  });

  it("should handle empty GPU data", () => {
    executeCommand.mockReturnValue("");

    const result = getGPUByState();

    expect(result.name).toBe("GPU Utilization");
    // Should have empty children arrays for Used and Available
    expect(result.children).toHaveLength(2);
    expect(result.children[0].children).toHaveLength(0);
    expect(result.children[1].children).toHaveLength(0);
  });

  it("should handle partition parameter when provided", () => {
    executeCommand.mockImplementation((cmd) => {
      if (cmd.includes("Gres")) {
        return "gpu:a100:4(S:0-1)";
      } else if (cmd.includes("GresUsed")) {
        return "gpu:a100:2(IDX:1,3)";
      }
      return "";
    });
    
    getGPUByState("partition");
    
    // Check that both commands were called with the partition flag
    expect(executeCommand).toHaveBeenCalledWith("sinfo -p partition -h -O Gres | grep -v '(null)' | grep gpu");
    expect(executeCommand).toHaveBeenCalledWith("sinfo -p partition -h -O GresUsed | grep -v '(null)' | grep gpu");
  });
});
