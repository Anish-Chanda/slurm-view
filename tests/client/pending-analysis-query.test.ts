/** @jest-environment jsdom */
import { waitFor } from "@testing-library/react";
import {
  fetchPendingAnalysis,
  pendingAnalysisQueryOptions,
  preparePendingAnalysisRouteLoad,
} from "../../src/client/api/pending-analysis";
import { pendingAnalysisKeys } from "../../src/client/api/query-keys";
import { createTestQueryClient } from "./test-query-client";

function response(marker: number) {
  return {
    stateReason: "Resources",
    analysis: null,
    updatedAt: `2026-09-12T16:00:0${marker}.000Z`,
  };
}

describe("pending analysis query lifecycle", () => {
  test("uses an ID-only key and stable, non-polling options", () => {
    expect(pendingAnalysisKeys.detail("101")).toEqual([
      "pending-analysis",
      "detail",
      { id: "101" },
    ]);
    const options = pendingAnalysisQueryOptions("101");
    expect(options.staleTime).toBe(Infinity);
    expect(options.gcTime).toBe(30 * 60 * 1000);
    expect(options).not.toHaveProperty("refetchInterval");
  });

  test("a speculative preload can leave a cached analysis untouched while a real revisit removes it", async () => {
    const client = createTestQueryClient();
    client.setQueryData(pendingAnalysisKeys.detail("101"), response(1));

    preparePendingAnalysisRouteLoad(client, "101", true);
    expect(client.getQueryData(pendingAnalysisKeys.detail("101"))).toEqual(
      response(1),
    );

    preparePendingAnalysisRouteLoad(client, "101", false);
    expect(
      client.getQueryData(pendingAnalysisKeys.detail("101")),
    ).toBeUndefined();

    let calls = 0;
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(response(++calls)),
        headers: { get: () => "application/json" },
      }),
    ) as unknown as typeof fetch;
    await client.fetchQuery(pendingAnalysisQueryOptions("101"));
    await waitFor(() =>
      expect(client.getQueryData(pendingAnalysisKeys.detail("101"))).toEqual(
        response(1),
      ),
    );
  });
});

describe("pending analysis association overview validation", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockResponse(body: unknown): void {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(body),
        headers: { get: () => "application/json" },
      }),
    ) as unknown as typeof fetch;
  }

  function limitResponse(associationOverview?: unknown) {
    return {
      stateReason: "AssocGrpCpuLimit",
      updatedAt: "2026-09-12T16:00:00.000Z",
      analysis: {
        kind: "limit",
        domain: "association",
        metric: "cpus",
        limit: 10,
        used: 4,
        requested: 8,
        hierarchy: [
          {
            account: "project-a",
            user: "user-a",
            parent: "project-a",
            limit: null,
            used: null,
            limiting: false,
          },
        ],
        ...(associationOverview !== undefined
          ? { associationOverview }
          : {}),
      },
    };
  }

  function overview(constraints: unknown[]): unknown {
    return {
      hierarchy: [
        {
          account: "project-a",
          user: "user-a",
          parent: "project-a",
          constraints,
        },
      ],
    };
  }

  test("accepts CPU, memory, generic GPU, and typed GPU constraints", async () => {
    mockResponse(
      limitResponse(
        overview([
          {
            resource: "cpus",
            limit: 10,
            used: 4,
            requested: 8,
            status: "usageExceeded",
          },
          {
            resource: "memoryMiB",
            limit: 2000,
            used: 500,
            requested: 8000,
            status: "exceedsRequest",
          },
          {
            resource: "gpus",
            gpuType: "a100",
            limit: 4,
            used: null,
            requested: 2,
            status: "unknown",
          },
          {
            resource: "gpus",
            limit: 8,
            used: 1,
            requested: 0,
            status: "withinLimit",
          },
        ]),
      ),
    );

    const result = await fetchPendingAnalysis("101");
    expect(result.analysis?.kind).toBe("limit");
    if (result.analysis?.kind === "limit") {
      expect(result.analysis.associationOverview?.hierarchy[0]?.constraints).toHaveLength(
        4,
      );
    }
  });

  test("accepts a response without the optional overview", async () => {
    mockResponse(limitResponse());
    await expect(fetchPendingAnalysis("101")).resolves.toMatchObject({
      stateReason: "AssocGrpCpuLimit",
    });
  });

  test.each([
    [
      "unknown status",
      overview([
        {
          resource: "cpus",
          limit: 10,
          used: 4,
          requested: 8,
          status: "maybe",
        },
      ]),
    ],
    [
      "missing limit",
      overview([
        { resource: "cpus", used: 4, requested: 8, status: "withinLimit" },
      ]),
    ],
    [
      "non-numeric usage",
      overview([
        {
          resource: "cpus",
          limit: 10,
          used: "4",
          requested: 8,
          status: "withinLimit",
        },
      ]),
    ],
    [
      "unknown resource",
      overview([
        {
          resource: "nodes",
          limit: 10,
          used: 4,
          requested: 8,
          status: "withinLimit",
        },
      ]),
    ],
    [
      "non-string gpu type",
      overview([
        {
          resource: "gpus",
          gpuType: 1,
          limit: 10,
          used: 4,
          requested: 8,
          status: "withinLimit",
        },
      ]),
    ],
    [
      "constraints not an array",
      { hierarchy: [{ account: "project-a", parent: null, constraints: null }] },
    ],
    [
      "missing parent field",
      { hierarchy: [{ account: "project-a", constraints: [] }] },
    ],
  ])("rejects %s", async (_name, invalidOverview) => {
    mockResponse(limitResponse(invalidOverview));
    await expect(fetchPendingAnalysis("101")).rejects.toMatchObject({
      code: "INVALID_PENDING_ANALYSIS_RESPONSE",
      status: 502,
    });
  });
});

