package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/anish-chanda/slurm-view/internal/types"
)

// GetClusters fetches cluster data from the SLURM REST API
func GetClusters(ip, port, user, token string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		apiURL := fmt.Sprintf("http://%s:%s/slurmdb/v0.0.41/clusters/", ip, port)

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
			http.Error(w, "Failed to fetch cluster data", http.StatusBadGateway)
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

		var clusters types.ClusterResponse
		if err := json.Unmarshal(body, &clusters); err != nil {
			http.Error(w, "Failed to parse response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(clusters)
	}
}
