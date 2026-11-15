/** @jest-environment jsdom */
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { JobDto } from "../../src/shared/api/v1/jobs";
import type {
  LimitAnalysisDto,
  PendingAnalysisResponse,
} from "../../src/shared/api/v1/pending-analysis";
import { pendingAnalysisKeys } from "../../src/client/api/query-keys";
import { PendingAnalysis } from "../../src/client/features/job-details/PendingAnalysis";
import { PENDING_REASON_SCOPE_NOTE } from "../../src/client/features/job-details/pending-reasons";
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
  allocated: {
    cpus: null,
    memoryMiB: null,
    nodes: null,
    gpus: { total: 0, byType: {} },
    gpuPresent: false,
  },
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
  jobOverrides: Partial<JobDto> = {},
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
    component: () => (
      <PendingAnalysis
        job={{ ...job, ...jobOverrides, stateReason: reason }}
      />
    ),
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
  test("includes the scheduler-reason scope explanation for assistive technology", async () => {
    renderAnalysis(null);

    const scopeNote = await screen.findByText(PENDING_REASON_SCOPE_NOTE);
    expect(scopeNote.getAttribute("aria-hidden")).not.toBe("true");
  });

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

  test("resources keeps each shortage dimension readable within node evidence", async () => {
    renderAnalysis({
      kind: "resources",
      scope: "partition",
      analyzedNodes: 1,
      sufficientNodes: 0,
      insufficientNodes: 1,
      unknownNodes: 0,
      bottlenecks: [],
      nodes: [
        {
          name: "compute-gpu-001",
          state: "IDLE",
          status: "insufficient",
          shortages: [
            { resource: "cpus", requested: 16, currentlyUnallocated: 10 },
            {
              resource: "memoryMiB",
              requested: 245_760,
              currentlyUnallocated: 14_746,
            },
            {
              resource: "gpus",
              gpuType: "h200",
              requested: 2,
              currentlyUnallocated: 0,
            },
          ],
        },
      ],
    });

    expect(await screen.findByText("compute-gpu-001")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Shortage" })).toBeTruthy();
    const shortageCell = screen.getByRole("cell", {
      name: /CPU.*requested.*16.*Memory.*requested.*240 GiB.*h200 GPU/,
    });
    expect(shortageCell.textContent).toContain("unallocated 10");
    expect(shortageCell.textContent).toContain("unallocated 14.4 GiB");
    expect(shortageCell.textContent).toContain("unallocated 0");
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
      name: "Association hierarchy from root to user association",
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
    expect(
      screen.getByRole("heading", { name: "Association hierarchy" }),
    ).toBeTruthy();
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

  test("association overview shares one hierarchy across CPU, memory, and GPU constraints", async () => {
    renderAnalysis(
      {
        kind: "limit",
        domain: "association",
        metric: "cpus",
        limit: 10,
        used: 9,
        requested: 8,
        account: "project-a",
        limitingAccount: "project-a",
        user: "user-a",
        hierarchy: [
          {
            account: "project-a",
            user: "user-a",
            parent: "project-a",
            limit: null,
            used: null,
            limiting: false,
          },
          {
            account: "project-a",
            parent: "department-a",
            limit: 10,
            used: 9,
            limiting: true,
            exceedsLimit: false,
          },
          {
            account: "department-a",
            parent: null,
            limit: null,
            used: null,
            limiting: false,
          },
        ],
        associationOverview: {
          hierarchy: [
            {
              account: "project-a",
              user: "user-a",
              parent: "project-a",
              constraints: [
                {
                  resource: "gpus",
                  gpuType: "a100",
                  limit: 2,
                  used: 1,
                  requested: 4,
                  status: "exceedsRequest",
                },
              ],
            },
            {
              account: "project-a",
              parent: "department-a",
              constraints: [
                {
                  resource: "cpus",
                  limit: 10,
                  used: 9,
                  requested: 8,
                  status: "usageExceeded",
                },
                {
                  resource: "memoryMiB",
                  limit: 1000,
                  used: 100,
                  requested: 8000,
                  status: "exceedsRequest",
                },
                {
                  resource: "gpus",
                  limit: 10,
                  used: 3,
                  requested: 8,
                  status: "usageExceeded",
                },
              ],
            },
            {
              account: "department-a",
              parent: null,
              constraints: [],
            },
          ],
        },
      },
      "AssocGrpCpuLimit",
      {
        requested: {
          cpus: 8,
          memoryMiB: 8192,
          nodes: 2,
          gpus: { total: 8, byType: { a100: 4, v100: 4 } },
        },
      },
    );

    expect(
      await screen.findByRole("heading", { name: "Association resource limits" }),
    ).toBeTruthy();
    const cpuCard = screen.getByRole("article", {
      name: "CPU association limits",
    });
    const memoryCard = screen.getByRole("article", {
      name: "Memory association limits",
    });
    const gpuCard = screen.getByRole("article", {
      name: "GPU association limits",
    });
    expect(within(cpuCard).getByText("Reported by Slurm")).toBeTruthy();
    expect(within(memoryCard).queryByText("Reported by Slurm")).toBeNull();
    expect(within(gpuCard).queryByText("Reported by Slurm")).toBeNull();
    expect(
      screen.getByText(
        "Additional resource limits are evaluated from current allocations.",
      ),
    ).toBeTruthy();
    expect(within(cpuCard).getByText("9 / 10 CPUs")).toBeTruthy();
    expect(within(cpuCard).getByText("project-a")).toBeTruthy();
    expect(within(cpuCard).getByText("+8 CPUs requested")).toBeTruthy();
    expect(within(cpuCard).getByText(/7 CPUs over limit/)).toBeTruthy();
    expect(
      within(cpuCard).getByText(/7 CPUs over limit/).className,
    ).toContain("text-amber-700");
    expect(within(memoryCard).getByText("100 MiB / 1000 MiB")).toBeTruthy();
    expect(within(memoryCard).getByText("+7.8 GiB requested")).toBeTruthy();
    expect(within(memoryCard).getByText(/6.8 GiB over limit/)).toBeTruthy();
    expect(
      within(memoryCard).getByText(/6.8 GiB over limit/).className,
    ).toContain("text-red-700");
    expect(within(gpuCard).getByText("1 / 2 a100 GPUs")).toBeTruthy();
    expect(within(gpuCard).getByText("+4 a100 GPUs requested")).toBeTruthy();
    expect(within(gpuCard).getByText(/2 a100 GPUs over limit/)).toBeTruthy();
    expect(screen.queryByText(/headroom/)).toBeNull();

    const allocationBars = Array.from(
      cpuCard.querySelectorAll<HTMLElement>("div[style]"),
    );
    expect(allocationBars.map((element) => element.style.width)).toEqual([
      "90%",
      "10%",
    ]);
    expect(allocationBars[0]?.className).toContain("bg-blue-600");
    expect(allocationBars[1]?.className).toContain("bg-amber-400");

    const table = screen.getByRole("table", {
      name: /Association hierarchy from root to user association/,
    });
    expect(
      within(table).getByRole("columnheader", { name: "CPU" }),
    ).toBeTruthy();
    expect(
      within(table).getByRole("columnheader", { name: "Memory" }),
    ).toBeTruthy();
    expect(
      within(table).getByRole("columnheader", { name: "GPU" }),
    ).toBeTruthy();
    expect(table.className).not.toContain("min-w-[");
    const tableText = table.textContent ?? "";
    const rootPosition = tableText.indexOf("department-a");
    const accountPosition = tableText.indexOf("project-a");
    const userPosition = tableText.indexOf("user-a @ project-a");
    expect(rootPosition).toBeGreaterThan(-1);
    expect(accountPosition).toBeGreaterThan(rootPosition);
    expect(userPosition).toBeGreaterThan(accountPosition);

    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4); // Header plus three association levels.
    expect(within(table).queryByText("Primary diagnosis")).toBeNull();
    expect(within(table).queryByText("User association")).toBeNull();

    expect(within(table).getAllByText("Request exceeds limit")).toHaveLength(2);
    expect(
      within(table).getByText("+8 CPUs requested · 7 CPUs over limit"),
    ).toBeTruthy();
    expect(
      within(table).getByText("+8 GPUs requested · 1 GPU over limit"),
    ).toBeTruthy();
    expect(within(table).queryByText("No violation found")).toBeNull();
    expect(within(table).getByText("1 / 2 a100 GPUs")).toBeTruthy();
    expect(within(table).getByText("3 / 10 GPUs")).toBeTruthy();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "This job exceeds more than one current limit",
    );
    expect(within(alert).getAllByRole("listitem")).toHaveLength(2);
    expect(alert.textContent).toContain("7.8 GiB");
    expect(alert.textContent).toContain("4 a100 GPUs");
    expect(alert.textContent).toContain("user-a @ project-a");
    expect(alert.textContent).toContain("project-a");
    expect(screen.getAllByText(/probably never run/)).toHaveLength(1);
  });

  test("association overview marks resources without limits", async () => {
    renderAnalysis(
      {
        kind: "limit",
        domain: "association",
        metric: "cpus",
        limit: 20,
        used: 1,
        requested: 2,
        associationOverview: {
          hierarchy: [
            {
              account: "project-a",
              user: "user-a",
              parent: "project-a",
              constraints: [
                {
                  resource: "cpus",
                  limit: 20,
                  used: 1,
                  requested: 2,
                  status: "withinLimit",
                },
              ],
            },
            {
              account: "project-a",
              parent: null,
              constraints: [],
            },
          ],
        },
      },
      "AssocGrpCpuLimit",
    );

    expect(
      await screen.findByRole("article", { name: "CPU association limits" }),
    ).toBeTruthy();
    const memoryCard = screen.getByRole("article", {
      name: "Memory association limits",
    });
    expect(within(memoryCard).getByText("No limit configured")).toBeTruthy();
    expect(within(memoryCard).getByText("1 GiB requested")).toBeTruthy();
    expect(
      within(
        screen.getByRole("article", { name: "GPU association limits" }),
      ).getByText("Not requested"),
    ).toBeTruthy();
    const table = screen.getByRole("table", {
      name: /Association hierarchy from root to user association/,
    });
    expect(within(table).queryByText(/ GPUs$/)).toBeNull();
    expect(within(table).getAllByText("—")).toHaveLength(5);
    expect(screen.queryByRole("alert")).toBeNull();

    const selector = screen.getByRole("group", {
      name: "Choose association resource",
    });
    expect(
      within(selector).getByRole("button", { name: "CPU" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    const memoryButton = within(selector).getByRole("button", {
      name: "Memory",
    });
    fireEvent.click(memoryButton);
    expect(memoryButton.getAttribute("aria-pressed")).toBe("true");
  });

  test.each([false, true])("GPU requests without applicable limits use precise wording (runtime: %s)", async (runtime) => {
    renderAnalysis(
      {
        kind: "limit",
        domain: "association",
        metric: runtime ? "cpuMinutes" : "cpus",
        limit: 20,
        used: 1,
        requested: 2,
        ...(runtime
          ? { runtimeMinuteOverview: { hierarchy: [] } }
          : { associationOverview: { hierarchy: [] } }),
      },
      runtime ? "AssocGrpCPURunMinutesLimit" : "AssocGrpCpuLimit",
      { requested: { cpus: 1, memoryMiB: 1024, nodes: 1, gpus: { total: 1, byType: { a100: 1 } } } },
    );

    const card = await screen.findByRole("article", {
      name: runtime ? "GPU-minute association limits" : "GPU association limits",
    });
    expect(within(card).getByText("No applicable limit")).toBeTruthy();
    expect(within(card).queryByText("No limit configured")).toBeNull();
  });

  test("unknown usage does not fabricate a utilization percentage", async () => {
    renderAnalysis(
      {
        kind: "limit",
        domain: "association",
        metric: "cpus",
        limit: 20,
        used: null,
        requested: 2,
        associationOverview: {
          hierarchy: [
            {
              account: "project-a",
              user: "user-a",
              parent: "project-a",
              constraints: [
                {
                  resource: "cpus",
                  limit: 20,
                  used: null,
                  requested: 2,
                  status: "unknown",
                },
              ],
            },
          ],
        },
      },
      "AssocGrpCpuLimit",
    );

    const card = await screen.findByRole("article", {
      name: "CPU association limits",
    });
    expect(within(card).getByText("Unknown / 20 CPUs")).toBeTruthy();
    expect(within(card).getByText("user-a @ project-a")).toBeTruthy();
    expect(within(card).getByText("+2 CPUs requested").className).toBe("text-gray-600");
    expect(within(card).queryByText(/%/)).toBeNull();
    expect(card.querySelectorAll("div[style]")).toHaveLength(0);

    const table = screen.getByRole("table", {
      name: /Association hierarchy from root to user association/,
    });
    expect(within(table).getByText("Unknown / 20 CPUs")).toBeTruthy();
    expect(within(table).getByText("Usage unavailable")).toBeTruthy();
  });

  test("known usage can prove a violation while total usage is unknown", async () => {
    renderAnalysis(
      {
        kind: "limit",
        domain: "association",
        metric: "cpus",
        limit: 10,
        used: null,
        requested: 8,
        associationOverview: {
          hierarchy: [
            {
              account: "project-a",
              user: "user-a",
              parent: "project-a",
              constraints: [
                {
                  resource: "cpus",
                  limit: 10,
                  used: null,
                  requested: 8,
                  status: "usageExceeded",
                },
              ],
            },
          ],
        },
      },
      "AssocGrpCpuLimit",
    );

    const card = await screen.findByRole("article", {
      name: "CPU association limits",
    });
    expect(within(card).getByText("Unknown / 10 CPUs")).toBeTruthy();
    expect(
      within(card).getByText("Known usage plus request exceeds the limit"),
    ).toBeTruthy();
    expect(within(card).queryByText(/CPUs over the limit/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    const table = screen.getByRole("table", {
      name: /Association hierarchy from root to user association/,
    });
    expect(
      within(table).getByText("Known usage plus request exceeds the limit"),
    ).toBeTruthy();
  });

  test("mobile resource selector defaults to the reported GPU resource", async () => {
    renderAnalysis(
      {
        kind: "limit",
        domain: "association",
        metric: "gpus",
        gpuType: "a100",
        limit: 4,
        used: 1,
        requested: 2,
        associationOverview: {
          hierarchy: [
            {
              account: "project-a",
              user: "user-a",
              partition: "debug",
              parent: "project-a",
              constraints: [
                {
                  resource: "gpus",
                  gpuType: "a100",
                  limit: 4,
                  used: 1,
                  requested: 2,
                  status: "withinLimit",
                },
              ],
            },
          ],
        },
      },
      "AssocGrpGRES",
      {
        requested: {
          cpus: 1,
          memoryMiB: 1024,
          nodes: 2,
          gpus: { total: 2, byType: { a100: 2 } },
        },
      },
    );

    const gpuCard = await screen.findByRole("article", {
      name: "GPU association limits",
    });
    expect(within(gpuCard).getByText("Reported by Slurm")).toBeTruthy();
    expect(within(gpuCard).getByText("1 / 4 a100 GPUs")).toBeTruthy();
    expect(within(gpuCard).getByText("+2 a100 GPUs requested").className).toBe("text-gray-600");
    const bars = gpuCard.querySelectorAll<HTMLElement>("div[style]");
    expect(bars[0]?.className).toContain("bg-blue-600");
    expect(bars[1]?.className).toContain("bg-gray-300");

    const selector = screen.getByRole("group", {
      name: "Choose association resource",
    });
    const gpuButton = within(selector).getByRole("button", { name: "GPU" });
    expect(gpuButton.getAttribute("aria-pressed")).toBe("true");
    expect(
      within(selector).getByRole("button", { name: "CPU" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("false");

    const table = screen.getByRole("table", {
      name: /Association hierarchy from root to user association/,
    });
    expect(within(table).getByText("Partition debug")).toBeTruthy();
    const gpuColumn = within(table).getByRole("columnheader", { name: "GPU" });
    const cpuColumn = within(table).getByRole("columnheader", { name: "CPU" });
    expect(gpuColumn.className).not.toContain("hidden");
    expect(cpuColumn.className).toContain("hidden");

    fireEvent.click(
      within(selector).getByRole("button", { name: "CPU" }),
    );
    expect(
      within(selector).getByRole("button", { name: "CPU" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(gpuButton.getAttribute("aria-pressed")).toBe("false");
    expect(
      within(table).getByRole("columnheader", { name: "CPU" }).className,
    ).not.toContain("hidden");
  });

  describe("runtime-minute association limits", () => {
    function runtimeAnalysis(
      overrides: Partial<LimitAnalysisDto> = {},
    ): LimitAnalysisDto {
      return {
        kind: "limit",
        domain: "association",
        metric: "cpuMinutes",
        limit: 300,
        used: 120,
        requested: 240,
        account: "project-a",
        limitingAccount: "project-a",
        user: "user-a",
        runningJobs: 1,
        hierarchy: [
          {
            account: "project-a",
            user: "user-a",
            parent: "project-a",
            limit: null,
            used: null,
            limiting: false,
          },
          {
            account: "project-a",
            parent: "department-a",
            limit: 300,
            used: 120,
            limiting: true,
          },
          {
            account: "department-a",
            parent: null,
            limit: null,
            used: null,
            limiting: false,
          },
        ],
        runtimeMinuteOverview: {
          hierarchy: [
            {
              account: "project-a",
              user: "user-a",
              parent: "project-a",
              constraints: [
                {
                  metric: "cpuMinutes",
                  limit: 300,
                  committed: 120,
                  projected: 240,
                  status: "usageExceeded",
                },
                {
                  metric: "memoryMiBMinutes",
                  limit: 1_048_576,
                  committed: 524_288,
                  projected: 1_572_864,
                  status: "exceedsRequest",
                },
                {
                  metric: "gpuMinutes",
                  gpuType: "a100",
                  limit: 100,
                  committed: 20,
                  projected: 120,
                  status: "exceedsRequest",
                },
              ],
            },
            {
              account: "project-a",
              parent: "department-a",
              constraints: [],
            },
            {
              account: "department-a",
              parent: null,
              constraints: [],
            },
          ],
        },
        ...overrides,
      };
    }

    const gpuJob = {
      requested: {
        cpus: 1,
        memoryMiB: 1024,
        nodes: 2,
        gpus: { total: 2, byType: { a100: 2 } },
      },
    };

    test("summarizes CPU, memory, and GPU minutes with readable units and capped bars", async () => {
      renderAnalysis(
        runtimeAnalysis(),
        "AssocGrpCPURunMinutesLimit",
        gpuJob,
      );

      expect(
        await screen.findByRole("heading", {
          name: "Association runtime-minute limits",
        }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          "Estimates use visible running jobs and current QOS settings. Actual scheduler accounting may differ.",
        ),
      ).toBeTruthy();
      const cpuCard = screen.getByRole("article", {
        name: "CPU-minute association limits",
      });
      const memoryCard = screen.getByRole("article", {
        name: "Memory-minute association limits",
      });
      const gpuCard = screen.getByRole("article", {
        name: "GPU-minute association limits",
      });
      expect(within(cpuCard).getByText("Reported by Slurm")).toBeTruthy();
      expect(within(memoryCard).queryByText("Reported by Slurm")).toBeNull();
      expect(within(gpuCard).queryByText("Reported by Slurm")).toBeNull();
      expect(screen.queryByText("Primary diagnosis")).toBeNull();

      expect(
        within(cpuCard).getByText("120 CPU-minutes / 300 CPU-minutes"),
      ).toBeTruthy();
      expect(
        within(cpuCard).getByText("+240 CPU-minutes projected"),
      ).toBeTruthy();
      expect(
        within(cpuCard).getByText(/60 CPU-minutes over limit/),
      ).toBeTruthy();
      expect(
        within(memoryCard).getByText(
          "512 GiB-minutes / 1,024 GiB-minutes",
        ),
      ).toBeTruthy();
      expect(
        within(memoryCard).getByText("+1,536 GiB-minutes projected"),
      ).toBeTruthy();
      expect(
        within(memoryCard).getByText(/512 GiB-minutes over limit/),
      ).toBeTruthy();
      expect(
        within(gpuCard).getByText(
          "20 a100 GPU-minutes / 100 a100 GPU-minutes",
        ),
      ).toBeTruthy();
      expect(
        within(gpuCard).getByText("+120 a100 GPU-minutes projected"),
      ).toBeTruthy();
      expect(
        within(gpuCard).getByText(/20 a100 GPU-minutes over limit/),
      ).toBeTruthy();

      const cpuBars = Array.from(
        cpuCard.querySelectorAll<HTMLElement>("div[style]"),
      );
      expect(cpuBars.map((bar) => bar.style.width)).toEqual(["40%", "60%"]);
      expect(cpuBars[0]?.className).toContain("bg-blue-600");
      expect(cpuBars[1]?.className).toContain("bg-amber-400");
      const gpuBars = Array.from(
        gpuCard.querySelectorAll<HTMLElement>("div[style]"),
      );
      expect(gpuBars.map((bar) => bar.style.width)).toEqual(["20%", "80%"]);
      expect(gpuBars[1]?.className).toContain("bg-red-500");
    });

    test("shares the hierarchy tree and keeps generic and typed GPU limits separate", async () => {
      renderAnalysis(
        runtimeAnalysis({
          runtimeMinuteOverview: {
            hierarchy: [
              {
                account: "project-a",
                user: "user-a",
                parent: "project-a",
                constraints: [
                  {
                    metric: "cpuMinutes",
                    limit: 300,
                    committed: 120,
                    projected: 240,
                    status: "usageExceeded",
                  },
                  {
                    metric: "gpuMinutes",
                    limit: 500,
                    committed: 360,
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
                ],
              },
              {
                account: "project-a",
                parent: "department-a",
                constraints: [
                  {
                    metric: "memoryMiBMinutes",
                    limit: 1_000_000,
                    committed: 0,
                    projected: 491_520,
                    status: "withinLimit",
                  },
                ],
              },
              {
                account: "department-a",
                parent: null,
                constraints: [],
              },
            ],
          },
        }),
        "AssocGrpCPURunMinutesLimit",
        gpuJob,
      );

      expect(
        await screen.findByRole("article", {
          name: "CPU-minute association limits",
        }),
      ).toBeTruthy();
      const table = screen.getByRole("table", {
        name: /Association hierarchy from root to user association with CPU-minute, memory-minute, and GPU-minute limits/,
      });
      expect(
        within(table).getByRole("columnheader", { name: "CPU-minutes" }),
      ).toBeTruthy();
      expect(
        within(table).getByRole("columnheader", { name: "Memory-minutes" }),
      ).toBeTruthy();
      expect(
        within(table).getByRole("columnheader", { name: "GPU-minutes" }),
      ).toBeTruthy();
      expect(table.className).toContain("table-fixed");
      expect(within(table).getByText("360 GPU-minutes / 500 GPU-minutes")).toBeTruthy();
      expect(
        within(table).getByText(
          "60 a100 GPU-minutes / 100 a100 GPU-minutes",
        ),
      ).toBeTruthy();
      expect(
        within(table).getByText("Projected commitment exceeds limit"),
      ).toBeTruthy();
      expect(within(table).queryByText("Primary diagnosis")).toBeNull();
      expect(within(table).getAllByText("—")).toHaveLength(6);

      const selector = screen.getByRole("group", {
        name: "Choose association resource",
      });
      const cpuButton = within(selector).getByRole("button", { name: "CPU" });
      expect(cpuButton.getAttribute("aria-pressed")).toBe("true");
      const memoryButton = within(selector).getByRole("button", {
        name: "Memory",
      });
      expect(
        within(table).getByRole("columnheader", { name: "Memory-minutes" })
          .className,
      ).toContain("hidden");
      fireEvent.click(memoryButton);
      expect(memoryButton.getAttribute("aria-pressed")).toBe("true");
      expect(cpuButton.getAttribute("aria-pressed")).toBe("false");
      expect(
        within(table).getByRole("columnheader", { name: "Memory-minutes" })
          .className,
      ).not.toContain("hidden");
    });

    test("reports unknown runtime estimates without substituting zero", async () => {
      renderAnalysis(
        runtimeAnalysis({
          hierarchy: [],
          runtimeMinuteOverview: {
            hierarchy: [
              {
                account: "project-a",
                user: "user-a",
                parent: "project-a",
                constraints: [
                  {
                    metric: "cpuMinutes",
                    limit: 1000,
                    committed: null,
                    projected: 240,
                    status: "unknown",
                  },
                  {
                    metric: "memoryMiBMinutes",
                    limit: 1_000_000,
                    committed: 100_000,
                    projected: null,
                    status: "unknown",
                  },
                ],
              },
              {
                account: "project-a",
                parent: null,
                constraints: [],
              },
            ],
          },
        }),
        "AssocGrpCPURunMinutesLimit",
      );

      const cpuCard = await screen.findByRole("article", {
        name: "CPU-minute association limits",
      });
      expect(
        within(cpuCard).getByText("Unknown / 1,000 CPU-minutes"),
      ).toBeTruthy();
      expect(
        within(cpuCard).getByText("+240 CPU-minutes projected"),
      ).toBeTruthy();
      expect(cpuCard.querySelectorAll("div[style]")).toHaveLength(0);
      const memoryCard = screen.getByRole("article", {
        name: "Memory-minute association limits",
      });
      expect(
        within(memoryCard).getByText(
          "97.7 GiB-minutes / 977 GiB-minutes",
        ),
      ).toBeTruthy();
      expect(
        within(memoryCard).getByText("Projection unavailable"),
      ).toBeTruthy();
      expect(
        within(
          screen.getByRole("article", {
            name: "GPU-minute association limits",
          }),
        ).getByText("Not requested"),
      ).toBeTruthy();

      const table = screen.getByRole("table", {
        name: /Association hierarchy from root to user association with CPU-minute/,
      });
      expect(
        within(table).getByText("Committed estimate unavailable"),
      ).toBeTruthy();
      expect(
        within(table).getAllByText("Projection unavailable").length,
      ).toBeGreaterThan(0);
      expect(within(table).queryByText(/%/)).toBeNull();
    });

    test("runtime estimates never imply a permanent scheduling block", async () => {
      renderAnalysis(
        runtimeAnalysis(),
        "AssocGrpCPURunMinutesLimit",
        gpuJob,
      );

      await screen.findByRole("heading", { name: "Association runtime-minute limits" });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText(/probably never run/)).toBeNull();
      expect(screen.getByText(/Actual scheduler accounting may differ/)).toBeTruthy();
      expect(screen.getAllByText("Projected commitment exceeds limit").length).toBeGreaterThan(0);
    });
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

  test("priority keeps its context metric wording in the diagnostic", async () => {
    renderAnalysis(
      {
        kind: "priority",
        partition: "partition-a",
        priority: 10,
        factors: [],
        pendingJobs: 915,
        higherPriorityJobs: 169,
        runningJobs: 619,
        competitors: [],
      },
      "Priority",
    );

    expect(await screen.findByText("Pending in partition")).toBeTruthy();
    expect(screen.getByText("Higher numeric priority")).toBeTruthy();
    expect(screen.getByText("Running in partition")).toBeTruthy();
  });

  test("footer identifies scheduler state at the analysis time", async () => {
    renderAnalysis(null);

    expect(
      await screen.findByText(/Based on scheduler state at analysis time/),
    ).toBeTruthy();
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
