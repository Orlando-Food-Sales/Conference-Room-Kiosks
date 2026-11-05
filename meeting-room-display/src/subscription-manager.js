export class SubscriptionManager {
  constructor(graph, config, onError = console.error) {
    this.graph = graph;
    this.config = config;
    this.onError = onError;
    this.subscription = null;
    this.timer = null;
  }

  async start() {
    if (!this.config.publicBaseUrl || this.config.demoMode) return;
    await this.ensure();
  }

  async ensure() {
    try {
      const url = `${this.config.publicBaseUrl}/api/graph/notifications`;
      this.subscription = await this.graph.createSubscription(url);
      this.schedule();
      console.log(`Graph subscription active until ${this.subscription.expirationDateTime}`);
    } catch (error) {
      this.onError('Unable to create Microsoft Graph subscription; retrying in 5 minutes.', error);
      this.timer = setTimeout(() => this.ensure(), 5 * 60_000);
      this.timer.unref?.();
    }
  }

  schedule() {
    clearTimeout(this.timer);
    const expires = new Date(this.subscription.expirationDateTime).getTime();
    const delay = Math.max(60_000, expires - Date.now() - 30 * 60_000);
    this.timer = setTimeout(() => this.renew(), delay);
    this.timer.unref?.();
  }

  async renew() {
    try {
      this.subscription = await this.graph.renewSubscription(this.subscription.id);
      this.schedule();
      console.log(`Graph subscription renewed until ${this.subscription.expirationDateTime}`);
    } catch (error) {
      this.onError('Unable to renew Microsoft Graph subscription; creating a replacement.', error);
      await this.ensure();
    }
  }

  stop() {
    clearTimeout(this.timer);
  }
}
