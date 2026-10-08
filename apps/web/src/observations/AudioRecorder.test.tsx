import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AudioRecordingMeta } from '@ops/shared';
import type * as DriveAudioPicker from './driveAudioPicker';
import type * as Recordings from './recordings';

// One mock per callable name so each test can assert which one ran.
const { callables } = vi.hoisted(() => ({
  callables: new Map<string, Mock<(data: unknown) => Promise<unknown>>>(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => {
    const fn = vi.fn<(data: unknown) => Promise<unknown>>(() => Promise.resolve({ data: {} }));
    callables.set(name, fn);
    return fn;
  },
}));
vi.mock('@/lib/firebase', () => ({ auth: {}, functions: {}, functionsHttpUrl: vi.fn() }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { email: 'pe@x.org' } }) }));
vi.mock('@/hooks/useGeminiAccess', () => ({
  useGeminiAccess: () => ({ audioTranscription: false }),
}));
vi.mock('./useTranscriptionJobs', () => ({
  useTranscriptionJobs: () => ({ jobsByAudioFileId: {} }),
}));

// The Drive picker talks to Google; tests drive it through these mocks.
const drive = vi.hoisted(() => ({
  configured: false,
  pickDriveAudio: vi.fn(),
  downloadDriveFile: vi.fn(),
  uploadObservationAudio: vi.fn(),
}));
vi.mock('./driveAudioPicker', async (importOriginal) => ({
  ...(await importOriginal<typeof DriveAudioPicker>()),
  isDriveImportConfigured: () => drive.configured,
  preloadDrivePicker: vi.fn(),
  pickDriveAudio: drive.pickDriveAudio,
  downloadDriveFile: drive.downloadDriveFile,
  measureAudioDuration: () => Promise.resolve(312),
}));
vi.mock('./recordings', async (importOriginal) => ({
  ...(await importOriginal<typeof Recordings>()),
  uploadObservationAudio: drive.uploadObservationAudio,
}));

import { AudioRecorder } from './AudioRecorder';

const WARM_UP: AudioRecordingMeta = {
  recordedAt: new Date(2026, 8, 30, 9, 14),
  durationSec: 245,
  label: 'Warm-up',
};
const RECORDINGS: Record<string, AudioRecordingMeta> = {
  a1: WARM_UP,
  a2: { recordedAt: new Date(2026, 8, 30, 9, 40), durationSec: 61, label: '' },
};

function renderRecorder(props: Partial<Parameters<typeof AudioRecorder>[0]> = {}) {
  return render(
    <AudioRecorder
      observationId="obs1"
      audioFileIds={['a1', 'a2']}
      transcripts={{}}
      recordings={RECORDINGS}
      observedName="Jane Doe"
      {...props}
    />,
  );
}

beforeEach(() => {
  for (const fn of callables.values()) fn.mockClear();
  drive.configured = false;
  drive.pickDriveAudio.mockReset();
  drive.downloadDriveFile.mockReset();
  drive.uploadObservationAudio.mockReset();
});

describe('<AudioRecorder> recordings list', () => {
  it('lists every recording with its name, date and duration', () => {
    renderRecorder();
    expect(screen.getByText('Warm-up')).toBeInTheDocument();
    expect(screen.getByText('Recording 2')).toBeInTheDocument();
    expect(screen.getByText(/4:05/)).toBeInTheDocument();
    expect(screen.getByText(/1:01/)).toBeInTheDocument();
    for (const name of ['Play', 'Download', 'Rename', 'Delete']) {
      expect(screen.getByRole('button', { name: `${name} Warm-up` })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'View in Drive: Warm-up' })).toBeInTheDocument();
  });

  it('renames a recording through renameRecording', async () => {
    renderRecorder();
    await userEvent.click(screen.getByRole('button', { name: 'Rename Recording 2' }));
    const input = screen.getByRole('textbox', { name: 'Name for Recording 2' });
    expect(input).toHaveFocus();
    await userEvent.type(input, 'Closing');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(callables.get('renameRecording')).toHaveBeenCalledWith({
      observationId: 'obs1',
      audioFileId: 'a2',
      label: 'Closing',
    });
  });

  it('deletes only after confirming', async () => {
    renderRecorder();
    await userEvent.click(screen.getByRole('button', { name: 'Delete Warm-up' }));
    expect(callables.get('removeRecording')).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete Warm-up?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete recording' }));
    expect(callables.get('removeRecording')).toHaveBeenCalledWith({
      observationId: 'obs1',
      audioFileId: 'a1',
    });
  });

  it('hides Rename and Delete when read-only', () => {
    renderRecorder({ readOnly: true });
    expect(screen.getByRole('button', { name: 'Download Warm-up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename Warm-up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Warm-up' })).not.toBeInTheDocument();
  });

  it('asks the server once to backfill recordings without metadata', async () => {
    const { rerender } = renderRecorder({ recordings: { a1: WARM_UP } });
    await waitFor(() => {
      expect(callables.get('backfillRecordingMetadata')).toHaveBeenCalledTimes(1);
    });
    expect(callables.get('backfillRecordingMetadata')).toHaveBeenCalledWith({
      observationId: 'obs1',
    });
    // Still missing on the next render: no second request this mount.
    rerender(
      <AudioRecorder
        observationId="obs1"
        audioFileIds={['a1', 'a2']}
        transcripts={{}}
        recordings={{ a1: WARM_UP }}
        observedName="Jane Doe"
      />,
    );
    expect(callables.get('backfillRecordingMetadata')).toHaveBeenCalledTimes(1);
  });

  it('does not backfill when every recording has metadata', () => {
    renderRecorder();
    expect(callables.get('backfillRecordingMetadata')).not.toHaveBeenCalled();
  });
});

