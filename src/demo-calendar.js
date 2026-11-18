export class DemoCalendar {
  constructor(room, index = 0, options = {}) {
    this.room = room;
    this.meetings = options.meetings !== false;
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
    return [...(this.meetings ? examples : []), ...this.bookings]
      .filter(event => new Date(event.end).getTime() > from && new Date(event.start).getTime() < to)
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  async createEvent(booking) {
    const event = { id: `demo-${Date.now()}-${this.bookings.length}`, isPrivate: false, ...booking };
    this.bookings.push(event);
    return event;
  }
  async updateEvent(id, { end }) {
    const event = this.bookings.find(item => item.id === id);
    if (!event) throw Object.assign(new Error('Event not found'), { status: 404, kind: 'not-found' });
    event.end = new Date(end).toISOString();
    return event;
  }
}
