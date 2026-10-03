// Summarize documented Slurm pending reasons without inferring a root cause.
// Retain the raw code and display unknown codes unchanged.

const PENDING_REASON_LABELS: Record<string, string> = {
  Resources: 'Waiting for resources',
  Priority: 'Higher-priority jobs exist for this partition or reservation',
  Dependency: 'Waiting on a job dependency',
  DependencyNeverSatisfied: 'Waiting on a dependency that can never be satisfied',
  JobHeldUser: 'Held by user or account coordinator',
  JobHeldAdmin: 'Held by a privileged user',
  BeginTime: 'Waiting for its earliest start time',
  Reservation: 'Waiting for its reservation',
  ReqNodeNotAvail: 'Waiting on specifically requested nodes',
  BadConstraints: 'Requested constraints cannot be satisfied',
  PartitionDown: 'Partition is down',
  PartitionInactive: 'Partition is inactive',
  PartitionNodeLimit: 'Node request is outside partition limits',
  PartitionTimeLimit: 'Time limit exceeds the partition limit',
  Prolog: 'Prolog is still running',
  Cleaning: 'Cleaning up from a previous execution',
  WaitingForScheduling: 'Waiting for the scheduler to assess it',
  InvalidAccount: 'Account is invalid',
  InvalidQOS: 'QOS is invalid',
  InactiveLimit: 'Reached the system inactive limit',
  JobLaunchFailure: 'A launch attempt failed',
  SystemFailure: 'System, filesystem, or network failure',
  Licenses: 'Waiting for licenses',
  AssociationJobLimit: 'Association job count limit reached',
  AssociationResourceLimit: 'Association resource limit reached',
  AssociationTimeLimit: 'Association time limit reached',
  AssocMaxJobsLimit: 'Association job count limit reached',
  AssocMaxSubmitJobLimit: 'Association submission count limit reached',
  QOSJobLimit: 'QOS job count limit reached',
  QOSResourceLimit: 'QOS resource limit reached',
  QOSTimeLimit: 'QOS time limit reached',
  QOSUsageThreshold: 'QOS usage threshold breached',
  QOSMaxJobsPerUserLimit: 'Per-user QOS job count limit reached',
  QOSMaxSubmitJobPerUserLimit: 'Per-user QOS submission limit reached',
};

// Slurm appends specific limit names to these prefixes. Keep labels general;
// count-based reasons have dedicated labels above.
function familyLabel(reason: string): string | null {
  if (reason.startsWith('AssocGrp')) {
    return 'An association aggregate limit has been reached';
  }
  if (reason.startsWith('AssocMax')) {
    return 'The request exceeds an association maximum limit';
  }
  if (reason.startsWith('QOSGrp')) {
    return 'A QOS aggregate limit has been reached';
  }
  if (reason.startsWith('QOSMax')) {
    return 'The request exceeds a QOS maximum limit';
  }
  if (reason.startsWith('Max') && reason.includes('PerAccount')) {
    return 'The request exceeds a per-account limit';
  }
  // Other variants have no single documented meaning, so callers retain the
  // raw code instead of showing a potentially misleading description.
  return null;
}

// Return a neutral description when documented, or null so callers show the
// raw code.
function describePendingReason(reason: string): string | null {
  return PENDING_REASON_LABELS[reason] ?? familyLabel(reason);
}

const PENDING_REASON_SCOPE_NOTE =
  'Slurm reports only the reason encountered by the scheduling attempt — other factors may also apply.';

export { PENDING_REASON_SCOPE_NOTE, describePendingReason };
