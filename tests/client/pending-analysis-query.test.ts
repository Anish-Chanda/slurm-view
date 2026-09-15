/** @jest-environment jsdom */
import { waitFor } from "@testing-library/react";
import {
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
