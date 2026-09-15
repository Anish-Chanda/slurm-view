import { Router } from 'express';
import { createUiSettingsHandler } from '../../handlers/ui-settings.js';

function createUiSettingsRouter(): Router {
  const router = Router();
  router.get('/', createUiSettingsHandler());
  return router;
}

export { createUiSettingsRouter };
