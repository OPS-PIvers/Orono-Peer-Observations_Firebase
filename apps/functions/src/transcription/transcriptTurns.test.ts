import { describe, expect, it } from 'vitest';
import {
  formatTimestamp,
  formatTranscriptTurns,
  parseTimestamp,
  parseTranscriptTurns,
} from './transcriptTurns.js';

describe('parseTimestamp', () => {
  it('reads MM:SS, H:MM:SS and plain seconds', () => {
    expect(parseTimestamp('00:42')).toBe(42);
    expect(parseTimestamp('12:05')).toBe(725);
    expect(parseTimestamp('1:02:03')).toBe(3723);
    expect(parseTimestamp('[03:10]')).toBe(190);
    expect(parseTimestamp(17)).toBe(17);
    expect(parseTimestamp('17')).toBe(17);
  });

  it('returns null for anything else', () => {
    expect(parseTimestamp('soon')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp(-4)).toBeNull();
  });
});

describe('formatTimestamp', () => {
  it('pads minutes and seconds and adds hours only past an hour', () => {
    expect(formatTimestamp(5)).toBe('[00:05]');
    expect(formatTimestamp(725.9)).toBe('[12:05]');
    expect(formatTimestamp(3723)).toBe('[1:02:03]');
  });
});

describe('parseTranscriptTurns', () => {
  it('reads the turns object', () => {
    const raw = JSON.stringify({
      turns: [
        { start: '00:00', speaker: 'Teacher', text: 'Good morning.' },
        { start: '00:04', speaker: 'Students', text: 'Good morning!' },
      ],
    });
    expect(parseTranscriptTurns(raw)).toEqual([
      { startSeconds: 0, speaker: 'Teacher', text: 'Good morning.' },
      { startSeconds: 4, speaker: 'Students', text: 'Good morning!' },
    ]);
  });

  it('accepts a bare array and a fenced code block', () => {
    const raw = '```json\n[{"start":"00:01","speaker":"Teacher","text":"Hi"}]\n```';
    expect(parseTranscriptTurns(raw)).toEqual([
      { startSeconds: 1, speaker: 'Teacher', text: 'Hi' },
    ]);
  });

  it('keeps the finished turns when the reply is cut off', () => {
    const raw =
      '{"turns":[{"start":"00:00","speaker":"Teacher","text":"One."},' +
      '{"start":"00:03","speaker":"Student","text":"Two."},{"start":"00:05","speak';
    expect(parseTranscriptTurns(raw)).toEqual([
      { startSeconds: 0, speaker: 'Teacher', text: 'One.' },
      { startSeconds: 3, speaker: 'Student', text: 'Two.' },
    ]);
  });

  it('drops empty turns and fills a missing speaker', () => {
    const raw = JSON.stringify({
      turns: [
        { start: '00:00', speaker: '', text: '  So,\n  today ' },
        { start: '00:02', speaker: 'Teacher', text: '   ' },
      ],
    });
    expect(parseTranscriptTurns(raw)).toEqual([
      { startSeconds: 0, speaker: 'Unknown', text: 'So, today' },
    ]);
  });

  it('keeps fillers, false starts and [inaudible] word for word', () => {
    const said =
      'Shh, shh. Um, so I- I think we, we should, uh, [inaudible] the the fractions first? Vroom, boom!';
    const raw = JSON.stringify({ turns: [{ start: '00:07', speaker: 'Student', text: said }] });
    expect(formatTranscriptTurns(parseTranscriptTurns(raw) ?? [])).toBe(`[00:07] Student: ${said}`);
  });

  it('keeps the other turns when one turn is broken JSON', () => {
    const raw =
      '{"turns": [{"start": "00:01", "speaker": "Teacher", "text": "Okay."},' +
      ' {"start": "00:04", "speaker": "Student", "text": "I said "no" already"},' +
      ' {"start": "00:09", "speaker": "Teacher", "text": "Thank you."}]}';
    expect(parseTranscriptTurns(raw)).toEqual([
      { startSeconds: 1, speaker: 'Teacher', text: 'Okay.' },
      { startSeconds: 9, speaker: 'Teacher', text: 'Thank you.' },
    ]);
  });

  it('repairs a stray backslash and a raw line break inside a turn', () => {
    const raw =
      '{"turns": [{"start": "00:01", "speaker": "Teacher", "text": "That\\\'s it,\nfolks."},' +
      ' {"start": "00:05", "speaker": "Student", "text": "Okay.\t"}]}';
    expect(parseTranscriptTurns(raw)).toEqual([
      { startSeconds: 1, speaker: 'Teacher', text: "That's it, folks." },
      { startSeconds: 5, speaker: 'Student', text: 'Okay.' },
    ]);
  });

  it('keeps the finished turns when a cut-off reply also has a broken turn', () => {
    const raw =
      '{"turns": [{"start": "00:01", "speaker": "Teacher", "text": "One \\q two."},' +
      ' {"start": "00:03", "speaker": "Student", "text": "Three."},' +
      ' {"start": "00:06", "speaker": "Teacher", "text": "Fo';
    expect(parseTranscriptTurns(raw)).toEqual([
      { startSeconds: 1, speaker: 'Teacher', text: 'One q two.' },
      { startSeconds: 3, speaker: 'Student', text: 'Three.' },
    ]);
  });

  it('returns null when no turn finished', () => {
    expect(
      parseTranscriptTurns('{"turns": [{"start": "00:01", "speaker": "Teacher", "text": "um um'),
    ).toBeNull();
    expect(parseTranscriptTurns('{"turns": []}')).toBeNull();
  });

  it('returns null for plain text', () => {
    expect(parseTranscriptTurns('Good morning everyone.')).toBeNull();
  });
});

describe('formatTranscriptTurns', () => {
  it('writes one line per speaker turn', () => {
    expect(
      formatTranscriptTurns([
        { startSeconds: 42, speaker: 'Teacher', text: 'Take out your notebooks.' },
        { startSeconds: 51, speaker: 'Student', text: 'Is this from yesterday?' },
        { startSeconds: 3725, speaker: 'Teacher', text: 'Yes.' },
      ]),
    ).toBe(
      '[00:42] Teacher: Take out your notebooks.\n' +
        '[00:51] Student: Is this from yesterday?\n' +
        '[1:02:05] Teacher: Yes.',
    );
  });

  it('merges back-to-back turns by the same speaker and keeps the first time', () => {
    expect(
      formatTranscriptTurns([
        { startSeconds: 0, speaker: 'Teacher', text: 'Okay.' },
        { startSeconds: 3, speaker: 'Teacher', text: 'Page twelve.' },
        { startSeconds: 9, speaker: 'Student', text: 'Got it.' },
      ]),
    ).toBe('[00:00] Teacher: Okay. Page twelve.\n[00:09] Student: Got it.');
  });

  it('keeps role labels and never names the teacher', () => {
    expect(
      formatTranscriptTurns([
        { startSeconds: 0, speaker: 'Teacher', text: 'Shh.' },
        { startSeconds: 2, speaker: 'Student', text: 'Sorry.' },
        { startSeconds: 4, speaker: 'Other Adult', text: 'Okay.' },
      ]),
    ).toBe('[00:00] Teacher: Shh.\n[00:02] Student: Sorry.\n[00:04] Other Adult: Okay.');
  });

  it('leaves the timestamp off when it could not be read', () => {
    expect(formatTranscriptTurns([{ startSeconds: null, speaker: 'Teacher', text: 'Hi.' }])).toBe(
      'Teacher: Hi.',
    );
  });
});
