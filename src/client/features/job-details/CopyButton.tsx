import { useState } from 'react';
import { Copy } from 'lucide-react';

function CopyButton({ value, label }: { value: string; label: string }) {
  const [feedback, setFeedback] = useState<'copied' | 'failed' | null>(null);

  function showFeedback(next: 'copied' | 'failed') {
    setFeedback(next);
    window.setTimeout(() => {
      setFeedback((current) => (current === next ? null : current));
    }, 2000);
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      showFeedback('copied');
      return;
    } catch {
      // Fall through to the legacy path below.
    }
    let ok = false;
    try {
      const area = document.createElement('textarea');
      area.value = value;
      document.body.appendChild(area);
      area.select();
      ok = document.execCommand('copy');
      area.remove();
    } catch {
      ok = false;
    }
    showFeedback(ok ? 'copied' : 'failed');
  }

  return (
    <span className="ml-2 inline-flex shrink-0 items-center gap-1 align-middle">
      <button
        type="button"
        aria-label={label}
        onClick={() => void onCopy()}
        className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {feedback !== null ? (
        <span role="status" className="text-xs text-gray-500">
          {feedback === 'copied' ? 'Copied' : 'Copy failed'}
        </span>
      ) : null}
    </span>
  );
}

export { CopyButton };
