const { getCPUsByState, getMemByState } = require('../../handlers/fetchStats');
const { executeCommand } = require('../../helpers/executeCmd');

// Mock the executeCommand dependency
jest.mock('../../helpers/executeCmd');

describe('getCPUsByState', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return correct CPU distribution when successful', () => {
        // Mock successful command output
        executeCommand.mockReturnValue('500/1500/200/2200');
        
        const result = getCPUsByState();
        
        expect(executeCommand).toHaveBeenCalledWith("sinfo -o '%C' --noheader");
        expect(result).toEqual({
            allocated: 500,
            idle: 1500,
            other: 200,
            total: 2200
        });
    });

    it('should handle errors properly', () => {
        // Mock error case
        const errorMessage = 'Command failed';
        executeCommand.mockImplementation(() => {
            throw new Error(errorMessage);
        });
        
        // Spy on console.error
        jest.spyOn(console, 'error').mockImplementation(() => {});
        
        const result = getCPUsByState();
        
        expect(console.error).toHaveBeenCalled();
        expect(result).toContain(errorMessage);
    });
});

describe('getMemByState', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should calculate memory distribution correctly', () => {
        // Mock successful command output with multiple nodes
        executeCommand.mockReturnValue(
            '32000 alloc\n64000 idle\n16000 down\n8000 inval'
        );
        
        const result = getMemByState();
        
        expect(executeCommand).toHaveBeenCalledWith("sinfo -N -o '%m %t' --noheader");
        expect(result).toEqual({
            allocated: (32000 / 1024).toFixed(2),
            idle: (64000 / 1024).toFixed(2),
            down: (16000 / 1024).toFixed(2),
            other: (8000 / 1024).toFixed(2),
            total: (120000 / 1024).toFixed(2)
        });
    });

    it('should handle empty lines in command output', () => {
        // Output with empty lines
        executeCommand.mockReturnValue(
            '32000 alloc\n\n64000 idle\n'
        );
        
        const result = getMemByState();
        
        expect(result.total).toBe((96000 / 1024).toFixed(2));
    });

    it('should handle mixed state nodes correctly', () => {
        // Test nodes with mixed states
        executeCommand.mockReturnValue(
            '32000 alloc*\n64000 idle~\n16000 down#\n8000 other'
        );
        
        const result = getMemByState();
        
        expect(result).toEqual({
            allocated: (32000 / 1024).toFixed(2),
            idle: (64000 / 1024).toFixed(2),
            down: (16000 / 1024).toFixed(2),
            other: (8000 / 1024).toFixed(2),
            total: (120000 / 1024).toFixed(2)
        });
    });

    it('should handle errors properly', () => {
        // Mock error case
        const errorMessage = 'Command failed';
        executeCommand.mockImplementation(() => {
            throw new Error(errorMessage);
        });
        
        // Spy on console.error
        jest.spyOn(console, 'error').mockImplementation(() => {});
        
        const result = getMemByState();
        
        expect(console.error).toHaveBeenCalled();
        expect(result).toContain(errorMessage);
    });
});