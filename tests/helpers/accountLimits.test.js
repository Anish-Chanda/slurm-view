const {
    parseMemoryToMB,
    parseTRESLimits,
    buildAncestorChain,
    formatMemory,
    fetchAccountLimits
} = require('../../helpers/accountLimits');
const { executeCommand } = require('../../helpers/executeCmd');

jest.mock('../../helpers/executeCmd');

describe('accountLimits', () => {
    describe('parseMemoryToMB', () => {
        it('should parse memory in MB correctly', () => {
            expect(parseMemoryToMB('100M')).toBe(100);
            expect(parseMemoryToMB('1000M')).toBe(1000);
            expect(parseMemoryToMB('378000M')).toBe(378000);
        });

        it('should parse memory in GB correctly', () => {
            expect(parseMemoryToMB('1G')).toBe(1024);
            expect(parseMemoryToMB('10G')).toBe(10240);
            expect(parseMemoryToMB('378G')).toBe(387072);
        });

        it('should parse memory in TB correctly', () => {
            expect(parseMemoryToMB('1T')).toBe(1048576);
            expect(parseMemoryToMB('2T')).toBe(2097152);
        });

        it('should parse memory in KB correctly', () => {
            expect(parseMemoryToMB('1024K')).toBe(1);
            expect(parseMemoryToMB('2048K')).toBe(2);
        });

        it('should default to MB when no unit specified', () => {
            expect(parseMemoryToMB('38000000')).toBe(38000000);
            expect(parseMemoryToMB('100')).toBe(100);
        });

        it('should handle N/A and invalid values', () => {
            expect(parseMemoryToMB('N/A')).toBe(0);
            expect(parseMemoryToMB('')).toBe(0);
            expect(parseMemoryToMB(null)).toBe(0);
            expect(parseMemoryToMB('invalid')).toBe(0);
        });

        it('should handle decimal values', () => {
            expect(parseMemoryToMB('1.5G')).toBe(1536);
            expect(parseMemoryToMB('0.5T')).toBe(524288);
        });
    });

    describe('parseTRESLimits', () => {
        it('should parse CPU limits correctly', () => {
            const result = parseTRESLimits('cpu=7200');
            expect(result.cpu).toBe(7200);
            expect(result.mem).toBeNull();
        });

        it('should parse memory limits correctly', () => {
            const result = parseTRESLimits('mem=38000000M');
            expect(result.mem).toBe(38000000);
            expect(result.cpu).toBeNull();
        });

        it('should parse GPU limits correctly', () => {
            const result = parseTRESLimits('gres/gpu=5');
            expect(result.gres.gpu).toBe(5);
        });

        it('should parse specific GPU type limits', () => {
            const result = parseTRESLimits('gres/gpu:a100=10');
            expect(result.gres['gpu:a100']).toBe(10);
        });

        it('should parse combined TRES limits', () => {
            const result = parseTRESLimits('cpu=7200,gres/gpu=5,mem=38000000M');
            expect(result.cpu).toBe(7200);
            expect(result.mem).toBe(38000000);
            expect(result.gres.gpu).toBe(5);
        });

        it('should parse node limits', () => {
            const result = parseTRESLimits('node=10,cpu=100');
            expect(result.node).toBe(10);
            expect(result.cpu).toBe(100);
        });

        it('should handle empty TRES string', () => {
            const result = parseTRESLimits('');
            expect(result.cpu).toBeNull();
            expect(result.mem).toBeNull();
            expect(result.node).toBeNull();
            expect(result.gres).toEqual({});
        });

        it('should handle null TRES string', () => {
            const result = parseTRESLimits(null);
            expect(result.cpu).toBeNull();
            expect(result.mem).toBeNull();
        });
    });

    describe('buildAncestorChain', () => {
        const mockLimits = {
            accounts: {
                'niemi-lab': { parent: 'stat' },
                'stat': { parent: 'las' },
                'las': { parent: 'research' },
                'research': { parent: 'root' },
                'root': { parent: null }
            }
        };

        it('should build correct ancestor chain', () => {
            const chain = buildAncestorChain('niemi-lab', mockLimits);
            expect(chain).toEqual(['niemi-lab', 'stat', 'las', 'research', 'root']);
        });

        it('should handle root account', () => {
            const chain = buildAncestorChain('root', mockLimits);
            expect(chain).toEqual(['root']);
        });

        it('should handle single-level account', () => {
            const chain = buildAncestorChain('research', mockLimits);
            expect(chain).toEqual(['research', 'root']);
        });

        it('should prevent infinite loops with circular references', () => {
            const circularLimits = {
                accounts: {
                    'a': { parent: 'b' },
                    'b': { parent: 'c' },
                    'c': { parent: 'a' }
                }
            };
            const chain = buildAncestorChain('a', circularLimits);
            expect(chain.length).toBeLessThan(100);
        });

        it('should handle non-existent account', () => {
            const chain = buildAncestorChain('nonexistent', mockLimits);
            expect(chain).toEqual(['nonexistent']);
        });
    });

    describe('formatMemory', () => {
        it('should format MB correctly', () => {
            expect(formatMemory(100)).toBe('100 MB');
            expect(formatMemory(512)).toBe('512 MB');
        });

        it('should format GB correctly', () => {
            expect(formatMemory(1024)).toBe('1 GB');
            expect(formatMemory(10240)).toBe('10 GB');
            expect(formatMemory(378000)).toBe('369.1 GB');
        });

        it('should format TB correctly', () => {
            expect(formatMemory(1048576)).toBe('1 TB');
            expect(formatMemory(2097152)).toBe('2 TB');
            expect(formatMemory(38000000)).toBe('36.2 TB');
        });

        it('should handle zero', () => {
            expect(formatMemory(0)).toBe('0 MB');
        });

        it('should handle decimal GB values', () => {
            const result1 = formatMemory(1536);
            const result2 = formatMemory(2560);
            expect(result1).toContain('GB');
            expect(result2).toContain('GB');
            expect(parseFloat(result1)).toBeCloseTo(1.5, 1);
            expect(parseFloat(result2)).toBeCloseTo(2.5, 1);
        });
    });

    describe('fetchAccountLimits', () => {
        const mockSacctmgrOutput = `Cluster|Account|User|ParentName|GrpMem|GrpCPUs|GrpTRES|GrpSubmitJobs|MaxJobs|MaxSubmitJobs|
nova|root|||||||||||
nova|research||root||||||||||
nova|las||research|93959424|17000|cpu=17000,gres/gpu=80,mem=93959424M|||||||
nova|stat||las||||||||||
nova|niemi-lab||stat|38000000|7200|cpu=7200,gres/gpu=5,mem=38000000M|||||||
nova|niemi-lab|user1||100|10|cpu=10,mem=100M|||||||`;

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should fetch and parse account limits correctly', () => {
            executeCommand.mockReturnValue(mockSacctmgrOutput);

            const result = fetchAccountLimits();

            expect(result).toHaveProperty('timestamp');
            expect(result).toHaveProperty('accounts');
            expect(result.accounts['niemi-lab']).toBeDefined();
            expect(result.accounts['niemi-lab'].parent).toBe('stat');
            expect(result.accounts['niemi-lab'].grpMem).toBe(38000000);
            expect(result.accounts['niemi-lab'].grpCPUs).toBe(7200);
        });

        it('should parse TRES limits correctly', () => {
            executeCommand.mockReturnValue(mockSacctmgrOutput);

            const result = fetchAccountLimits();

            expect(result.accounts['las'].grpMem).toBe(93959424);
            expect(result.accounts['las'].grpCPUs).toBe(17000);
            expect(result.accounts['las'].grpTRES).toBeDefined();
            expect(result.accounts['las'].grpTRES.mem).toBe(93959424);
            expect(result.accounts['las'].grpTRES.cpu).toBe(17000);
            expect(result.accounts['las'].grpTRES.gres.gpu).toBe(80);
        });

        it('should handle accounts without limits', () => {
            executeCommand.mockReturnValue(mockSacctmgrOutput);

            const result = fetchAccountLimits();

            expect(result.accounts['research']).toBeDefined();
            expect(result.accounts['research'].grpMem).toBeNull();
            expect(result.accounts['research'].grpCPUs).toBeNull();
        });

        it('should group user associations under accounts', () => {
            executeCommand.mockReturnValue(mockSacctmgrOutput);

            const result = fetchAccountLimits();

            expect(result.accounts['niemi-lab'].users).toBeDefined();
            expect(typeof result.accounts['niemi-lab'].users).toBe('object');
            expect(result.accounts['niemi-lab'].users['user1']).toBeDefined();
        });

        it('should handle sacctmgr command failure', () => {
            executeCommand.mockImplementation(() => {
                throw new Error('Command failed');
            });

            expect(() => fetchAccountLimits()).toThrow('Command failed');
        });

        it('should skip empty lines', () => {
            const outputWithEmpty = `Cluster|Account|User|ParentName|GrpMem|GrpCPUs|GrpTRES|
nova|root|||||||

nova|research||root||||||`;
            executeCommand.mockReturnValue(outputWithEmpty);

            const result = fetchAccountLimits();

            expect(Object.keys(result.accounts).length).toBe(2);
        });
    });
});
