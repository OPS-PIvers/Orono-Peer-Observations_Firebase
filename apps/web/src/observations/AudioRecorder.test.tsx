import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level stubs — hoisted so vi.mock factories can reference them.
// ---------------------------------------------------------------------------

const {
  mockFetch,
  mockGetIdToken,
  mockCurrentUser,
  mockRequestTranscription,
  mockGeminiEnabled,
  mockDeleteObservationFile,
} = vi.hoisted(() => {
  const currentUser: { uid: string } | null = { uid: 'user-1' };
  return {
    mockFetch: vi.fn(),
    mockGetIdToken: vi.fn(() => Promise.resolve('test-id-token')),
    mockCurrentUser: currentUser,
    mockRequestTranscription: vi.fn(() => Promise.resolve({ data: { jobId: 'job-123' } })),
    // Mutable flag so individual tests can enable transcription.
    mockGeminiEnabled: { value: false },
    mockDeleteObservationFile: vi.fn(() => Promise.resolve({ data: { deleted: true } })),
  };
});

vi.mock('firebase/auth', () => ({
  getIdToken: () => mockGetIdToken(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_app: unknown, name: string) => {
    if (name === 'deleteObservationFile') return mockDeleteObservationFile;
    return mockRequestTranscription;
  },
}));

vi.mock('@/lib/firebase', () => ({
  auth: {
    get currentUser() {
      return mockCurrentUser;
    },
  },
  db: {},
  storage: {},
  functions: {},
  functionsHttpUrl: (name: string) => `https://functions.test/${name}`,
}));

vi.mock('@/hooks/useGeminiFeatures', () => ({
  useGeminiFeatures: () => ({ audioTranscription: { enabled: mockGeminiEnabled.value } }),
}));

// ---------------------------------------------------------------------------
// Mock useTranscriptionJob so we can control job state in tests.
// ---------------------------------------------------------------------------

const mockJobState: {
  status: string | null;
  error: string | null;
  transcriptPreview: string | null;
  loading: boolean;
} = { status: null, error: null, transcriptPreview: null, loading: false };

vi.mock('@/hooks/useTranscriptionJob', () => ({
  useTranscriptionJob: () => mockJobState,
}));

// Replace global fetch with our mock.
vi.stubGlobal('fetch', mockFetch);

// Stub MediaRecorder so we can control its lifecycle in tests.
const onDataAvailableHandlers: ((e: { data: Blob }) => void)[] = [];
const onStopHandlers: (() => void)[] = [];

class FakeMediaRecorder {
  static isTypeSupported = () => true;
  readonly mimeType = 'audio/webm';
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    onDataAvailableHandlers.push((e) => {
      this.ondataavailable?.(e);
    });
    onStopHandlers.push(() => {
      this.onstop?.();
    });
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    // Emit one data chunk, then fire onstop.
    const chunk = new Blob(['audio-data'], { type: 'audio/webm' });
    this.ondataavailable?.({ data: chunk });
    this.onstop?.();
  }
}

vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

// Stub getUserMedia so startRecording doesn't fail.
const mockGetUserMedia = vi.fn().mockResolvedValue({
  getTracks: () => [{ stop: vi.fn() }],
});

Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: mockGetUserMedia },
});

// Stub navigator.clipboard.writeText so clipboard tests don't throw in jsdom.
// Use the window global so both the module-level assignment and vitest's
// worker environment point at the same object.
const mockClipboardWriteText = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(window.navigator, 'clipboard', {
  configurable: true,
  writable: true,
  value: { writeText: mockClipboardWriteText },
});

// Stub URL.createObjectURL / revokeObjectURL so DownloadRecordingLink can
// build its href without a real browser.
vi.stubGlobal('URL', {
  ...URL,
  createObjectURL: vi.fn(() => 'blob:test-object-url'),
  revokeObjectURL: vi.fn(),
});

// ---------------------------------------------------------------------------
// Import component under test AFTER all mocks are registered.
// ---------------------------------------------------------------------------

import { AudioRecorder } from './AudioRecorder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseProps = {
  observationId: 'obs-42',
  audioFileIds: [] as string[],
  transcripts: {} as Record<string, string>,
  readOnly: false,
};