describe("pending analysis runtime-minute overview validation", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockResponse(body: unknown): void {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(body),
        headers: { get: () => "application/json" },
      }),
    ) as unknown as typeof fetch;
  }

  function runtimeResponse(runtimeMinuteOverview?: unknown) {
    return {
      stateReason: "AssocGrpGRESRunMinutes",
      updatedAt: "2026-09-12T16:00:00.000Z",
      analysis: {
        kind: "limit",
        domain: "association",
        metric: "gpuMinutes",
        gpuType: "a100",
        limit: 100,
        used: 60,
        requested: 120,
        hierarchy: [
          {
            account: "project-a",
            parent: "project-a",
            limit: null,
            used: null,
            limiting: false,
          },
        ],
        ...(runtimeMinuteOverview !== undefined
          ? { runtimeMinuteOverview }
          : {}),
      },
    };
  }

  function runtimeOverview(constraints: unknown[]): unknown {
    return {
      hierarchy: [
        {
          account: "project-a",
          user: "user-a",
          parent: "project-a",
          constraints,
        },
      ],
    };
  }

  test("accepts CPU, memory, generic GPU, and typed GPU runtime constraints", async () => {
    mockResponse(
      runtimeResponse(
        runtimeOverview([
          {
            metric: "cpuMinutes",
            limit: 1000,
            committed: 200,
            projected: 400,
            status: "withinLimit",
          },
          {
            metric: "memoryMiBMinutes",
            limit: 2_000_000,
            committed: null,
            projected: 500_000,
            status: "unknown",
          },
          {
            metric: "gpuMinutes",
            limit: 500,
            committed: 100,
            projected: 120,
            status: "withinLimit",
          },
          {
            metric: "gpuMinutes",
            gpuType: "a100",
            limit: 100,
            committed: 60,
            projected: 120,
            status: "exceedsRequest",
          },
        ]),
      ),
    );

    const result = await fetchPendingAnalysis("101");
    expect(result.analysis?.kind).toBe("limit");
    if (result.analysis?.kind === "limit") {
      expect(result.analysis.metric).toBe("gpuMinutes");
      expect(
        result.analysis.runtimeMinuteOverview?.hierarchy[0]?.constraints,
      ).toHaveLength(4);
    }
  });

  test("accepts a limit analysis without the optional runtime overview", async () => {
    mockResponse(runtimeResponse());
    await expect(fetchPendingAnalysis("101")).resolves.toMatchObject({
      stateReason: "AssocGrpGRESRunMinutes",
    });
  });

  test.each([
    [
      "unknown runtime metric",
      runtimeOverview([
        {
          metric: "nodes",
          limit: 10,
          committed: 4,
          projected: 8,
          status: "withinLimit",
        },
      ]),
    ],
    [
      "unknown runtime status",
      runtimeOverview([
        {
          metric: "cpuMinutes",
          limit: 10,
          committed: 4,
          projected: 8,
          status: "maybe",
        },
      ]),
    ],
    [
      "non-numeric committed minutes",
      runtimeOverview([
        {
          metric: "cpuMinutes",
          limit: 10,
          committed: "4",
          projected: 8,
          status: "withinLimit",
        },
      ]),
    ],
    [
      "missing runtime parent",
      { hierarchy: [{ account: "project-a", constraints: [] }] },
    ],
  ])("rejects %s", async (_name, invalidOverview) => {
    mockResponse(runtimeResponse(invalidOverview));
    await expect(fetchPendingAnalysis("101")).rejects.toMatchObject({
      code: "INVALID_PENDING_ANALYSIS_RESPONSE",
      status: 502,
    });
  });
});
