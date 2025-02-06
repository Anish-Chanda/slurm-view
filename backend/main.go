package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/anish-chanda/slurm-view/internal/handlers"
	"github.com/gorilla/mux"
	"github.com/rs/cors"
)

func getEnvOrExit(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("ERROR: Missing required environment variable: %s", key)
	}
	return value
}

func main() {
	// Read required environment variables
	slurmUser := getEnvOrExit("SLURM_USER_NAME")
	slurmToken := getEnvOrExit("SLURM_USER_TOKEN")
	slurmRestdIP := getEnvOrExit("SLURM_RESTD_IP")
	slurmRestdPort := getEnvOrExit("SLURM_RESTD_PORT")

	// Setup router
	r := mux.NewRouter()
	r.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Println(r.URL.Query().Encode())
	})
	r.HandleFunc("/clusters", handlers.GetClusters(slurmRestdIP, slurmRestdPort, slurmUser, slurmToken)).Methods("GET")
	r.HandleFunc("/jobs", handlers.GetJobs(slurmRestdIP, slurmRestdPort, slurmUser, slurmToken)).Methods("GET")

	c := cors.New(cors.Options{
		AllowedOrigins: []string{"http://localhost:3000"},
		// AllowCredentials: true,
	})
	handler := c.Handler(r)

	// Start server
	port := "8080" // Default port
	log.Printf("Server listening on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}
