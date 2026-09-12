import { PENDING_REASON_SCOPE_NOTE, describePendingReason } from '../../src/client/features/job-details/pending-reasons';

describe('describePendingReason', () => {
  test('maps documented codes to neutral labels', () => {
    expect(describePendingReason('Resources')).toBe('Waiting for resources');
    expect(describePendingReason('Priority')).toBe(
      'Higher-priority jobs exist for this partition or reservation'
    );
    expect(describePendingReason('Dependency')).toBe('Waiting on a job dependency');
    expect(describePendingReason('DependencyNeverSatisfied')).toBe(
      'Waiting on a dependency that can never be satisfied'
    );
    expect(describePendingReason('BeginTime')).toBe('Waiting for its earliest start time');
    expect(describePendingReason('Reservation')).toBe('Waiting for its reservation');
    expect(describePendingReason('ReqNodeNotAvail')).toBe('Waiting on specifically requested nodes');
    expect(describePendingReason('WaitingForScheduling')).toBe('Waiting for the scheduler to assess it');
  });

  test('hold labels reflect the documented holder scope', () => {
    // Slurm: held by the user or an account coordinator.
    expect(describePendingReason('JobHeldUser')).toBe('Held by user or account coordinator');
    // Slurm: held by a privileged user.
    expect(describePendingReason('JobHeldAdmin')).toBe('Held by a privileged user');
  });

  test('count-based association limits name the count, not the request', () => {
    expect(describePendingReason('AssocMaxJobsLimit')).toBe('Association job count limit reached');
    expect(describePendingReason('AssocMaxSubmitJobLimit')).toBe(
      'Association submission count limit reached'
    );
  });

  test('count-based QOS limits name the count and per-user scope', () => {
    expect(describePendingReason('QOSMaxJobsPerUserLimit')).toBe(
      'Per-user QOS job count limit reached'
    );
    expect(describePendingReason('QOSMaxSubmitJobPerUserLimit')).toBe(
      'Per-user QOS submission limit reached'
    );
  });

  test('non-count Max families stay at the documented request level', () => {
    expect(describePendingReason('QOSMaxMemoryPerJob')).toBe('The request exceeds a QOS maximum limit');
    expect(describePendingReason('AssocMaxCPUsPerJob')).toBe(
      'The request exceeds an association maximum limit'
    );
  });

  test('per-account limits use documented scope', () => {
    expect(describePendingReason('MaxJobsPerAccount')).toBe('The request exceeds a per-account limit');
  });

  test('failure wording covers the documented breadth', () => {
    // Slurm: failure of the Slurm system, a file system, the network, etc.
    expect(describePendingReason('SystemFailure')).toBe('System, filesystem, or network failure');
  });

  test('aggregate families use aggregate language', () => {
    expect(describePendingReason('QOSGrpCpuLimit')).toBe('A QOS aggregate limit has been reached');
    expect(describePendingReason('AssocGrpNodeLimit')).toBe(
      'An association aggregate limit has been reached'
    );
  });

  test('codes without a shared documented family meaning fall back to raw', () => {
    // QOSNotAllowed is about permission, QOSMin* about minimums: neither
    // shares the limit meaning of the QOSGrp*/QOSMax* families.
    expect(describePendingReason('QOSNotAllowed')).toBeNull();
    expect(describePendingReason('QOSMinWallTime')).toBeNull();
    expect(describePendingReason('AssociationUnknownLimit')).toBeNull();
    expect(describePendingReason('PartitionUnknownState')).toBeNull();
  });

  test('unknown codes fall back to null so callers show the raw value', () => {
    expect(describePendingReason('SomethingEntirelyNew')).toBeNull();
    expect(describePendingReason('')).toBeNull();
  });

  test('the scope note never claims a single root cause', () => {
    expect(PENDING_REASON_SCOPE_NOTE).toMatch(/only the reason encountered/);
  });
});
