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

export interface JobDetails {
  account: string;
  comment: {
    administrator: string;
    job: string;
    system: string;
  };
  allocation_nodes: number;
  cluster: string;
  job_id: number;
  name: string;
  nodes: string;
  partition: string;
  qos: string;
  state: {
    current: string[];
    reason: string;
  };
  submit_line: string;
  user: string;
  working_directory: string;
  time: {
    elapsed: number;
    eligible: number;
    end: number;
    start: number;
    submission: number;
  };
  tres: {
    allocated: TresResource[];
    requested: TresResource[];
  };
}

interface TresResource {
  type: string;
  name: string;
  id: number;
  count: number;
}

export interface JobDetailsResponse {
  jobs: JobDetails[];
}