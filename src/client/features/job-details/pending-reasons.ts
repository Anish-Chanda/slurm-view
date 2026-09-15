// Human-readable labels for Slurm pending reason codes. Every label stays
// close to the scheduler's documented meaning (squeue JOB REASON CODES /
// job_reason_codes) and never adds causal analysis, predictions, or advice.
// The raw code always travels alongside the label, and unknown codes fall
// back to the raw value alone. Slurm reports only the reason encountered by
// the scheduling attempt, so the UI must never present one reason as the
// definitive root cause.

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

// Starred families from the Slurm docs (AssocGrp*, AssocMax*, QOSGrp*,
// QOSMax*, Max*PerAccount) arrive with concrete suffixes, so match the
// documented family by prefix instead of enumerating every code. Family
// wording stays at the level the docs support for the whole family:
// aggregate language for Grp* limits, "the request exceeds a maximum"
// language for Max* limits (count-based variants are mapped exactly
// above instead, since they describe association/QOS counts, not the
// request itself).
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
  // Anything else (QOSNotAllowed, QOSMin*, other Association*/Partition*
  // variants) has no single documented family meaning: callers fall back
  // to the raw code rather than risk a misleading friendly sentence.
  return null;
}

// Documented, neutral phrasing for a reason code, or null when Slurm
// documents nothing we can safely restate. Callers show the raw code.
function describePendingReason(reason: string): string | null {
  return PENDING_REASON_LABELS[reason] ?? familyLabel(reason);
}

const PENDING_REASON_SCOPE_NOTE =
  'Slurm reports only the reason encountered by the scheduling attempt — other factors may also apply.';

export { PENDING_REASON_SCOPE_NOTE, describePendingReason };
