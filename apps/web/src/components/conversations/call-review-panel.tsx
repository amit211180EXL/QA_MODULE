'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AudioWaveform, Headphones, PlayCircle } from 'lucide-react';

type TranscriptTurn = {
  role: string;
  text: string;
  timestampSeconds: number | null;
  timestampLabel: string | null;
};

type ParsedTimestamp = {
  seconds: number;
  label: string;
};

const AUDIO_KEY_CANDIDATES = [
  'recordingUrl',
  'recordingURL',
  'recording_url',
  'audioUrl',
  'audioURL',
  'audio_url',
  'mediaUrl',
  'mediaURL',
  'media_url',
  'callRecordingUrl',
  'callRecordingURL',
  'call_recording_url',
  'recording',
  'audio',
  'media',
] as const;

const TRANSCRIPT_COLLECTION_KEYS = [
  'messages',
  'turns',
  'transcript',
  'segments',
  'utterances',
] as const;

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';

  const rounded = Math.floor(value);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function looksLikeAudioUrl(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;

  return (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('blob:') ||
    normalized.startsWith('data:audio/') ||
    /\.(mp3|wav|m4a|ogg|oga|opus|aac|flac|webm)(\?.*)?$/i.test(normalized)
  );
}

function parseTimestamp(value: unknown): ParsedTimestamp | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const seconds = value > 10_000 ? value / 1000 : value;
    return { seconds, label: formatDuration(seconds) };
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    const seconds = numeric > 10_000 ? numeric / 1000 : numeric;
    return { seconds, label: formatDuration(seconds) };
  }

  const timeMatch = trimmed.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
  if (timeMatch) {
    const [, first, second, third, fraction] = timeMatch;
    const hours = first ? Number(first) : 0;
    const minutes = Number(second);
    const seconds = Number(third);
    const millis = fraction ? Number(`0.${fraction}`) : 0;
    return {
      seconds: hours * 3600 + minutes * 60 + seconds + millis,
      label: trimmed,
    };
  }

  if (/[tT]|Z$/.test(trimmed) || /^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const epochMs = Date.parse(trimmed);
    if (!Number.isNaN(epochMs)) {
      return {
        seconds: epochMs / 1000,
        label: new Date(epochMs).toLocaleTimeString(),
      };
    }
  }

  return null;
}

function extractRecordingUrl(...sources: unknown[]): string | null {
  const visited = new Set<unknown>();

  const visit = (input: unknown): string | null => {
    if (input == null) return null;

    if (typeof input === 'string') {
      return looksLikeAudioUrl(input) ? input : null;
    }

    if (typeof input !== 'object') return null;
    if (visited.has(input)) return null;
    visited.add(input);

    if (Array.isArray(input)) {
      for (const item of input) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }

    const record = input as Record<string, unknown>;

    for (const key of AUDIO_KEY_CANDIDATES) {
      const value = record[key];
      if (typeof value === 'string' && looksLikeAudioUrl(value)) {
        return value;
      }

      if (typeof value === 'object' && value !== null) {
        const nestedUrl = (value as Record<string, unknown>).url;
        if (typeof nestedUrl === 'string' && looksLikeAudioUrl(nestedUrl)) {
          return nestedUrl;
        }
      }
    }

    if (typeof record.url === 'string' && looksLikeAudioUrl(record.url)) {
      const mimeType = record.mimeType;
      if (typeof mimeType !== 'string' || mimeType.startsWith('audio/')) {
        return record.url;
      }
    }

    for (const value of Object.values(record)) {
      const found = visit(value);
      if (found) return found;
    }

    return null;
  };

  for (const source of sources) {
    const found = visit(source);
    if (found) return found;
  }

  return null;
}

