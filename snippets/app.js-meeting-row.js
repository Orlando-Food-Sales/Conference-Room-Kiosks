  const upcoming = state.events
    .filter(event => new Date(event.end).getTime() > now - 30 * 60000)
    .slice(0, 8);

  $('eventList').innerHTML = upcoming.length
    ? upcoming.map(event => {
        const start = new Date(event.start).getTime();
        const end = new Date(event.end).getTime();
        const cls = start <= now && end > now
          ? 'current'
          : end <= now
            ? 'past'
            : '';

        const organizer = event.organizer
          ? escapeText(event.organizer)
          : '';

        return `<article class="event meeting-row ${cls}">
          <div class="meeting-indicator"></div>
          <div class="meeting-time">${formatRange(event)}</div>
          <div class="meeting-subject">${escapeText(event.subject)}</div>
          <div class="meeting-organizer">${organizer}</div>
        </article>`;
      }).join('')
    : '<p class="empty">No more meetings scheduled.</p>';