/** Trigger a full record -> stop cycle so the component enters uploading state. */
async function recordAndStop(user: ReturnType<typeof userEvent.setup>) {
  const recordBtn = screen.getByRole('button', { name: /record/i });
  await user.click(recordBtn);
  // After clicking Record the button changes to Stop.
  const stopBtn = await screen.findByRole('button', { name: /stop/i });
  await user.click(stopBtn);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Stub window.confirm — default to true (user confirms).
const mockConfirm = vi.fn(() => true);
vi.stubGlobal('confirm', mockConfirm);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserMedia.mockResolvedValue({
    getTracks: () => [{ stop: vi.fn() }],
  });
  // Reset job state to the no-job default.
  mockJobState.status = null;
  mockJobState.error = null;
  mockJobState.transcriptPreview = null;
  mockJobState.loading = false;
  mockRequestTranscription.mockResolvedValue({ data: { jobId: 'job-123' } });
  mockDeleteObservationFile.mockResolvedValue({ data: { deleted: true } });
  mockGeminiEnabled.value = false;
  mockConfirm.mockReturnValue(true);
  mockClipboardWriteText.mockResolvedValue(undefined);
});

describe('AudioRecorder — upload failure recovery', () => {
  it('shows Retry upload and Download recording buttons after a failed upload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: () => Promise.resolve('server overload'),
    });

    const user = userEvent.setup();
    render(<AudioRecorder {...baseProps} />);

    await recordAndStop(user);

    expect(await screen.findByRole('button', { name: /retry upload/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download recording/i })).toBeInTheDocument();
  });

  it('Retry upload re-posts the same blob and clears the error on success', async () => {
    // First call fails, second call succeeds.
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ audioFileId: 'drive-file-99' }),
      });

    const onUploaded = vi.fn();
    const user = userEvent.setup();
    render(<AudioRecorder {...baseProps} onUploaded={onUploaded} />);

    await recordAndStop(user);
    const retryBtn = await screen.findByRole('button', { name: /retry upload/i });
    await user.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /retry upload/i })).not.toBeInTheDocument();
    });

    expect(onUploaded).toHaveBeenCalledWith('drive-file-99');
    // Both fetch calls should have been made.
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // The second POST body should be the same blob type as the first.
    const secondCall = mockFetch.mock.calls[1];
    expect(secondCall).toBeDefined();
    const secondBody = secondCall?.[1]?.body;
    expect(secondBody).toBeInstanceOf(Blob);
  });

  it('download link has the blob object URL as href', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: () => Promise.resolve(''),
    });

    const user = userEvent.setup();
    render(<AudioRecorder {...baseProps} />);

    await recordAndStop(user);

    const downloadLink = await screen.findByRole('link', { name: /download recording/i });
    expect(downloadLink).toHaveAttribute('href', 'blob:test-object-url');
    expect(downloadLink).toHaveAttribute('download');
  });

  it('starting a new recording clears the failed-upload UI', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ audioFileId: 'drive-file-100' }),
      });

    const user = userEvent.setup();
    render(<AudioRecorder {...baseProps} />);

    // First record -> upload fails.
    await recordAndStop(user);
    expect(await screen.findByRole('button', { name: /retry upload/i })).toBeInTheDocument();

    // Start a new recording -- this should clear the error and the recovery UI.
    await user.click(screen.getByRole('button', { name: /record/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /retry upload/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /download recording/i })).not.toBeInTheDocument();
    });
  });
});

describe('AudioRecorder — beforeunload guard', () => {
  it('registers a beforeunload handler while recording and removes it when idle', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    // Resolve fetch so the upload succeeds and we reach idle.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ audioFileId: 'drive-file-1' }),
    });

    const user = userEvent.setup();
    render(<AudioRecorder {...baseProps} />);

    // Click Record -- beforeunload should be registered.
    await user.click(screen.getByRole('button', { name: /record/i }));

    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    // Stop recording -- upload succeeds, phase returns to idle.
    const stopBtn = await screen.findByRole('button', { name: /stop/i });
    await user.click(stopBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /record/i })).toBeInTheDocument();
    });

    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });
});

describe('AudioRecorder — audio size validation', () => {
  it('passes MAX_AUDIO_UPLOAD_BYTES to size-check logic', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ audioFileId: 'drive-file-ok' }),
    });

    const user = userEvent.setup();
    render(<AudioRecorder {...baseProps} />);

    await recordAndStop(user);

    // Small blob should pass pre-check and reach fetch
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});

