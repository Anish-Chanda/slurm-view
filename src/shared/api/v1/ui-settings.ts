// Resolved presentation policy for the React UI. This is a small,
// read-only view of the server's runtime config: the frontend learns
// *what to show* (e.g. whether a chart's secondary ring is enabled,
// navbar title/color) without knowing about config.d files, YAML merging,
// or backend calculation settings such as CPU-load thresholds.
// Effectively immutable for the lifetime of the server process.
export interface ChartViewPolicy {
  showSecondaryLayer: boolean;
}

export interface NavbarViewPolicy {
  enabled: boolean;
  title: string;
  color: string;
}

export interface UiSettingsResponse {
  charts: {
    cpu: ChartViewPolicy;
    memory: ChartViewPolicy;
    gpu: ChartViewPolicy;
  };
  navbar: NavbarViewPolicy;
}
