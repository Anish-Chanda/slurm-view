import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { JobDto } from "../../../shared/api/v1/jobs.ts";
import { ApiError, errorMessage } from "../../api/client.ts";
import { pendingAnalysisQueryOptions } from "../../api/pending-analysis.ts";
import { RefreshWarning } from "../../components/RefreshWarning.tsx";
import { ArrayThrottleAnalysis } from "./pending-analysis/ArrayThrottleAnalysis.tsx";
import {
  AnalysisShell,
  AnalysisSkeleton,
  SimpleReasonAnalysis,
} from "./pending-analysis/AnalysisShell.tsx";
import { DependencyAnalysis } from "./pending-analysis/DependencyAnalysis.tsx";
import { LimitAnalysis } from "./pending-analysis/LimitAnalysis.tsx";
import { PriorityAnalysis } from "./pending-analysis/PriorityAnalysis.tsx";
import { ResourcesAnalysis } from "./pending-analysis/ResourcesAnalysis.tsx";
import {
  PartitionAnalysis,
  RequiredNodesAnalysis,
  ReservationAnalysis,
} from "./pending-analysis/ScopeAnalysis.tsx";

function PendingAnalysisError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  if (
    error instanceof ApiError &&
    (error.status === 409 || error.code === "JOB_NOT_PENDING")
  ) {
    return (
      <section className="mt-6 border border-gray-200 bg-white p-4 text-sm text-gray-600">
        Job state changed. Slurm reports that this job is no longer pending. The
        job details on this page are the captured snapshot.
      </section>
    );
  }
  if (error instanceof ApiError && error.status === 404) {
    return (
      <section className="mt-6 border border-gray-200 bg-white p-4 text-sm text-gray-600">
        Pending analysis is no longer available for this job in live scheduler
        data.
      </section>
    );
  }
  return (
    <section className="mt-6 border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <p>{errorMessage(error)}</p>
      <button type="button" className="mt-2 underline" onClick={onRetry}>
        Retry
      </button>
    </section>
  );
}

function PendingAnalysis({ job }: { job: JobDto }) {
  const query = useQuery(pendingAnalysisQueryOptions(job.id));

  if (query.data === undefined) {
    if (query.isPending) return <AnalysisSkeleton />;
    return (
      <PendingAnalysisError
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { analysis, stateReason, updatedAt } = query.data;
  let body: ReactNode;
  if (analysis === null) {
    body = <SimpleReasonAnalysis />;
  } else {
    switch (analysis.kind) {
      case "resources":
        body = (
          <ResourcesAnalysis
            analysis={analysis}
            partition={job.partition ?? undefined}
          />
        );
        break;
      case "priority":
        body = <PriorityAnalysis analysis={analysis} />;
        break;
      case "dependency":
        body = (
          <DependencyAnalysis
            analysis={analysis}
            neverSatisfied={stateReason === "DependencyNeverSatisfied"}
          />
        );
        break;
      case "limit":
        body = <LimitAnalysis analysis={analysis} />;
        break;
      case "requiredNodes":
        body = <RequiredNodesAnalysis analysis={analysis} />;
        break;
      case "partition":
        body = <PartitionAnalysis analysis={analysis} job={job} />;
        break;
      case "reservation":
        body = (
          <ReservationAnalysis analysis={analysis} updatedAt={updatedAt} />
        );
        break;
      case "arrayThrottle":
        body = <ArrayThrottleAnalysis analysis={analysis} />;
        break;
    }
  }

  return (
    <>
      <AnalysisShell reason={stateReason} updatedAt={updatedAt}>
        {body}
      </AnalysisShell>
      {query.isError ? (
        <div className="mt-3">
          <RefreshWarning
            message="Showing the captured analysis because the latest request failed."
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : null}
    </>
  );
}

export { PendingAnalysis };
