// Types matching backend Go structs
export interface Job {
  job_id: number;
  name: string;
  user_name: string;
  partition: string;
  state: string;
  submit_time: number;
  start_time: number;
  end_time: number;
  nodes: string;
  cpus: number;
  memory_per_node: number;
}

export interface JobResponse {
  jobs: Job[];
}

export interface Cluster {
  name: string;
}

export interface ClusterResponse {
  clusters: Cluster[];
}
