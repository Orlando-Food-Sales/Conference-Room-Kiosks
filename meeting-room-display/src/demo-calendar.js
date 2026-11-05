function roundToFive(date) {
  const result = new Date(date);
  result.setSeconds(0, 0);
  result.setMinutes(Math.ceil(result.getMinutes() / 5) * 5);
  return result;
}

export class DemoCalendar {
  constructor(now = new Date()) {
    const base = roundToFive(now);
    this.events = [
      {
        id: 'demo-current',
        subject: 'Product launch readiness',
        organizer: 'Maya Chen',
        start: new Date(base.getTime() - 20 * 60_000).toISOString(),
        end: new Date(base.getTime() + 25 * 60_000).toISOString(),
        isPrivate: false,
      },
      {
        id: 'demo-next',
        subject: 'Design review',
        organizer: 'Alex Morgan',
        start: new Date(base.getTime() + 45 * 60_000).toISOString(),
        end: new Date(base.getTime() + 90 * 60_000).toISOString(),
        isPrivate: false,
      },
      {
        id: 'demo-later',
        subject: 'Private meeting',
        organizer: '',
        start: new Date(base.getTime() + 125 * 60_000).toISOString(),
        end: new Date(base.getTime() + 165 * 60_000).toISOString(),
        isPrivate: true,
      },
    ];
  }

  async listEvents(start, end) {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    return this.events
      .filter((event) => new Date(event.end).getTime() > startMs && new Date(event.start).getTime() < endMs)
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  async createEvent(booking) {
    const event = {
      id: `demo-${crypto.randomUUID()}`,
      subject: booking.subject,
      organizer: 'Room display',
      start: booking.start,
      end: booking.end,
      isPrivate: false,
    };
    this.events.push(event);
    return event;
  }
}
