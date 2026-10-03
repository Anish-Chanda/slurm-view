// Read-only presentation settings from server runtime config. They are fixed
// for the server process lifetime; the client does not load config or policy.
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
