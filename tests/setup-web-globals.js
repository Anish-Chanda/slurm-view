// This jsdom version lacks Web globals used by TanStack Router. Use Node's
// implementations when available; the stubs only support instanceof checks.
const globals = globalThis;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const util = require('util');
  globals.TextEncoder ??= util.TextEncoder;
  globals.TextDecoder ??= util.TextDecoder;
} catch {
}

globals.Response ??= class Response {};
globals.Request ??= class Request {};
globals.Headers ??= class Headers {};
