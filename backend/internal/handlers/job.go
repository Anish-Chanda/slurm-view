package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/anish-chanda/slurm-view/internal/types"
	"github.com/gorilla/mux"
)

func GetJob(ip, port, user, token string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		jobID := vars["job_id"]

		apiURL := fmt.Sprintf("http://%s:%s/slurmdb/v0.0.41/job/%s", ip, port, jobID)

		req, err := http.NewRequest("GET", apiURL, nil)
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}

		req.Header.Set("X-SLURM-USER-NAME", user)
		req.Header.Set("X-SLURM-USER-TOKEN", token)

		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, "Failed to fetch job data", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		var jobResponse types.JobDetailsResponse
		if err := json.NewDecoder(resp.Body).Decode(&jobResponse); err != nil {
			http.Error(w, "Failed to parse response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jobResponse)
	}
}
