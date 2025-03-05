import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardHeader, CardContent } from "./components/ui/Card";
import { Skeleton } from "./components/ui/Skeleton";
import {
  Timeline,
  TimelineItem,
  TimelineContent,
  TimelineSeparator,
  TimelineDot,
  TimelineConnector,
} from "@mui/lab";
import { JobDetails } from "./types/api";

export default function JobDetailsView() {
  const { jobId } = useParams();
  const [job, setJob] = useState<JobDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`http://localhost:8080/job/${jobId}`)
      .then((res) => res.json())
      .then((data) => {
        setJob(data.jobs[0]);
        setLoading(false);
      });
  }, [jobId]);

  if (loading) {
    return (
      <div className="p-6">
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="grid gap-6">
        {/* Main Info Card */}
        <Card>
          <CardHeader>
            <h2 className="text-2xl font-semibold">{job?.name}</h2>
            <p className="text-muted-foreground">Job ID: {job?.job_id}</p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <InfoItem label="Status" value={job?.state.current[0]} />
              <InfoItem label="Cluster" value={job?.cluster} />
              <InfoItem label="User" value={job?.user} />
              <InfoItem label="Account" value={job?.account} />
              <InfoItem label="Partition" value={job?.partition} />
              <InfoItem label="QoS" value={job?.qos} />
            </div>
          </CardContent>
        </Card>

        {/* Resource Usage Card */}
        <Card>
          <CardHeader>
            <h3 className="text-xl font-semibold">Resource Usage</h3>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="font-medium mb-2">Allocated Resources</h4>
                {job?.tres.allocated.map((res) => (
                  <p key={res.id} className="text-sm text-muted-foreground">
                    {res.type}: {res.count}
                  </p>
                ))}
              </div>
              <div>
                <h4 className="font-medium mb-2">Requested Resources</h4>
                {job?.tres.requested.map((res) => (
                  <p key={res.id} className="text-sm text-muted-foreground">
                    {res.type}: {res.count}
                  </p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Timeline Card */}
        <Card>
          <CardHeader>
            <h3 className="text-xl font-semibold">Job Timeline</h3>
          </CardHeader>
          <CardContent>
            <Timeline>
              <TimelineItem>
                <TimelineSeparator>
                  <TimelineDot />
                  <TimelineConnector />
                </TimelineSeparator>
                <TimelineContent>
                  <p className="font-medium">Submitted</p>
                  <p className="text-sm text-muted-foreground">
                    {job?.time.submission ? new Date(job.time.submission * 1000).toLocaleString() : "-"}
                  </p>
                </TimelineContent>
              </TimelineItem>
              <TimelineItem>
                <TimelineSeparator>
                  <TimelineDot />
                  <TimelineConnector />
                </TimelineSeparator>
                <TimelineContent>
                  <p className="font-medium">Started</p>
                  <p className="text-sm text-muted-foreground">
                    {job?.time.start ? new Date(job.time.start * 1000).toLocaleString() : "-"}
                  </p>
                </TimelineContent>
              </TimelineItem>
              <TimelineItem>
                <TimelineSeparator>
                  <TimelineDot />
                </TimelineSeparator>
                <TimelineContent>
                  <p className="font-medium">Ended</p>
                  <p className="text-sm text-muted-foreground">
                    {job?.time.end
                      ? new Date(job.time.end * 1000).toLocaleString()
                      : "Running"}
                  </p>
                </TimelineContent>
              </TimelineItem>
            </Timeline>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value || "-"}</p>
    </div>
  );
}