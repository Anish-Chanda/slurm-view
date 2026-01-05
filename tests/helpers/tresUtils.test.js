const { parseTres, checkResources } = require("../../helpers/tresUtils");

describe("tresUtils", () => {
    describe("parseTres", () => {
        it("should parse standard TRES string", () => {
            const tres = "cpu=10,mem=100G,billing=10,gres/gpu=1";
            const result = parseTres(tres);
            expect(result.cpu).toBe(10);
            expect(result.mem).toBe(100 * 1024); // 100G in MB
            expect(result.gpu.total).toBe(1);
        });

        it("should handle missing fields", () => {
            const tres = "cpu=5";
            const result = parseTres(tres);
            expect(result.cpu).toBe(5);
            expect(result.mem).toBe(0);
            expect(result.gpu.total).toBe(0);
        });

        it("should handle different memory units (case insensitive, P support)", () => {
            expect(parseTres("mem=1024K").mem).toBe(1);
            expect(parseTres("mem=1024k").mem).toBe(1);
            expect(parseTres("mem=100M").mem).toBe(100);
            expect(parseTres("mem=100m").mem).toBe(100);
            expect(parseTres("mem=1G").mem).toBe(1024);
            expect(parseTres("mem=1g").mem).toBe(1024);
            expect(parseTres("mem=1T").mem).toBe(1024 * 1024);
            expect(parseTres("mem=1P").mem).toBe(1024 * 1024 * 1024);
            expect(parseTres("mem=100").mem).toBe(100); // Default M
        });

        it("should handle invalid formats strictly", () => {
             expect(parseTres("mem=100Mc").mem).toBe(0); // Should fail regex
        });
        
        it("should handle null input", () => {
             const result = parseTres(null);
             expect(result.cpu).toBe(0);
        });
    });

    describe("checkResources", () => {
        const emptyGpu = { total: 0, types: {} };

        it("should identify CPU bottleneck", () => {
            const req = { cpu: 10, mem: 100, gpu: emptyGpu };
            const avail = { cpu: 5, mem: 200, gpu: emptyGpu };
            const result = checkResources(req, avail);
            
            expect(result).toHaveLength(1);
            expect(result[0].resource).toBe('CPU');
            expect(result[0].required).toBe(10);
            expect(result[0].available).toBe(5);
        });

        it("should identify Memory bottleneck", () => {
            const req = { cpu: 10, mem: 200, gpu: emptyGpu };
            const avail = { cpu: 20, mem: 100, gpu: emptyGpu };
            const result = checkResources(req, avail);
            
            expect(result).toHaveLength(1);
            expect(result[0].resource).toBe('Memory');
        });

        it("should identify GPU bottleneck", () => {
            const req = { cpu: 10, mem: 100, gpu: { total: 2, types: {} } };
            const avail = { cpu: 20, mem: 200, gpu: { total: 1, types: {} } };
            const result = checkResources(req, avail);
            
            expect(result).toHaveLength(1);
            expect(result[0].resource).toBe('GPU (Total)');
        });

        it("should return empty array if resources are sufficient", () => {
            const req = { cpu: 10, mem: 100, gpu: { total: 1, types: {} } };
            const avail = { cpu: 20, mem: 200, gpu: { total: 2, types: {} } };
            const result = checkResources(req, avail);
            
            expect(result).toHaveLength(0);
        });
    });
});