describe('AudioRecorder — transcription job status', () => {
  const propsWithFile = {
    ...baseProps,
    audioFileIds: ['file-1'],
    transcripts: {} as Record<string, string>,
  };

  it('shows Pending state when job status is Pending', () => {
    mockJobState.status = 'Pending';
    render(<AudioRecorder {...propsWithFile} />);
    expect(screen.getByText(/pending\.\.\./i)).toBeInTheDocument();
  });

  it('shows Transcribing spinner when job status is Running', () => {
    mockJobState.status = 'Running';
    render(<AudioRecorder {...propsWithFile} />);
    // The status label says "transcribing...".
    expect(screen.getByText(/transcribing\.\.\./i)).toBeInTheDocument();
  });

  it('shows Failed state with error message when job fails', () => {
    mockJobState.status = 'Failed';
    mockJobState.error = 'Gemini quota exceeded';
    render(<AudioRecorder {...propsWithFile} />);
    expect(screen.getByText(/transcription failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Gemini quota exceeded/i)).toBeInTheDocument();
  });

  it('shows Retry button (enabled) on Failed state when transcription is enabled', () => {
    mockGeminiEnabled.value = true;
    mockJobState.status = 'Failed';
    mockJobState.error = 'Worker error';
    render(<AudioRecorder {...propsWithFile} />);
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).not.toBeDisabled();
  });

  it('Retry button calls requestTranscription with the correct arguments', async () => {
    mockGeminiEnabled.value = true;
    mockJobState.status = 'Failed';
    mockJobState.error = 'Worker error';

    const user = userEvent.setup();
    render(<AudioRecorder {...propsWithFile} />);

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    await user.click(retryBtn);

    expect(mockRequestTranscription).toHaveBeenCalledWith({
      observationId: 'obs-42',
      audioFileId: 'file-1',
    });
  });

  it('Transcribe button is disabled while job is in-progress', () => {
    mockGeminiEnabled.value = true;
    mockJobState.status = 'Running';
    render(<AudioRecorder {...propsWithFile} />);
    const btn = screen.getByRole('button', { name: /transcribing\.\.\./i });
    expect(btn).toBeDisabled();
  });

  it('transcript-ready label renders when transcript is present', () => {
    const propsWithTranscript = {
      ...propsWithFile,
      transcripts: { 'file-1': 'Hello world' },
    };
    render(<AudioRecorder {...propsWithTranscript} />);
    expect(screen.getByText(/transcript ready/i)).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('callable error shows inline without a job doc', async () => {
    mockGeminiEnabled.value = true;
    mockJobState.status = null;
    mockRequestTranscription.mockRejectedValueOnce(new Error('Network error'));

    const user = userEvent.setup();
    render(<AudioRecorder {...propsWithFile} />);

    // Click Transcribe to trigger the callable.
    const transcribeBtn = screen.getByRole('button', { name: /transcribe/i });
    await user.click(transcribeBtn);

    // The callable-level error should be shown inline.
    expect(await screen.findByText(/Network error/i)).toBeInTheDocument();
  });
});

describe('AudioRecorder — transcript insert and copy', () => {
  const propsWithTranscript = {
    ...baseProps,
    audioFileIds: ['file-1'],
    transcripts: { 'file-1': 'Hello teacher\nGreat lesson' } as Record<string, string>,
  };

  it('renders Insert into script button when onInsertTranscript is provided and not readOnly', () => {
    const onInsert = vi.fn();
    render(<AudioRecorder {...propsWithTranscript} onInsertTranscript={onInsert} />);
    expect(
      screen.getByRole('button', { name: /insert transcript.*into script/i }),
    ).toBeInTheDocument();
  });

  it('does not render Insert into script button when readOnly', () => {
    const onInsert = vi.fn();
    render(<AudioRecorder {...propsWithTranscript} readOnly onInsertTranscript={onInsert} />);
    expect(
      screen.queryByRole('button', { name: /insert transcript.*into script/i }),
    ).not.toBeInTheDocument();
  });

  it('does not render Insert into script button when onInsertTranscript is not provided', () => {
    render(<AudioRecorder {...propsWithTranscript} />);
    expect(
      screen.queryByRole('button', { name: /insert transcript.*into script/i }),
    ).not.toBeInTheDocument();
  });

  it('calls onInsertTranscript with the full transcript text when Insert is clicked', async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();
    render(<AudioRecorder {...propsWithTranscript} onInsertTranscript={onInsert} />);

    const insertBtn = screen.getByRole('button', { name: /insert transcript.*into script/i });
    await user.click(insertBtn);

    expect(onInsert).toHaveBeenCalledOnce();
    expect(onInsert).toHaveBeenCalledWith('Hello teacher\nGreat lesson');
  });

  it('renders Copy button when transcript is present and not readOnly', () => {
    render(<AudioRecorder {...propsWithTranscript} />);
    expect(
      screen.getByRole('button', { name: /copy transcript.*recording 1/i }),
    ).toBeInTheDocument();
  });

  it('does not render Copy button when readOnly', () => {
    render(<AudioRecorder {...propsWithTranscript} readOnly />);
    expect(
      screen.queryByRole('button', { name: /copy transcript.*recording 1/i }),
    ).not.toBeInTheDocument();
  });

  it('Copy button shows Copied feedback after clicking', async () => {
    const user = userEvent.setup();
    render(<AudioRecorder {...propsWithTranscript} />);

    const copyBtn = screen.getByRole('button', { name: /copy transcript.*recording 1/i });
    // Button should initially show "Copy"
    expect(copyBtn).toHaveTextContent(/^copy$/i);

    await user.click(copyBtn);

    // After clicking, the button should show "Copied" feedback if clipboard
    // write resolved. The component's catch silently ignores failures, so
    // either state is valid — we just confirm it doesn't crash and stays
    // mounted.
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /copy transcript.*recording 1/i });
      // jsdom's clipboard resolves, so expect "Copied" feedback
      expect(btn).toHaveTextContent(/copied/i);
    });
  });
});

