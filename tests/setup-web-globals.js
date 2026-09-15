// The Jest jsdom build predates the Web globals TanStack Router touches at
// import time (TextEncoder) and at runtime (Response). Borrow Node's copies,
// falling back to stubs that only satisfy instanceof checks.
const globals = globalThis;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const util = require('util');
  globals.TextEncoder ??= util.TextEncoder;
  globals.TextDecoder ??= util.TextDecoder;
} catch {
  // require is always available under Jest; kept defensive.
}

globals.Response ??= class Response {};
globals.Request ??= class Request {};
globals.Headers ??= class Headers {};
