import { describe, expect, it } from 'vitest';
import { buildIcsCalendar, buildIcsEvent, icsFileName, type IcsEventInput } from './ics';

const NOW = new Date('2026-07-24T15:30:00Z');

function splitLines(ics: string): string[] {
  return ics.split('\r\n').slice(0, -1); // trailing entry from the final CRLF
}

describe('buildIcsEvent — structure', () => {
  it('wraps a minimal all-day event in a valid VCALENDAR/VEVENT', () => {
    const event: IcsEventInput = {
      uid: 'preObs-20260305@peerobservations.orono.k12.mn.us',
      summary: 'Pre-Observation Conversation',
      description: 'Meet with your peer evaluator before the observation.',
      start: new Date('2026-03-05T00:00:00'),
      end: new Date('2026-03-05T00:00:00'),
      allDay: true,
    };
    const ics = buildIcsEvent(event, NOW);
    const lines = splitLines(ics);

    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('PRODID:-//Orono Public Schools//Peer Observations//EN');
    expect(lines).toContain('CALSCALE:GREGORIAN');
    expect(lines).toContain('METHOD:PUBLISH');
    expect(lines).toContain('BEGIN:VEVENT');
    expect(lines).toContain('UID:preObs-20260305@peerobservations.orono.k12.mn.us');
    expect(lines).toContain('DTSTAMP:20260724T153000Z');
    expect(lines).toContain('SUMMARY:Pre-Observation Conversation');
    expect(lines).toContain(
      'DESCRIPTION:Meet with your peer evaluator before the observation.',
    );
    expect(lines).toContain('END:VEVENT');
    expect(lines[lines.length - 1]).toBe('END:VCALENDAR');
  });

  it('uses CRLF line terminators throughout, including the trailing line', () => {
    const ics = buildIcsEvent(
      {
        uid: 'u1@example.com',
        summary: 'Test',
        start: new Date('2026-03-05T00:00:00'),
        end: new Date('2026-03-05T00:00:00'),
        allDay: true,
      },
      NOW,
    );
    expect(ics.endsWith('\r\n')).toBe(true);
    // Every line break must be a full CRLF pair — no bare LF or CR.
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('omits DESCRIPTION and LOCATION when not provided', () => {
    const ics = buildIcsEvent(
      {
        uid: 'u1@example.com',
        summary: 'Test',
        start: new Date('2026-03-05T00:00:00'),
        end: new Date('2026-03-05T00:00:00'),
        allDay: true,
      },
      NOW,
    );
    expect(ics).not.toContain('DESCRIPTION');
    expect(ics).not.toContain('LOCATION');
  });
});

describe('buildIcsEvent — all-day DTSTART/DTEND', () => {
  it('emits VALUE=DATE and advances DTEND to the day after a same-day start/end', () => {
    const ics = buildIcsEvent(
      {
        uid: 'u1@example.com',
        summary: 'Observation',
        start: new Date('2026-03-05T09:00:00'),
        end: new Date('2026-03-05T09:00:00'),
        allDay: true,
      },
      NOW,
    );
    const lines = splitLines(ics);
    expect(lines).toContain('DTSTART;VALUE=DATE:20260305');
    expect(lines).toContain('DTEND;VALUE=DATE:20260306');
  });

  it('respects an explicit multi-day end date rather than re-advancing it', () => {
    const ics = buildIcsEvent(
      {
        uid: 'u1@example.com',
        summary: 'Multi-day',
        start: new Date('2026-03-05T00:00:00'),
        end: new Date('2026-03-08T00:00:00'),
        allDay: true,
      },
      NOW,
    );
    const lines = splitLines(ics);
    expect(lines).toContain('DTSTART;VALUE=DATE:20260305');
    expect(lines).toContain('DTEND;VALUE=DATE:20260308');
  });
});

describe('buildIcsEvent — timed events', () => {
  it('emits DTSTART/DTEND as UTC datetimes for a timed event', () => {
    const ics = buildIcsEvent(
      {
        uid: 'u1@example.com',
        summary: 'Booked slot',
        start: new Date('2026-03-05T14:00:00.000Z'),
        end: new Date('2026-03-05T14:45:00.000Z'),
        allDay: false,
      },
      NOW,
    );
    const lines = splitLines(ics);
    expect(lines).toContain('DTSTART:20260305T140000Z');
    expect(lines).toContain('DTEND:20260305T144500Z');
  });

  it('throws when a timed event ends before it starts', () => {
    expect(() =>
      buildIcsEvent({
        uid: 'u1@example.com',
        summary: 'Bad range',
        start: new Date('2026-03-05T14:00:00.000Z'),
        end: new Date('2026-03-05T13:00:00.000Z'),
        allDay: false,
      }),
    ).toThrow(/end must not be before start/);
  });
});

describe('buildIcsEvent — escaping', () => {
  it('escapes commas, semicolons, backslashes, and newlines in TEXT values', () => {
    const ics = buildIcsEvent(
      {
        uid: 'u1@example.com',
        summary: 'Room 204; bring, a\\notebook',
        description: 'Line one\nLine two',
        start: new Date('2026-03-05T00:00:00'),
        end: new Date('2026-03-05T00:00:00'),
        allDay: true,
      },
      NOW,
    );
    expect(ics).toContain('SUMMARY:Room 204\\; bring\\, a\\\\notebook');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
  });
});

describe('buildIcsEvent — line folding', () => {
  it('folds long DESCRIPTION lines to <=75 octets per physical line, with a leading space on continuations', () => {
    const longText = 'A'.repeat(200);
    const ics = buildIcsEvent(
      {
        uid: 'u1@example.com',
        summary: 'Long description test',
        description: longText,
        start: new Date('2026-03-05T00:00:00'),
        end: new Date('2026-03-05T00:00:00'),
        allDay: true,
      },
      NOW,
    );
    const physicalLines = ics.split('\r\n').slice(0, -1);
    const encoder = new TextEncoder();
    for (const line of physicalLines) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    // Folded continuation lines carry the mandatory single leading space.
    const descStart = physicalLines.findIndex((l) => l.startsWith('DESCRIPTION:'));
    expect(physicalLines[descStart + 1]?.startsWith(' ')).toBe(true);

    // Un-folding (strip CRLF + following space) must reconstruct the original text exactly.
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`DESCRIPTION:${longText}`);
  });

  it('does not fold short lines', () => {
    const ics = buildIcsEvent(
      {
        uid: 'u1@example.com',
        summary: 'Short',
        start: new Date('2026-03-05T00:00:00'),
        end: new Date('2026-03-05T00:00:00'),
        allDay: true,
      },
      NOW,
    );
    expect(ics).toContain('SUMMARY:Short\r\n');
  });
});

describe('buildIcsEvent — validation', () => {
  it('throws on an empty uid', () => {
    expect(() =>
      buildIcsEvent({
        uid: '  ',
        summary: 'Test',
        start: new Date('2026-03-05T00:00:00'),
        end: new Date('2026-03-05T00:00:00'),
        allDay: true,
      }),
    ).toThrow(/uid is required/);
  });

  it('throws on a uid containing a line break', () => {
    expect(() =>
      buildIcsEvent({
        uid: 'bad\nuid@example.com',
        summary: 'Test',
        start: new Date('2026-03-05T00:00:00'),
        end: new Date('2026-03-05T00:00:00'),
        allDay: true,
      }),
    ).toThrow(/line break/);
  });

  it('throws on an empty summary', () => {
    expect(() =>
      buildIcsEvent({
        uid: 'u1@example.com',
        summary: '   ',
        start: new Date('2026-03-05T00:00:00'),
        end: new Date('2026-03-05T00:00:00'),
        allDay: true,
      }),
    ).toThrow(/summary is required/);
  });
});

describe('buildIcsCalendar — multi-event', () => {
  it('emits one VEVENT block per input event, each with its own UID', () => {
    const ics = buildIcsCalendar(
      [
        {
          uid: 'a@example.com',
          summary: 'Event A',
          start: new Date('2026-03-05T00:00:00'),
          end: new Date('2026-03-05T00:00:00'),
          allDay: true,
        },
        {
          uid: 'b@example.com',
          summary: 'Event B',
          start: new Date('2026-03-06T00:00:00'),
          end: new Date('2026-03-06T00:00:00'),
          allDay: true,
        },
      ],
      NOW,
    );
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('UID:a@example.com');
    expect(ics).toContain('UID:b@example.com');
  });

  it('throws when given an empty event list', () => {
    expect(() => buildIcsCalendar([])).toThrow(/at least one event/);
  });
});

describe('icsFileName', () => {
  it('slugifies a summary into a safe .ics filename', () => {
    expect(icsFileName('Pre-Observation: Room 204')).toBe('pre-observation-room-204.ics');
  });

  it('falls back to "event.ics" when the summary has no safe characters', () => {
    expect(icsFileName('!!!')).toBe('event.ics');
  });
});