describe('AudioRecorder — audio deletion', () => {
  const propsWithFile = {
    ...baseProps,
    audioFileIds: ['file-1'],
    transcripts: {} as Record<string, string>,
  };

  it('renders a remove button for each recording when not readOnly', () => {
    render(<AudioRecorder {...propsWithFile} />);
    expect(screen.getByRole('button', { name: /remove recording 1/i })).toBeInTheDocument();
  });

  it('does not render a remove button when readOnly', () => {
    render(<AudioRecorder {...propsWithFile} readOnly />);
    expect(screen.queryByRole('button', { name: /remove recording/i })).not.toBeInTheDocument();
  });

  it('calls deleteObservationFile callable with correct args after confirm', async () => {
    mockConfirm.mockReturnValue(true);
    const user = userEvent.setup();
    render(<AudioRecorder {...propsWithFile} />);

    await user.click(screen.getByRole('button', { name: /remove recording 1/i }));

    await waitFor(() => {
      expect(mockDeleteObservationFile).toHaveBeenCalledWith({
        observationId: 'obs-42',
        kind: 'audio',
        driveFileId: 'file-1',
      });
    });
  });

  it('does not call deleteObservationFile when user cancels confirmation', async () => {
    mockConfirm.mockReturnValue(false);
    const user = userEvent.setup();
    render(<AudioRecorder {...propsWithFile} />);

    await user.click(screen.getByRole('button', { name: /remove recording 1/i }));

    // Callable should never have been invoked.
    expect(mockDeleteObservationFile).not.toHaveBeenCalled();
  });

  it('shows an error message when deletion fails', async () => {
    mockConfirm.mockReturnValue(true);
    mockDeleteObservationFile.mockRejectedValueOnce(new Error('Delete failed'));

    const user = userEvent.setup();
    render(<AudioRecorder {...propsWithFile} />);

    await user.click(screen.getByRole('button', { name: /remove recording 1/i }));

    expect(await screen.findByText(/Delete failed/i)).toBeInTheDocument();
  });

  it('disables the remove button while deletion is in-flight', async () => {
    mockConfirm.mockReturnValue(true);
    // Make the callable hang indefinitely so we can inspect the in-flight state.
    let resolveDelete!: () => void;
    mockDeleteObservationFile.mockReturnValueOnce(
      new Promise<{ data: { deleted: boolean } }>((resolve) => {
        resolveDelete = () => resolve({ data: { deleted: true } });
      }),
    );

    const user = userEvent.setup();
    render(<AudioRecorder {...propsWithFile} />);

    const removeBtn = screen.getByRole('button', { name: /remove recording 1/i });
    await user.click(removeBtn);

    // The button should be disabled while the call is in-flight.
    expect(screen.getByRole('button', { name: /remove recording 1/i })).toBeDisabled();

    // Resolve the promise so the component can clean up.
    resolveDelete();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /remove recording 1/i })).not.toBeDisabled();
    });
  });
});
