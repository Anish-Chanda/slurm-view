import { useEffect, useState } from "react";
import { Card } from "../components/ui/Card";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "../components/ui/Select";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "../components/ui/Table";
import { Skeleton } from "../components/ui/Skeleton";
import { Cluster, Job } from "@/types/api";

export default function ClusterDashboard() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(true);

  useEffect(() => {
    fetch("http://localhost:8080/clusters")
      .then((res) => res.json())
      .then((data) => {
        setClusters(data.clusters);
        if (data.length > 0) {
          setSelectedCluster(data[0]);
        }
        setLoadingClusters(false);
      });

    //log to console
    console.log("Clusters: ", clusters);
  }, []);

  useEffect(() => {
    if (!selectedCluster) return;
    setLoadingJobs(true);
    fetch("http://localhost:8080/jobs")
      .then((res) => res.json())
      .then((data) => {
        setJobs(data.jobs);
        setLoadingJobs(false);
      });

      console.log("Jobs: ", jobs);
  }, [selectedCluster]);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 text-white p-4">
        <h2 className="text-lg font-semibold mb-4">Dashboard</h2>
        {loadingClusters ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <Select onValueChange={(value) => setSelectedCluster(value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select a cluster" />
            </SelectTrigger>
            <SelectContent>
              {clusters.map((cluster) => (
                <SelectItem key={cluster.name} value={cluster.name}>
                  {cluster.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="mt-6">
          <button className="w-full p-2 bg-gray-800 rounded-lg text-white">
            Jobs
          </button>
        </div>
      </div>
      {/* Main Content */}
      <div className="flex-1 p-6">
        <h2 className="text-xl font-semibold mb-4">Jobs</h2>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingJobs ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center">
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ) : (
                jobs.map((job) => (
                  <TableRow key={job.job_id}>
                    <TableCell>{job.job_id}</TableCell>
                    <TableCell>{job.state}</TableCell>
                    <TableCell>
                      {new Date(job.start_time).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
