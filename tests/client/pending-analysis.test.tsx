/** @jest-environment jsdom */
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { JobDto } from "../../src/shared/api/v1/jobs";
import type { PendingAnalysisResponse } from "../../src/shared/api/v1/pending-analysis";
import { pendingAnalysisKeys } from "../../src/client/api/query-keys";
import { PendingAnalysis } from "../../src/client/features/job-details/PendingAnalysis";
import { createTestQueryClient } from "./test-query-client";

const job = {
  id: "101",
  jobId: "101",
  arrayJobId: null,
  arrayTaskId: null,
  partition: "debug",
  name: "job",
  user: "u",
  account: "a",
  qos: "normal",
  state: "PENDING",
  stateFlags: [],
  stateReason: "Resources",
  timeLimit: { kind: "finite", seconds: 60 },
  submitTime: null,
  eligibleTime: null,
  startTime: null,
  endTime: null,
  priority: 1,
  taskCount: null,
  cpusPerTask: null,
  constraints: null,
  reservation: null,
  nodeCount: 2,
  nodeExpression: null,
  requested: {
    cpus: 1,
    memoryMiB: 1024,
    nodes: 2,
    gpus: { total: 0, byType: {} },
  },
  allocated: null,
  workdir: null,
  command: null,
  stdoutPath: null,
  stderrPath: null,
  dependency: null,
  exitCode: null,
  derivedExitCode: null,
  wckey: null,
  batchHost: null,
  flags: [],
} as JobDto;