function extractTranscriptTurns(content: unknown): TranscriptTurn[] {
  const asRecord =
    typeof content === 'object' && content !== null ? (content as Record<string, unknown>) : null;

  let candidates: unknown[] | null = null;
  if (Array.isArray(content)) {
    candidates = content;
  } else if (asRecord) {
    for (const key of TRANSCRIPT_COLLECTION_KEYS) {
      if (Array.isArray(asRecord[key])) {
        candidates = asRecord[key] as unknown[];
        break;
      }
    }
  }

  if (!candidates && asRecord && typeof asRecord.transcript === 'string' && asRecord.transcript.trim()) {
    return [
      {
        role: 'transcript',
        text: asRecord.transcript.trim(),
        timestampSeconds: null,
        timestampLabel: null,
      },
    ];
  }

  if (!candidates) return [];

  const turns = candidates
    .map((item): TranscriptTurn | null => {
      if (typeof item === 'string') {
        const text = item.trim();
        return text
          ? { role: 'message', text, timestampSeconds: null, timestampLabel: null }
          : null;
      }

      if (typeof item !== 'object' || item === null) return null;

      const record = item as Record<string, unknown>;
      const roleValue =
        record.role ??
        record.speaker ??
        record.sender ??
        record.author ??
        record.participant ??
        record.channel;
      const textValue =
        record.text ??
        record.message ??
        record.content ??
        record.body ??
        record.utterance ??
        record.transcript;
      const timestampValue =
        record.timestamp ??
        record.ts ??
        record.startTime ??
        record.start ??
        record.offset ??
        record.time ??
        record.startMs ??
        record.offsetMs;

      const text = typeof textValue === 'string' ? textValue.trim() : '';
      if (!text) return null;

      const parsedTimestamp = parseTimestamp(timestampValue);

      return {
        role: typeof roleValue === 'string' && roleValue.trim() ? roleValue.trim() : 'message',
        text,
        timestampSeconds: parsedTimestamp?.seconds ?? null,
        timestampLabel: parsedTimestamp?.label ?? null,
      };
    })
    .filter((item): item is TranscriptTurn => Boolean(item));

  const absoluteTurns = turns.filter(
    (turn) => turn.timestampSeconds !== null && turn.timestampSeconds > 1_000_000,
  );
  if (absoluteTurns.length > 1) {
    const baseline = absoluteTurns[0].timestampSeconds ?? 0;
    return turns.map((turn) =>
      turn.timestampSeconds !== null && turn.timestampSeconds > 1_000_000
        ? { ...turn, timestampSeconds: Math.max(turn.timestampSeconds - baseline, 0) }
        : turn,
    );
  }

  return turns;
}

function buildPeaks(samples: Float32Array, barCount: number): number[] {
  const blockSize = Math.max(1, Math.floor(samples.length / barCount));
  const peaks: number[] = [];

  for (let index = 0; index < barCount; index++) {
    let peak = 0;
    const start = index * blockSize;
    const end = Math.min(start + blockSize, samples.length);

    for (let sampleIndex = start; sampleIndex < end; sampleIndex++) {
      peak = Math.max(peak, Math.abs(samples[sampleIndex] ?? 0));
    }

    peaks.push(peak);
  }

  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map((value) => Math.max(value / maxPeak, 0.08));
}

