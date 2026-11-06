export class SubscriptionManager {
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
  }
  async start() { /* Timer refresh works without public Graph webhooks. */ }
  stop() {}
  processNotifications(values = []) {
    for (const value of values) this.onChange(value);
  }
}
