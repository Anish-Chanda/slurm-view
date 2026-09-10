function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
      <p className="font-medium">Something went wrong</p>
      <p className="mt-1">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded bg-red-600 px-3 py-1.5 text-white hover:bg-red-700"
      >
        Retry
      </button>
    </div>
  );
}

export { ErrorPanel };
