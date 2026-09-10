function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
      <p>{message}</p>
      {action !== undefined ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
