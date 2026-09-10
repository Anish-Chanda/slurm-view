function RefreshWarning({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
      role="alert"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="ml-3 font-medium underline hover:no-underline"
      >
        Retry
      </button>
    </div>
  );
}

export { RefreshWarning };
