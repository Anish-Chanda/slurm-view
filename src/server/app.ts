import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'path';
import { createV1Router } from './routes/v1/index.js';
import type { V1RouterDeps } from './routes/v1/index.js';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function createApp(v1Deps: V1RouterDeps = {}): Express {
  const app = express();

  const passengerBaseUri: string = process.env.PASSENGER_BASE_URI || '';
  const basePath = `${passengerBaseUri}/`;

  const router = express.Router();
  app.use(passengerBaseUri || '/', router);

  router.use('/api/v1', createV1Router(v1Deps));

  // Server-reserved namespaces. These legacy surfaces have been removed and
  // must return real 404s; they must never receive the React shell.
  // /api/v1/* is handled by the v1 router above and never reaches here.
  const reservedNotFound = (_req: Request, res: Response): void => {
    res.sendStatus(404);
  };
  app.use(`${basePath}api`, reservedNotFound);
  app.use(`${basePath}partials`, reservedNotFound);
  app.use(`${basePath}react`, reservedNotFound);

  // Canonicalize the slash-less OOD prefix (e.g. /pun/dev/slurm-view ->
  // /pun/dev/slurm-view/). Express matches non-strictly, so this also sees
  // the trailing-slash URL; only redirect the slash-less form.
  if (passengerBaseUri) {
    app.get(passengerBaseUri, (req: Request, res: Response, next: NextFunction) => {
      if (req.path.endsWith('/')) return next();
      res.redirect(`${passengerBaseUri}/`);
    });
  }

  // React production build output.
  const reactDistPath = path.join(PROJECT_ROOT, 'dist', 'client');
  app.use(basePath, express.static(reactDistPath, { index: false }));

  // The build uses relative asset URLs, so shell HTML carries a base tag
  // pointing at the application root. Without it, ./assets/... below
  // /jobs/123 would resolve to /jobs/assets.
  let cachedShell: string | null | undefined;
  function loadReactShell(): string | null {
    if (cachedShell === undefined) {
      try {
        cachedShell = fs.readFileSync(path.join(reactDistPath, 'index.html'), 'utf8');
      } catch {
        cachedShell = null;
      }
    }
    return cachedShell;
  }
  function sendReactShell(res: Response, next: NextFunction): void {
    const raw = loadReactShell();
    if (raw === null) {
      next();
      return;
    }
    const base = basePath.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    res.type('html').send(raw.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`));
  }

  app.get(basePath, (_req: Request, res: Response, next: NextFunction) => {
    sendReactShell(res, next);
  });

  // Explicit job deep-link route so refreshes render the job page.
  // Malformed IDs still receive the shell so the client router can render
  // GlobalNotFound.
  app.get(`${basePath}jobs/:jobId`, (_req: Request, res: Response, next: NextFunction) => {
    sendReactShell(res, next);
  });

  // Remaining browser-facing paths serve the shell so the client router can
  // render GlobalNotFound. File-like segments still 404.
  app.get(`${basePath}*`, (req: Request, res: Response, next: NextFunction) => {
    const lastSegment = req.path.split('/').pop() ?? '';
    if (lastSegment.includes('.')) {
      next();
      return;
    }
    sendReactShell(res, next);
  });

  return app;
}

export { createApp };
