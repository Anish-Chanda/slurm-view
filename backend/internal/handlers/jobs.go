package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/anish-chanda/slurm-view/internal/types"
)

// GetJobs fetches job data from the SLURM REST API
func GetJobs(ip, port, user, token string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		apiURL := fmt.Sprintf("http://%s:%s/slurm/v0.0.41/jobs/", ip, port)

		req, err := http.NewRequest("GET", apiURL, nil)
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}

		// Set authorization headers
		req.Header.Set("X-SLURM-USER-NAME", user)
		req.Header.Set("X-SLURM-USER-TOKEN", token)

		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, "Failed to fetch job data", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			http.Error(w, "Non-200 response from SLURM REST API", http.StatusBadGateway)
			return
		}

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			http.Error(w, "Failed to read response body", http.StatusInternalServerError)
			return
		}

		var rawResponse struct {
			Jobs []struct {
				JobID      int      `json:"job_id"`
				Name       string   `json:"name"`
				UserName   string   `json:"user_name"`
				Partition  string   `json:"partition"`
				JobState   []string `json:"job_state"`
				SubmitTime struct {
					Number int64 `json:"number"`
				} `json:"submit_time"`
				StartTime struct {
					Number int64 `json:"number"`
				} `json:"start_time"`
				EndTime struct {
					Number int64 `json:"number"`
				} `json:"end_time"`
				Nodes string `json:"nodes"`
				CPUs  struct {
					Number int `json:"number"`
				} `json:"cpus"`
				MemoryPerNode struct {
					Number int `json:"number"`
				} `json:"memory_per_node"`
			} `json:"jobs"`
		}

		if err := json.Unmarshal(body, &rawResponse); err != nil {
			http.Error(w, "Failed to parse response", http.StatusInternalServerError)
			return
		}

		jobs := []types.Job{}
		for _, job := range rawResponse.Jobs {
			state := ""
			if len(job.JobState) > 0 {
				state = job.JobState[0] // Assuming first state is the primary one
			}

			jobs = append(jobs, types.Job{
				JobID:         job.JobID,
				Name:          job.Name,
				UserName:      job.UserName,
				Partition:     job.Partition,
				State:         state,
				SubmitTime:    job.SubmitTime.Number,
				StartTime:     job.StartTime.Number,
				EndTime:       job.EndTime.Number,
				Nodes:         job.Nodes,
				CPUs:          job.CPUs.Number,
				MemoryPerNode: job.MemoryPerNode.Number,
			})
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(types.JobResponse{Jobs: jobs})
	}
}
