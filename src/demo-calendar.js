export class DemoCalendar {
  constructor(room, index = 0) {
    this.room = room;
    this.index = index;
    this.bookings = [];
  }

  async listEvents(start, end) {
    const from = new Date(start).getTime();
    const to = new Date(end).getTime();
    const now = Date.now();
    const seed = now - (now % 3600000) + this.index * 900000;
    const examples = [
      { id: `demo-current-${this.index}`, subject: 'Team sync', organizer: 'Demo Organizer', start: new Date(seed - 600000).toISOString(), end: new Date(seed + 2400000).toISOString(), isPrivate: false },
      { id: `demo-next-${this.index}`, subject: 'Project review', organizer: 'Demo Organizer', start: new Date(seed + 3600000).toISOString(), end: new Date(seed + 7200000).toISOString(), isPrivate: false }
    ];
    return [...examples, ...this.bookings]
      .filter(event => new Date(event.end).getTime() > from && new Date(event.start).getTime() < to)
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  async createEvent(booking) {
    const event = { id: `demo-${Date.now()}`, isPrivate: false, ...booking };
    this.bookings.push(event);
    return event;
  }
}
