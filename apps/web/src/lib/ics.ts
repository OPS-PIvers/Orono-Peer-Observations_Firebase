/**
 * Minimal RFC 5545 (iCalendar) `.ics` file builder — client-only,
 * dependency-free.
 *
 * Built for the staff dashboard's "Add to calendar" links (STAFF-04), but
 * deliberately kept generic — the signature is keyed on explicit
 * uid/summary/start/end rather than anything dashboard-specific — so
 * SCHED-07 (an `.ics` download on booking confirmation) can reuse this
 * module as-is instead of growing a second builder.
 *
 * Scope is intentionally minimal: one VEVENT per call (or a handful via
 * `buildIcsCalendar`), no recurrence, no attendees, no timezone database.
 * Timed events are emitted in UTC (`Z` suffix) so no VTIMEZONE block is
 * required, and all-day events use the `VALUE=DATE` form. That covers every
 * event this app currently needs to export — a single dated meeting —
 * without pulling in a calendar library.
 */

const CRLF = '\r\n';
/** RFC 5545 §3.1 — content lines SHOULD NOT exceed 75 octets. */
const MAX_LINE_OCTETS = 75;
const PRODID = '-//Orono Public Schools//Peer Observations//EN';

export interface IcsEventInput {
  /**
   * Globally unique, stable identifier for this logical event. Stable means
   * re-building the *same* event later (e.g. the user re-downloads after a
   * reschedule with the same id) should reuse the same `uid` so calendar
   * apps that support update semantics treat it as an update rather than a
   * duplicate. Must not contain a line break.
   */
  uid: string;
  /** Event title (VEVENT SUMMARY). */
  summary: string;
  /** Optional free-text body (VEVENT DESCRIPTION). */
  description?: string;
  /** Optional location (VEVENT LOCATION). */
  location?: string;
  /**
   * Event start. For an all-day event (`allDay: true`) only the LOCAL
   * calendar date (year/month/day) is used — any time-of-day component is
   * ignored, since the event has no known clock time.
   */
  start: Date;
  /**
   * Event end (exclusive, per RFC 5545). For an all-day event, pass the
   * same calendar date as `start` for a one-day event — the builder
   * automatically advances it to the following day, since `DTEND` for an
   * all-day VEVENT is the day *after* the last day of the event.
   */
  end: Date;
  /** Emit an all-day VEVENT (`VALUE=DATE`) instead of a timed one. Default `false`. */
  allDay?: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYYMMDD` from a Date's LOCAL calendar date. */
function formatDateOnly(d: Date): string {
  return `${String(d.getFullYear())}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

/** `YYYYMMDDTHHMMSSZ` from a Date's UTC instant. */
function formatDateTimeUtc(d: Date): string {
  return (
    `${String(d.getUTCFullYear())}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

/** Advance a Date by exactly one LOCAL calendar day. */
function addOneLocalDay(d: Date): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return next;
}

/** True when two Dates fall on the same LOCAL calendar day. */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Escape a TEXT property value per RFC 5545 §3.3.11 — backslash, comma, and
 * semicolon are backslash-escaped, and any line break becomes a literal
 * `\n` escape sequence. Order matters: backslashes must be escaped first,
 * or the escapes added for the other characters would themselves get
 * re-escaped.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold one logical content line to RFC 5545 §3.1's 75-octet limit.
 * Continuation lines are prefixed with a single space (a CRLF followed by a
 * space is NOT a line break — readers must strip it back out). Splits are
 * chosen on Unicode codepoints (never inside a multi-byte UTF-8 sequence)
 * and measured in UTF-8 bytes, not UTF-16 code units, so the 75-octet limit
 * is exact for non-ASCII text too.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;

  const chunks: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    // Continuation lines reserve 1 octet for the mandatory leading space.
    const limit = chunks.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (chunkBytes + chBytes > limit && chunk.length > 0) {
      chunks.push(chunk);
      chunk = ch;
      chunkBytes = chBytes;
    } else {
      chunk += ch;
      chunkBytes += chBytes;
    }
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks.join(`${CRLF} `);
}

/** Build one folded `NAME:value` content line (NAME may include `;PARAM=x`). */
function contentLine(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

function validate(event: IcsEventInput): void {
  if (!event.uid.trim()) throw new Error('ics: uid is required');
  if (/[\r\n]/.test(event.uid)) throw new Error('ics: uid must not contain a line break');
  if (!event.summary.trim()) throw new Error('ics: summary is required');
  if (!event.allDay && event.end.getTime() < event.start.getTime()) {
    throw new Error('ics: end must not be before start');
  }
}

function buildVEvent(event: IcsEventInput, now: Date): string {
  validate(event);

  const lines: string[] = ['BEGIN:VEVENT'];
  lines.push(contentLine('UID', event.uid));
  lines.push(contentLine('DTSTAMP', formatDateTimeUtc(now)));

  if (event.allDay) {
    const endExclusive = isSameLocalDay(event.start, event.end)
      ? addOneLocalDay(event.start)
      : event.end;
    lines.push(contentLine('DTSTART;VALUE=DATE', formatDateOnly(event.start)));
    lines.push(contentLine('DTEND;VALUE=DATE', formatDateOnly(endExclusive)));
  } else {
    lines.push(contentLine('DTSTART', formatDateTimeUtc(event.start)));
    lines.push(contentLine('DTEND', formatDateTimeUtc(event.end)));
  }

  lines.push(contentLine('SUMMARY', escapeText(event.summary)));
  if (event.description) lines.push(contentLine('DESCRIPTION', escapeText(event.description)));
  if (event.location) lines.push(contentLine('LOCATION', escapeText(event.location)));
  lines.push('END:VEVENT');
  return lines.join(CRLF);
}

/**
 * Build a full `.ics` file (`VCALENDAR`) containing one `VEVENT` per input
 * event. Pure — no DOM/browser dependency — so it's usable from any client
 * context (dashboard checkpoint cards today; a booking-confirmation
 * download later) and is fully unit-testable.
 *
 * `now` drives `DTSTAMP` (the RFC-required "when was this iCalendar object
 * generated" timestamp); it defaults to the current time but is exposed for
 * deterministic tests.
 */
export function buildIcsCalendar(
  events: readonly IcsEventInput[],
  now: Date = new Date(),
): string {
  if (events.length === 0) throw new Error('ics: at least one event is required');
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    contentLine('PRODID', PRODID),
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events.map((e) => buildVEvent(e, now)),
    'END:VCALENDAR',
  ];
  return lines.join(CRLF) + CRLF;
}

/** Convenience wrapper for the common single-event case. */
export function buildIcsEvent(event: IcsEventInput, now: Date = new Date()): string {
  return buildIcsCalendar([event], now);
}

/**
 * A filesystem-safe `.ics` filename derived from an event summary, e.g.
 * `"Pre-Observation: Room 204"` -> `"pre-observation-room-204.ics"`.
 */
export function icsFileName(summary: string): string {
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'event'}.ics`;
}
