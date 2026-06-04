export interface AnalyticsEvent {
  name: string;
  params?: Record<string, string | number | boolean | null>;
}

class AnalyticsService {
  private enabled = false;

  configure(enabled: boolean): void {
    this.enabled = enabled;
  }

  track(event: AnalyticsEvent): void {
    if (!this.enabled) return;
    globalThis.dispatchEvent(new CustomEvent("gridwatch-analytics", { detail: event }));
  }
}

export const analytics = new AnalyticsService();