describe('<AudioRecorder> upload from Drive', () => {
  it('hides the button when Drive import is not configured', () => {
    renderRecorder();
    expect(screen.queryByRole('button', { name: /Upload from Drive/ })).not.toBeInTheDocument();
  });

  it('hides the button when read-only', () => {
    drive.configured = true;
    renderRecorder({ readOnly: true });
    expect(screen.queryByRole('button', { name: /Upload from Drive/ })).not.toBeInTheDocument();
  });

  it('uploads a picked Voice Memo as audio/mp4 and names it after the file', async () => {
    drive.configured = true;
    drive.pickDriveAudio.mockResolvedValue({
      accessToken: 'tok',
      files: [{ id: 'd1', name: 'Period 3.m4a', mimeType: 'audio/x-m4a', sizeBytes: 1000 }],
    });
    drive.downloadDriveFile.mockResolvedValue(new Blob(['abc'], { type: 'audio/x-m4a' }));
    drive.uploadObservationAudio.mockResolvedValue({ audioFileId: 'new1' });
    const onUploaded = vi.fn();
    renderRecorder({ onUploaded });

    await userEvent.click(screen.getByRole('button', { name: /Upload from Drive/ }));

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith('new1');
    });
    expect(drive.pickDriveAudio).toHaveBeenCalledWith('pe@x.org');
    expect(drive.downloadDriveFile).toHaveBeenCalledWith('d1', 'tok');
    const upload = drive.uploadObservationAudio.mock.calls[0]?.[0] as {
      observationId: string;
      blob: Blob;
      mimeType: string;
      durationSec: number;
    };
    expect(upload.observationId).toBe('obs1');
    expect(upload.mimeType).toBe('audio/mp4');
    expect(upload.blob.type).toBe('audio/mp4');
    expect(upload.durationSec).toBe(312);
    expect(callables.get('renameRecording')).toHaveBeenCalledWith({
      observationId: 'obs1',
      audioFileId: 'new1',
      label: 'Period 3',
    });
  });

  it('skips files that are too large or not audio, and says which', async () => {
    drive.configured = true;
    drive.pickDriveAudio.mockResolvedValue({
      accessToken: 'tok',
      files: [
        { id: 'd1', name: 'Huge.m4a', mimeType: 'audio/x-m4a', sizeBytes: 200 * 1024 * 1024 },
        { id: 'd2', name: 'Notes.caf', mimeType: 'audio/x-caf', sizeBytes: 10 },
      ],
    });
    renderRecorder();

    await userEvent.click(screen.getByRole('button', { name: /Upload from Drive/ }));

    expect(await screen.findByText(/Huge\.m4a: too large/)).toBeInTheDocument();
    expect(screen.getByText(/Notes\.caf: not an audio format/)).toBeInTheDocument();
    expect(drive.downloadDriveFile).not.toHaveBeenCalled();
    expect(drive.uploadObservationAudio).not.toHaveBeenCalled();
  });

  it('does nothing when the picker is cancelled', async () => {
    drive.configured = true;
    drive.pickDriveAudio.mockResolvedValue({ accessToken: 'tok', files: [] });
    renderRecorder();

    await userEvent.click(screen.getByRole('button', { name: /Upload from Drive/ }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Upload from Drive/ })).toBeEnabled();
    });
    expect(drive.uploadObservationAudio).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
