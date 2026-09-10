import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { HttpError } from '../middleware/error-handler.js';
import { ProblemCode } from '../../shared/api/v1/common.js';
import type { UiSettingsResponse } from '../../shared/api/v1/ui-settings.js';
import { toHttpError } from './errors.js';

// Same legacy CommonJS boundary pattern as the stats handler: the React
// frontend never imports the runtime-config module directly.
const { getRuntimeConfig } = require('../../../modules/runtimeConfig.js') as {
  getRuntimeConfig: () => {
    ui: {
      charts: {
        cpu: { showSecondaryLayer: boolean };
        memory: { showSecondaryLayer: boolean };
        gpu: { showSecondaryLayer: boolean };
      };
      navbar: { enabled: boolean; title: string; color: string };
    };
  };
};

const uiSettingsQuerySchema = z.strictObject({});

function toUiSettingsResponse(): UiSettingsResponse {
  const config = getRuntimeConfig();
  return {
    charts: {
      cpu: { showSecondaryLayer: config.ui.charts.cpu.showSecondaryLayer },
      memory: { showSecondaryLayer: config.ui.charts.memory.showSecondaryLayer },
      gpu: { showSecondaryLayer: config.ui.charts.gpu.showSecondaryLayer },
    },
    navbar: {
      enabled: config.ui.navbar.enabled,
      title: config.ui.navbar.title,
      color: config.ui.navbar.color,
    },
  };
}

function createUiSettingsHandler() {
  return asyncHandler(async (req, res) => {
    const parsed = uiSettingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`)
        .join('; ');
      throw new HttpError(ProblemCode.BadRequest, `Invalid query parameters: ${detail}`);
    }
    try {
      res.json(toUiSettingsResponse());
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

export { createUiSettingsHandler, toUiSettingsResponse, uiSettingsQuerySchema };
