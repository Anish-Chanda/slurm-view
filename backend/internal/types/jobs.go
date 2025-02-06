package types

type Job struct {
	JobID         int    `json:"job_id"`
	Name          string `json:"name"`
	UserName      string `json:"user_name"`
	Partition     string `json:"partition"`
	State         string `json:"state"`
	SubmitTime    int64  `json:"submit_time"`
	StartTime     int64  `json:"start_time"`
	EndTime       int64  `json:"end_time"`
	Nodes         string `json:"nodes"`
	CPUs          int    `json:"cpus"`
	MemoryPerNode int    `json:"memory_per_node"`
}

type JobResponse struct {
	Jobs []Job `json:"jobs"`
}
