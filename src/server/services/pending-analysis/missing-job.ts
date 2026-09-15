// Missing-job recognition for the targeted lookup and dependency targets.
// The canonical Slurm signal is the exact phrase "Invalid job id
// specified". Other patterns must also name the job id.
const CANONICAL_MISSING_JOB = /invalid job id specified/i;

function mentionsJobId(text: string, jobId: string): boolean {
  const base = jobId.split('_')[0] ?? jobId;
  return text.includes(jobId) || (base.length > 0 && text.includes(base));
}

function isMissingJobSignal(text: string, jobId: string): boolean {
  if (CANONICAL_MISSING_JOB.test(text)) {
    return true;
  }
  if (!mentionsJobId(text, jobId)) {
    return false;
  }
  return /unknown job|no such job|job .* does not exist/i.test(text);
}

export { CANONICAL_MISSING_JOB, isMissingJobSignal, mentionsJobId };