export function CallReviewPanel({
  channel,
  content,
  metadata,
  title,
  transcriptHeightClass = 'max-h-[520px]',
}: {
  channel: string;
  content: unknown;
  metadata?: unknown;
  title?: string;
  transcriptHeightClass?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [waveformError, setWaveformError] = useState<string | null>(null);

  const turns = useMemo(() => extractTranscriptTurns(content), [content]);
  const recordingUrl = useMemo(() => extractRecordingUrl(metadata, content), [content, metadata]);
  const isCall = channel.toUpperCase() === 'CALL';

  const activeTurnIndex = useMemo(() => {
    let currentIndex = -1;
    for (let index = 0; index < turns.length; index++) {
      const timestampSeconds = turns[index].timestampSeconds;
      if (timestampSeconds === null) continue;
      if (currentTime >= timestampSeconds) currentIndex = index;
      if (timestampSeconds > currentTime) break;
    }
    return currentIndex;
  }, [currentTime, turns]);

  useEffect(() => {
    if (!recordingUrl || !isCall) {
      setPeaks(null);
      setWaveformError(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setWaveformError(null);
        setPeaks(null);

        const AudioContextCtor =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

        if (!AudioContextCtor) {
          throw new Error('AudioContext is not available in this browser.');
        }

        const response = await fetch(recordingUrl);
        if (!response.ok) {
          throw new Error(`Failed to load audio (${response.status}).`);
        }

        const buffer = await response.arrayBuffer();
        const context = new AudioContextCtor();

        try {
          const decoded = await context.decodeAudioData(buffer.slice(0));
          const primaryChannel = decoded.getChannelData(0);

          if (!cancelled) {
            setPeaks(buildPeaks(primaryChannel, 96));
          }
        } finally {
          await context.close();
        }
      } catch {
        if (!cancelled) {
          setWaveformError('Waveform preview could not be generated for this recording.');
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [isCall, recordingUrl]);

  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

  const seekTo = (nextTime: number) => {
    if (!audioRef.current || !Number.isFinite(nextTime)) return;
    audioRef.current.currentTime = Math.max(nextTime, 0);
    setCurrentTime(Math.max(nextTime, 0));
  };

  const heading = title ?? (isCall ? 'Call Playback & Transcript' : 'Conversation Output');

  const CHANNEL_COLORS: Record<string, string> = {
    CALL: 'bg-violet-100 text-violet-700',
    CHAT: 'bg-blue-100 text-blue-700',
    EMAIL: 'bg-amber-100 text-amber-700',
  };
  const channelColor = CHANNEL_COLORS[channel.toUpperCase()] ?? 'bg-slate-100 text-slate-600';

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.06)]">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-7 w-7 items-center justify-center rounded-lg shadow-sm ${isCall ? 'bg-violet-500' : 'bg-blue-500'}`}>
            {isCall ? (
              <Headphones className="h-3.5 w-3.5 text-white" />
            ) : (
              <AudioWaveform className="h-3.5 w-3.5 text-white" />
            )}
          </div>
          <h2 className="text-sm font-semibold text-slate-800">{heading}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${channelColor}`}>
            {channel}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
            {turns.length} turn{turns.length === 1 ? '' : 's'}
          </span>
          {duration > 0 && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
              {formatDuration(duration)}
            </span>
          )}
        </div>
      </div>

      {/* ── Audio player ── */}
      {isCall && recordingUrl && (
        <div className="border-b border-slate-100 bg-slate-950 px-5 py-5">
          {/* time display */}
          <div className="mb-3 flex items-end justify-between gap-3">
            <div className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5 text-violet-400" />
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                Call Recording
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs font-mono text-slate-400">
              <span className="text-slate-200">{formatDuration(currentTime)}</span>
              <span>/</span>
              <span>{duration > 0 ? formatDuration(duration) : '--:--'}</span>
            </div>
          </div>

          {/* native <audio> element */}
          <audio
            ref={audioRef}
            controls
            preload="metadata"
            src={recordingUrl}
            className="w-full [&::-webkit-media-controls-panel]:bg-slate-800 [color-scheme:dark]"
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
          />

          {/* waveform scrubber */}
          <button
            type="button"
            aria-label="Seek audio position"
            className="mt-3 flex h-14 w-full cursor-pointer items-end gap-[2px] overflow-hidden rounded-xl bg-slate-900 px-3 py-2 ring-1 ring-white/[0.05] transition hover:ring-violet-500/40"
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const ratio = Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1);
              seekTo(ratio * duration);
            }}
          >
            {(peaks ?? Array.from({ length: 96 }, (_, i) => 0.15 + ((i * 17) % 9) / 20)).map(
              (peak, index, collection) => {
                const ratio = collection.length > 1 ? index / (collection.length - 1) : 0;
                const active = ratio <= progress;
                return (
                  <span
                    key={index}
                    className="w-full rounded-full transition-all duration-75"
                    style={{
                      height: `${Math.max(10, peak * 48)}px`,
                      background: active
                        ? `linear-gradient(to top, #7c3aed, #a78bfa)`
                        : 'rgba(148,163,184,0.2)',
                    }}
                  />
                );
              },
            )}
          </button>

          {waveformError && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {waveformError}
            </p>
          )}
        </div>
      )}

      {/* ── No recording warning ── */}
      {isCall && !recordingUrl && (
        <div className="flex items-start gap-2.5 border-b border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p>No call recording URL was found. Only the transcript can be shown.</p>
        </div>
      )}

      {/* ── Transcript ── */}
      {turns.length > 0 ? (
        <div className={`${transcriptHeightClass} space-y-2.5 overflow-y-auto p-4`}>
          {turns.map((turn, index) => {
            const role = turn.role.toLowerCase();
            const isAgent = role.includes('agent') || role.includes('assistant');
            const isCustomer = role.includes('customer') || role.includes('user');
            const isActive = index === activeTurnIndex;

            const bubbleStyle = isAgent
              ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-blue-200'
              : isCustomer
                ? 'bg-white border border-slate-200 text-slate-800 shadow-slate-100'
                : 'bg-slate-100 text-slate-700 shadow-slate-100';

            const align = isCustomer ? 'justify-start' : isAgent ? 'justify-end' : 'justify-center';

            return (
              <div
                key={`${turn.role}-${index}-${turn.timestampLabel ?? 'na'}`}
                className={`flex items-end gap-2 ${align}`}
              >
                {isCustomer && (
                  <div className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">
                    C
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm transition-all duration-200 ${bubbleStyle} ${
                    isActive ? 'ring-2 ring-violet-400 ring-offset-1' : ''
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-4">
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${isAgent ? 'text-white/60' : 'text-slate-400'}`}>
                      {turn.role}
                    </p>
                    {turn.timestampLabel && (
                      <button
                        type="button"
                        className={`rounded px-1 text-[10px] font-semibold tabular-nums transition-all hover:bg-black/10 ${isAgent ? 'text-white/60 hover:text-white/90' : 'text-slate-400 hover:text-slate-700'}`}
                        onClick={() => turn.timestampSeconds !== null && seekTo(turn.timestampSeconds)}
                      >
                        {turn.timestampLabel}
                      </button>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap break-words">{turn.text}</p>
                </div>
                {isAgent && (
                  <div className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">
                    A
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <details className="p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-900">
            Unable to render transcript — show raw JSON
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-300">
            {JSON.stringify(content, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}