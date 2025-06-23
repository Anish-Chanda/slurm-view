# Slurm View (for Open OnDemand)
[![Node.js CI](https://github.com/Anish-Chanda/slurm-view-ood/actions/workflows/node-ci.yml/badge.svg)](https://github.com/Anish-Chanda/slurm-view-ood/actions/workflows/node-ci.yml)

Slurm View is a lightweight, web-based dashboard designed to provide a simple, at-a-glance overview of a High-Performance Computing (HPC) cluster running the Slurm Workload Manager. It is built as a Node.js application, intended to be integrated as a plugin for Open OnDemand.

The primary goal is to offer a clean, modern, and responsive interface for users and administrators to quickly check resource utilization and the status of the job queue.

### Key Features
- Resource Utilization Dashboard: Interactive sunburst charts provide a clear visual breakdown of CPU, Memory, and GPU usage across the cluster.
- Partition-Specific Stats: Easily filter the resource utilization and active jobs to see statistics for a specific Slurm partition.
- Interactive Job Queue: View the live job queue (squeue) in a clean, sortable table with filters for jobId, partition, name, user and state.
- **Expandable Job Details:** Click on any job to instantly see detailed information like the command, working directory, and requested resources.
- **Job Efficiency Reports:** For completed jobs, expand the details to see a visual report of CPU and Memory efficiency, powered by the `seff` command.
- Efficient Backend: A background service periodically polls Slurm and caches the job data to ensure the UI is fast and responsive, minimizing direct load on the Slurm controller, especially in the case where the dashboard is accessed by many users.
- Simple & Fast UI: Built with a "HTML-over-the-wire" approach using Handlebars partials, keeping the client-side logic minimal and the experience snappy.

### Screenshots
![slurm-view-ood-screenshot-1](https://github.com/user-attachments/assets/7c0df7c8-b245-4186-aec9-b4e65e9de47d)

### Tech Stack
- Backend: Node.js, Express.js
- Frontend: Handlebars (Server-Side Rendering), D3.js (Charts), Tailwind CSS (Styling)
- Testing:
    - Unit/Integration: Jest
- **Core Dependencies:** Direct interaction with Slurm command-line tools and `seff`.

### Getting Started

#### Prerequisites
Before installation, ensure the following are available on the system where the app will run:
- A functioning **Slurm** installation.
- The **`seff`** CLI Tool must be installed and available. This is required for the Job Efficiency Report feature. 

```
mkdir -p ~/ondemand/dev
cd ~/ondemand/dev
git clone git@github.com:Anish-Chanda/slurm-view-ood.git
cd slurm-view-ood
module load npm
npm install
```
Then go to your sandbox apps in the OOD page and launch the app

### Contributing
Contributions are welcome! If you find a bug or have a feature request, please open an issue. If you'd like to contribute code, please fork the repository and submit a pull request. Starring the repo is much appreciated :)