function renderAnalysis(
  analysis: PendingAnalysisResponse["analysis"],
  reason = "Resources",
) {
  const client = createTestQueryClient();
  client.setQueryData(pendingAnalysisKeys.detail("101"), {
    stateReason: reason,
    analysis,
    updatedAt: "2026-09-12T16:00:00.000Z",
  });
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <PendingAnalysis job={{ ...job, stateReason: reason }} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("PendingAnalysis variants", () => {
  test("resources uses labeled metrics and an exact detail disclosure", async () => {
    renderAnalysis({
      kind: "resources",
      scope: "partition",
      analyzedNodes: 100,
      sufficientNodes: 5,
      insufficientNodes: 95,
      unknownNodes: 0,
      bottlenecks: [],
      nodes: Array.from({ length: 9 }, (_, index) => ({
        name: `n${index}`,
        state: null,
        status: "unknown" as const,
        shortages: [],
      })),
    });
    expect(await screen.findByText("Shortage found")).toBeTruthy();
    expect(screen.getByText("95")).toBeTruthy();
    expect(screen.getByText("Show 1 more detailed nodes")).toBeTruthy();
  });

  test("priority, dependency, and limits retain structured evidence", async () => {
    const { unmount } = renderAnalysis(
      {
        kind: "priority",
        partition: "debug",
        priority: 10,
        factors: [
          { name: "age", weighted: 8, normalized: 0.5078166, weight: 8 },
          { name: "fairshare", weighted: 1, normalized: 0.0018171, weight: 1 },
          { name: "partition", weighted: 1, normalized: 0.0000014, weight: 1 },
          { name: "site", weighted: -2, normalized: 1, weight: -2 },
        ],
        pendingJobs: 2,
        higherPriorityJobs: 1,
        runningJobs: 3,
        competitors: [],
      },
      "Priority",
    );
    expect(
      await screen.findByText("Negative factor contributions"),
    ).toBeTruthy();
    expect(screen.getByText("Site: -2")).toBeTruthy();
    expect(screen.getByText("0.507817")).toBeTruthy();
    expect(screen.getByText("0.001817")).toBeTruthy();
    expect(screen.getByText("0.000001")).toBeTruthy();
    expect(screen.queryByText("0.508")).toBeNull();
    expect(screen.queryByText("0.002")).toBeNull();
    expect(screen.queryByText("0.000")).toBeNull();
    unmount();
    renderAnalysis(
      {
        kind: "dependency",
        expression: "afterok:99",
        operator: "single",
        status: "unsatisfied",
        dependencies: [
          {
            type: "afterok",
            status: "unsatisfied",
            jobs: Array.from({ length: 11 }, (_, index) => ({
              jobId: String(index),
              state: null,
              exitCode: null,
              status: "unknown" as const,
            })),
          },
        ],
      },
      "Dependency",
    );
    expect(
      await screen.findByText("Show 1 more dependency targets"),
    ).toBeTruthy();
  });

  test("association and QOS limits use domain-correct consumer headings and units", async () => {
    const { unmount } = renderAnalysis(
      {
        kind: "limit",
        domain: "association",
        metric: "cpuMinutes",
        limit: 20,
        used: 20,
        requested: null,
        hierarchy: [
          {
            account: "project-a",
            user: "user-a",
            partition: "gpu",
            parent: "project-a",
            limit: null,
            used: null,
            limiting: false,
          },
          {
            account: "project-a",
            parent: "department-a",
            limit: 5,
            used: 5,
            limiting: true,
          },
          {
            account: "department-a",
            parent: "division-a",
            limit: null,
            used: null,
            limiting: false,
          },
          {
            account: "division-a",
            parent: "organization-a",
            limit: 84,
            used: 76,
            limiting: false,
          },
          {
            account: "organization-a",
            parent: "root",
            limit: null,
            used: null,
            limiting: false,
          },
          {
            account: "root",
            parent: null,
            limit: null,
            used: null,
            limiting: false,
          },
        ],
        topConsumers: [
          { jobId: "99", user: "user-b", account: "project-a", value: 20 },
        ],
      },
      "AssociationResourceLimit",
    );
    expect((await screen.findAllByText("No limit")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("20 CPU-minutes").length).toBeGreaterThan(0);
    const hierarchy = screen.getByRole("list", {
      name: "Account hierarchy from root to user association",
    });
    const hierarchyText = hierarchy.textContent ?? "";
    const labels = [
      "root",
      "organization-a",
      "division-a",
      "department-a",
      "project-a",
      "user-a @ project-a",
    ];
    let previous = -1;
    for (const label of labels) {
      const position = hierarchyText.indexOf(label);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
    expect(screen.getByText("gpu")).toBeTruthy();
    expect(screen.getByText("Limiting level")).toBeTruthy();
    unmount();
    renderAnalysis(
      {
        kind: "limit",
        domain: "qos",
        metric: "jobs",
        limit: 4,
        used: 4,
        requested: 1,
        qos: "q",
        topConsumers: [{ jobId: "99", user: null, account: null, value: 1 }],
      },
      "QOSJobLimit",
    );
    expect(
      await screen.findByText("Current jobs in this limit scope"),
    ).toBeTruthy();
    unmount();
    renderAnalysis(
      {
        kind: "limit",
        domain: "qos",
        metric: "gpus",
        gpuType: "customType",
        limit: 4,
        used: 4,
        requested: 1,
        qos: "q",
      },
      "QOSGrpGRES",
    );
    expect(await screen.findByText("customType GPU limit")).toBeTruthy();
    expect(screen.getByText(/4 customType GPUs currently in use/)).toBeTruthy();
    expect(screen.getByText("1 customType GPU")).toBeTruthy();
  });

  test("limit usage reports the actual percentage above the visual bar maximum", async () => {
    renderAnalysis(
      {
        kind: "limit",
        domain: "qos",
        metric: "gpus",
        limit: 5,
        used: 6,
        requested: 1,
        qos: "q",
      },
      "QOSGrpGRES",
    );

    expect(await screen.findByText("120%")).toBeTruthy();
  });

  test("required nodes, partition, reservation, array throttle, null analysis, and unknown reason stay conservative", async () => {
    const { unmount } = renderAnalysis(
      { kind: "requiredNodes", expression: "n[1-2]", nodes: [] },
      "ReqNodeNotAvail",
    );
    expect(
      await screen.findByRole("button", { name: "Copy requested nodes" }),
    ).toBeTruthy();
    unmount();
    renderAnalysis(
      {
        kind: "partition",
        partition: "debug",
        state: "UP",
        maxTimeSeconds: 30,
        maxNodes: 1,
        totalNodes: 2,
      },
      "PartitionTimeLimit",
    );
    expect(
      await screen.findByText(/Requested time exceeds partition maximum/),
    ).toBeTruthy();
    unmount();
    renderAnalysis(
      {
        kind: "reservation",
        name: "r",
        state: "ACTIVE",
        startTime: "2026-09-12T15:00:00.000Z",
        endTime: "2026-09-12T17:00:00.000Z",
      },
      "Reservation",
    );
    expect(await screen.findByText("Current reservation window")).toBeTruthy();
    unmount();
    renderAnalysis(
      { kind: "arrayThrottle", maxRunningTasks: 4, runningTasks: 4 },
      "JobArrayTaskLimit",
    );
    expect(
      await screen.findByText(
        "4 of 4 concurrent task slots are currently running",
      ),
    ).toBeTruthy();
  });
});
