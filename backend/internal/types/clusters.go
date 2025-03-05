package types

type Cluster struct {
	Name string `json:"name"`
}

type ClusterResponse struct {
	Clusters []Cluster `json:"clusters"`
}
