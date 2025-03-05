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

type JobResponseSingle struct {
	Job Job `json:"job"`
}

type TimeInfo struct {
	Elapsed    int64 `json:"elapsed"`
	Eligible   int64 `json:"eligible"`
	End        int64 `json:"end"`
	Start      int64 `json:"start"`
	Submission int64 `json:"submission"`
}

type JobResource struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	ID    int    `json:"id"`
	Count int    `json:"count"`
}

type JobComment struct {
	Administrator string `json:"administrator"`
	Job           string `json:"job"`
	System        string `json:"system"`
}
type JobState struct {
	Current []string `json:"current"`
	Reason  string   `json:"reason"`
}

type TresResource struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	ID    int    `json:"id"`
	Count int    `json:"count"`
}

type JobDetails struct {
	Account          string     `json:"account"`
	Comment          JobComment `json:"comment"`
	AllocationNodes  int        `json:"allocation_nodes"`
	Cluster          string     `json:"cluster"`
	JobID            int        `json:"job_id"`
	Name             string     `json:"name"`
	Nodes            string     `json:"nodes"`
	Partition        string     `json:"partition"`
	QOS              string     `json:"qos"`
	State            JobState   `json:"state"`
	SubmitLine       string     `json:"submit_line"`
	User             string     `json:"user"`
	WorkingDirectory string     `json:"working_directory"`
	Time             struct {
		Elapsed    int64 `json:"elapsed"`
		Eligible   int64 `json:"eligible"`
		End        int64 `json:"end"`
		Start      int64 `json:"start"`
		Submission int64 `json:"submission"`
	} `json:"time"`
	Tres struct {
		Allocated []TresResource `json:"allocated"`
		Requested []TresResource `json:"requested"`
	} `json:"tres"`
}

type JobDetailsResponse struct {
	Jobs []JobDetails `json:"jobs"`
}
