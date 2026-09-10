import type { UiSettingsResponse } from '../../shared/api/v1/ui-settings.ts';
import { apiUrl } from './base.ts';
import { fetchJson } from './client.ts';

function fetchUiSettings(options: { signal?: AbortSignal } = {}): Promise<UiSettingsResponse> {
  return fetchJson<UiSettingsResponse>(apiUrl('ui-settings'), options);
}

export { fetchUiSettings };
