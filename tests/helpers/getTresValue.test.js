const { getTresvalue, parseGpuAllocations } = require("../../helpers/getTresValue");

describe("getTresvalue", () => {
    test("should extract cpu value", () => {
        const tres = "cpu=8,mem=30400M,node=1,billing=8";
        expect(getTresvalue(tres, "cpu")).toBe("8");
    });

    test("should extract mem value", () => {
        const tres = "cpu=8,mem=30400M,node=1,billing=8";
        expect(getTresvalue(tres, "mem")).toBe("30400M");
    });

    test("should extract gres/gpu value", () => {
        const tres = "cpu=8,mem=30400M,node=1,billing=8,gres/gpu=8";
        expect(getTresvalue(tres, "gres/gpu")).toBe("8");
    });

    test("should return N/A for missing key", () => {
        const tres = "cpu=8,mem=30400M";
        expect(getTresvalue(tres, "gres/gpu")).toBe("N/A");
    });

    test("should return N/A for null input", () => {
        expect(getTresvalue(null, "cpu")).toBe("N/A");
    });
});

describe("parseGpuAllocations", () => {
    describe("gres_detail array format", () => {
        test("should parse single GPU type from gres_detail", () => {
            const gresDetail = ["gpu:a100:2(IDX:2-3)"];
            const result = parseGpuAllocations(gresDetail);
            
            expect(result.total).toBe(2);
            expect(result.types).toEqual({ a100: 2 });
        });

        test("should parse multiple GPU entries", () => {
            const gresDetail = ["gpu:a100:4(IDX:0-3)", "gpu:v100:2(IDX:0-1)"];
            const result = parseGpuAllocations(gresDetail);
            
            expect(result.total).toBe(6);
            expect(result.types).toEqual({ a100: 4, v100: 2 });
        });

        test("should handle GPU types with hyphens", () => {
            const gresDetail = ["gpu:a100-pcie:1(IDX:0)"];
            const result = parseGpuAllocations(gresDetail);
            
            expect(result.total).toBe(1);
            expect(result.types).toEqual({ "a100-pcie": 1 });
        });

        test("should aggregate same GPU types", () => {
            const gresDetail = ["gpu:a100:2(IDX:0-1)", "gpu:a100:3(IDX:2-4)"];
            const result = parseGpuAllocations(gresDetail);
            
            expect(result.total).toBe(5);
            expect(result.types).toEqual({ a100: 5 });
        });
    });

    describe("tres string format", () => {
        test("should parse GPU types from tres_req_str", () => {
            const tres = "cpu=1,mem=100G,node=1,billing=2,gres/gpu=2,gres/gpu:a100=2";
            const result = parseGpuAllocations(tres);
            
            expect(result.total).toBe(2);
            expect(result.types).toEqual({ a100: 2 });
        });

        test("should parse multiple GPU types from tres string", () => {
            const tres = "cpu=4,mem=200G,gres/gpu=6,gres/gpu:a100=4,gres/gpu:v100=2";
            const result = parseGpuAllocations(tres);
            
            expect(result.total).toBe(6);
            expect(result.types).toEqual({ a100: 4, v100: 2 });
        });

        test("should handle generic gres/gpu without type", () => {
            const tres = "cpu=2,mem=50G,gres/gpu=3";
            const result = parseGpuAllocations(tres);
            
            expect(result.total).toBe(3);
            expect(result.types).toEqual({ unknown: 3 });
        });

        test("should handle GPU types with special characters", () => {
            const tres = "cpu=1,gres/gpu:v100-sxm2-32G=1";
            const result = parseGpuAllocations(tres);
            
            expect(result.total).toBe(1);
            expect(result.types).toEqual({ "v100-sxm2-32G": 1 });
        });
    });

    describe("edge cases", () => {
        test("should return zero for null input", () => {
            const result = parseGpuAllocations(null);
            
            expect(result.total).toBe(0);
            expect(result.types).toEqual({});
        });

        test("should return zero for undefined input", () => {
            const result = parseGpuAllocations(undefined);
            
            expect(result.total).toBe(0);
            expect(result.types).toEqual({});
        });

        test("should return zero for empty array", () => {
            const result = parseGpuAllocations([]);
            
            expect(result.total).toBe(0);
            expect(result.types).toEqual({});
        });

        test("should return zero for empty string", () => {
            const result = parseGpuAllocations("");
            
            expect(result.total).toBe(0);
            expect(result.types).toEqual({});
        });

        test("should handle malformed gres_detail entries", () => {
            const gresDetail = ["invalid:entry", "gpu:a100:2(IDX:0-1)"];
            const result = parseGpuAllocations(gresDetail);
            
            expect(result.total).toBe(2);
            expect(result.types).toEqual({ a100: 2 });
        });
    });
});
