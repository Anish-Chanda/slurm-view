# Slurm View

[![CI](https://github.com/Anish-Chanda/slurm-view/actions/workflows/ci.yml/badge.svg)](https://github.com/Anish-Chanda/slurm-view/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/Anish-Chanda/slurm-view?include_prereleases)](https://github.com/Anish-Chanda/slurm-view/releases)
[![License](https://img.shields.io/github/license/Anish-Chanda/slurm-view)](LICENSE)

Slurm View is an Open OnDemand application for exploring a Slurm cluster without having to piece everything together from command-line tools.

It gives users a quick view of cluster utilization and the job queue, while still making the details available when something needs a closer look. That includes requested resources, job timing, efficiency information, and analysis of why a pending job is waiting.



## What it does

### Cluster overview

See CPU, memory, and GPU utilization across the cluster, with the option to narrow the view to a specific partition.

### Job queue

Browse the live queue in a sortable and searchable table. Jobs can be filtered by fields such as user, partition, state, job ID, and name.

### Job details

Open a job to inspect its state, timing, requested resources, allocation, execution details, and other Slurm metadata in one place.

### Pending reason analysis

Slurm's pending reason is useful, but it often does not tell the whole story.

For supported reasons, Slurm View looks at the surrounding scheduler state and presents the information that helps explain why the job is waiting. This includes resource constraints, priority, dependencies, association and QOS limits, required nodes, partitions, reservations, and array throttling.

The analysis stays tied to information reported by Slurm rather than trying to predict when a job will start.

### Job efficiency

Completed jobs can include CPU and memory efficiency information from `seff`, making it easier to spot jobs that requested substantially more resources than they used.

## Requirements

Slurm View currently runs alongside Open OnDemand and talks directly to the Slurm command-line tools available in the user's environment.

You will need:

- Open OnDemand
- Slurm
- Node.js 22 or newer
- npm
- Slurm CLI tools available from the Open OnDemand environment

`seff` is optional, but is required for job efficiency reports.

## Installation

Prebuilt releases are available on the [Releases page](https://github.com/Anish-Chanda/slurm-view/releases).

Release archives contain both the compiled server and web client, so installing Slurm View does not require building the React or TypeScript application on the cluster.

Installation and upgrade instructions are included with each release.

## Configuration

Slurm View ships with a default configuration in:

```text
config.d/default.yaml
```

Users can override those defaults without modifying the application itself by placing YAML files in:

```text
~/.local/slurm-view/config.d/
```
User configuration is loaded before the bundled defaults, so values defined there take precedence.

## Compatibility

Slurm View is currently designed for Open OnDemand installations where the application can invoke the local Slurm command-line tools.

It has been tested against multiple production Slurm environments, but clusters differ considerably in scheduler configuration and available Slurm versions. Reports from other sites are welcome, especially when something behaves differently from your existing Slurm tools.

## Contributing

First, thank you for considering contributing to Slurm View. Bug reports, ideas, compatibility feedback, documentation improvements, and code contributions are all greatly appreciated.

Bug reports, feature requests, compatibility reports, and pull requests are welcome.

If you are reporting cluster-specific behavior, please include the relevant Slurm version and command output where possible. Remove usernames, account names, node names, paths, and other site-specific information before posting anything sensitive.

See the issue tracker to report a problem or suggest an improvement.

## License

Slurm View is available under the MIT License.
