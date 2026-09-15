// Slurm returned entries in errors[].
class SlurmUpstreamError extends Error {
  public readonly notices: readonly string[];

  constructor(notices: readonly string[]) {
    super(`Slurm reported errors: ${notices.join('; ') || 'unknown error'}`);
    this.name = 'SlurmUpstreamError';
    this.notices = notices;
  }
}

// Invalid JSON or structurally invalid payload.
class UpstreamInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamInvalidError';
  }
}

function summarizeZodIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[]
): string {
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'root'}: ${issue.message}`)
    .join('; ');
}

export { SlurmUpstreamError, UpstreamInvalidError, summarizeZodIssues };
