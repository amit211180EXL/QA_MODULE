'use client';

import { useState, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Topbar } from '@/components/layout/topbar';
import { Button } from '@/components/ui/button';
import { Upload, FileText, CheckCircle, AlertTriangle, X } from 'lucide-react';
import { conversationsApi } from '@/lib/api';

// ─── Supported channels ───────────────────────────────────────────────────────

const CHANNELS = ['chat', 'email', 'call', 'social', 'other'] as const;
type Channel = (typeof CHANNELS)[number];

// ─── CSV parser ───────────────────────────────────────────────────────────────
// Expected headers: externalId, agentName, agentId, customerRef, content, receivedAt
// (all optional except content)

interface ParsedRow {
  externalId?: string;
  agentName?: string;
  agentId?: string;
  customerRef?: string;
  content: string;
  receivedAt?: string;
}

function parseCSV(text: string): { rows: ParsedRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return { rows: [], errors: ['File appears to be empty or has no data rows.'] };
  }

  const headers = lines[0]
    .split(',')
    .map((h) =>
      h
        .trim()
        .replace(/^"|"$/g, '')
        .toLowerCase(),
    );

  const contentIdx = headers.indexOf('content');
  if (contentIdx === -1) {
    return {
      rows: [],
      errors: ['CSV must have a "content" column. Found: ' + headers.join(', ')],
    };
  }

  const rows: ParsedRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    // Simple CSV split — handles quoted fields containing commas
    const cols: string[] = [];
    let current = '';
    let inQuote = false;
    for (let c = 0; c < raw.length; c++) {
      const ch = raw[c];
      if (ch === '"') {
        if (inQuote && raw[c + 1] === '"') {
          current += '"';
          c++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === ',' && !inQuote) {
        cols.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    cols.push(current);

    const get = (name: string) => {
      const idx = headers.indexOf(name);
      return idx >= 0 ? cols[idx]?.trim() || undefined : undefined;
    };

    const content = get('content');
    if (!content) {
      errors.push(`Row ${i}: missing content — skipped`);
      continue;
    }

    rows.push({
      externalId: get('externalid') ?? get('external_id') ?? get('externalid'),
      agentName: get('agentname') ?? get('agent_name') ?? get('agentname'),
      agentId: get('agentid') ?? get('agent_id') ?? get('agentid'),
      customerRef: get('customerref') ?? get('customer_ref') ?? get('customerref'),
      content,
      receivedAt: get('receivedat') ?? get('received_at') ?? get('receivedat'),
    });
  }

  return { rows, errors };
}

// ─── Template download ────────────────────────────────────────────────────────

function downloadTemplate() {
  const csv =
    'externalId,agentName,agentId,customerRef,content,receivedAt\n' +
    'conv-001,Jane Smith,agent-1,cust-abc,"Hello, how can I help you today?",2024-01-15T10:00:00Z\n' +
    'conv-002,John Doe,agent-2,cust-def,"Good morning! I need help with my account.",2024-01-15T11:00:00Z\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'conversations-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Preview table ─────────────────────────────────────────────────────────────

function PreviewTable({ rows }: { rows: ParsedRow[] }) {
  const preview = rows.slice(0, 10);
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-xs">
          <thead className="bg-slate-50">
            <tr>
              {['#', 'External ID', 'Agent', 'Customer', 'Content (preview)', 'Received'].map(
                (h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {preview.map((row, i) => (
              <tr key={i} className="transition-colors hover:bg-slate-50/60">
                <td className="px-3 py-2.5 text-slate-400">{i + 1}</td>
                <td className="px-3 py-2.5 font-mono text-slate-500">{row.externalId ?? '—'}</td>
                <td className="max-w-[120px] truncate px-3 py-2.5 text-slate-700">
                  {row.agentName ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-slate-500">{row.customerRef ?? '—'}</td>
                <td className="max-w-[220px] truncate px-3 py-2.5 text-slate-700">
                  {String(row.content).slice(0, 80)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">
                  {row.receivedAt ? new Date(row.receivedAt).toLocaleDateString() : 'now'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 10 && (
        <p className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-400">
          Showing first 10 of {rows.length} rows
        </p>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type UploadMode = 'csv' | 'json';

export default function UploadPage() {
  const [mode, setMode] = useState<UploadMode>('csv');
  const [channel, setChannel] = useState<Channel>('chat');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: (rows: ParsedRow[]) =>
      conversationsApi.upload({
        channel,
        conversations: rows.map((r) => ({
          externalId: r.externalId,
          agentName: r.agentName,
          agentId: r.agentId,
          customerRef: r.customerRef,
          content: { text: r.content },
          receivedAt: r.receivedAt,
        })),
      }),
  });

  const processFile = useCallback((file: File) => {
    setFileName(file.name);
    setParsedRows([]);
    setParseErrors([]);
    uploadMutation.reset();

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (file.name.endsWith('.json')) {
        try {
          const json = JSON.parse(text) as unknown[];
          if (!Array.isArray(json)) {
            setParseErrors(['JSON must be an array of conversation objects.']);
            return;
          }
          const rows = json.map((item, i) => {
            const obj = item as Record<string, unknown>;
            if (!obj.content && !obj.text) {
              throw new Error(`Item ${i + 1}: missing "content" or "text" field`);
            }
            return {
              externalId: obj.externalId as string | undefined,
              agentName: obj.agentName as string | undefined,
              agentId: obj.agentId as string | undefined,
              customerRef: obj.customerRef as string | undefined,
              content: (obj.content ?? obj.text) as string,
              receivedAt: obj.receivedAt as string | undefined,
            };
          });
          setParsedRows(rows);
        } catch (err) {
          setParseErrors([(err as Error).message]);
        }
      } else {
        const { rows, errors } = parseCSV(text);
        setParsedRows(rows);
        setParseErrors(errors);
      }
    };
    reader.readAsText(file);
  }, []);

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleJsonParse = () => {
    setParseErrors([]);
    setParsedRows([]);
    uploadMutation.reset();
    try {
      const json = JSON.parse(jsonText) as unknown[];
      if (!Array.isArray(json)) {
        setParseErrors(['JSON must be an array of objects.']);
        return;
      }
      const rows = json.map((item, i) => {
        const obj = item as Record<string, unknown>;
        const content = (obj.content ?? obj.text) as string | undefined;
        if (!content) throw new Error(`Item ${i + 1}: missing "content" or "text" field`);
        return {
          externalId: obj.externalId as string | undefined,
          agentName: obj.agentName as string | undefined,
          agentId: obj.agentId as string | undefined,
          customerRef: obj.customerRef as string | undefined,
          content,
          receivedAt: obj.receivedAt as string | undefined,
        };
      });
      setParsedRows(rows);
    } catch (err) {
      setParseErrors([(err as Error).message]);
    }
  };

  const handleUpload = () => {
    if (parsedRows.length === 0) return;
    uploadMutation.mutate(parsedRows, {
      onSuccess: () => {
        setParsedRows([]);
        setFileName('');
        setJsonText('');
        if (fileRef.current) fileRef.current.value = '';
      },
    });
  };

  const clearFile = () => {
    setParsedRows([]);
    setParseErrors([]);
    setFileName('');
    uploadMutation.reset();
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <>
      <Topbar title="Upload Conversations" />
      <div>

        {/* ── Page header card ── */}
        <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
          <div className="flex items-start justify-between gap-4 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-blue-100 p-2.5">
                <Upload className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Upload Conversations</h2>
                <p className="mt-0.5 max-w-lg text-sm text-slate-500">
                  Import conversations from CSV or JSON. Each uploaded conversation is automatically
                  queued for AI evaluation using your active QA form.
                </p>
              </div>
            </div>
          </div>

          {/* ── Mode + Channel controls ── */}
          <div className="flex flex-wrap items-center gap-6 border-t border-slate-100 bg-white px-5 py-3">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Format
              </p>
              <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                {(['csv', 'json'] as UploadMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMode(m);
                      clearFile();
                    }}
                    className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-all ${
                      mode === m
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Channel
              </p>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as Channel)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Two-column layout: upload + sidebar ── */}
        <div className="flex gap-5">
        <div className="min-w-0 flex-1">

        {/* ── Upload area ── */}
        {mode === 'csv' ? (
          <div>
            {!fileName ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                onClick={() => fileRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed py-12 transition-all ${
                  isDragging
                    ? 'border-blue-400 bg-blue-50 shadow-inner'
                    : 'border-slate-200 bg-slate-50/60 hover:border-blue-300 hover:bg-blue-50/30'
                }`}
              >
                <div className={`mb-4 rounded-2xl p-4 transition-colors ${isDragging ? 'bg-blue-100' : 'bg-white shadow-sm border border-slate-100'}`}>
                  <Upload className={`h-8 w-8 transition-colors ${isDragging ? 'text-blue-500' : 'text-slate-300'}`} />
                </div>
                <p className="text-sm font-semibold text-slate-700">
                  Drop your CSV or JSON file here
                </p>
                <p className="mt-1 text-xs text-slate-400">or click to browse</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.json"
                  className="hidden"
                  onChange={handleFileInput}
                />
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-100 p-1.5">
                    <FileText className="h-4 w-4 text-blue-600" />
                  </div>
                  <span className="text-sm font-semibold text-blue-800">{fileName}</span>
                  {parsedRows.length > 0 && (
                    <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                      {parsedRows.length} row{parsedRows.length !== 1 ? 's' : ''} parsed
                    </span>
                  )}
                </div>
                <button
                  onClick={clearFile}
                  className="rounded-lg p-1.5 text-blue-400 transition-colors hover:bg-blue-100 hover:text-blue-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        ) : (
          /* JSON mode */
          <div className="space-y-3">
            <textarea
              rows={10}
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setParsedRows([]);
                setParseErrors([]);
                uploadMutation.reset();
              }}
              placeholder={'[\n  {\n    "externalId": "conv-001",\n    "agentName": "Jane Smith",\n    "content": "Hello, how can I help?",\n    "receivedAt": "2024-01-15T10:00:00Z"\n  }\n]'}
              className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Button variant="secondary" onClick={handleJsonParse} disabled={!jsonText.trim()}>
              Parse JSON
            </Button>
          </div>
        )}

        {/* ── Parse errors ── */}
        {parseErrors.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {parseErrors.map((e, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <p className="text-sm text-red-700">{e}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Preview + upload action ── */}
        {parsedRows.length > 0 && !uploadMutation.isSuccess && (
          <>
            <PreviewTable rows={parsedRows} />
            <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-sm text-slate-600">
                <span className="font-bold text-slate-900">{parsedRows.length}</span> conversation
                {parsedRows.length !== 1 ? 's' : ''} ready · channel{' '}
                <span className="font-semibold capitalize text-blue-600">{channel}</span>
              </p>
              <Button
                isLoading={uploadMutation.isPending}
                onClick={handleUpload}
                disabled={parsedRows.length === 0}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload {parsedRows.length} conversation{parsedRows.length !== 1 ? 's' : ''}
              </Button>
            </div>
          </>
        )}

        {/* ── Upload error ── */}
        {uploadMutation.isError && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <p className="text-sm text-red-700">Upload failed. Please try again.</p>
          </div>
        )}

        {/* ── Success ── */}
        {uploadMutation.isSuccess && (
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white py-14 shadow-sm">
            <div className="mb-4 rounded-2xl bg-emerald-100 p-4">
              <CheckCircle className="h-10 w-10 text-emerald-500" />
            </div>
            <p className="text-lg font-bold text-emerald-800">Upload successful</p>
            <p className="mt-1 text-sm text-emerald-600">
              {(uploadMutation.data as { uploaded?: number })?.uploaded ?? 0} conversation
              {((uploadMutation.data as { uploaded?: number })?.uploaded ?? 0) !== 1 ? 's' : ''}{' '}
              imported and queued for AI evaluation
            </p>
            <button
              onClick={() => uploadMutation.reset()}
              className="mt-5 rounded-xl border border-emerald-200 bg-white px-5 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-50"
            >
              Upload more
            </button>
          </div>
        )}

        </div>{/* end flex-1 */}

        {/* ── Format guidance sidebar ── */}
        <div className="w-72 shrink-0">
          <div className="sticky top-20 overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/60">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-700">
                {mode === 'csv' ? 'CSV Format' : 'JSON Format'}
              </h3>
            </div>
            <div className="px-4 py-4">
              {mode === 'csv' ? (
                <pre className="overflow-x-auto rounded-xl bg-slate-950 p-3 text-[11px] leading-relaxed text-emerald-300">
                  {`externalId,agentName,agentId,\n  customerRef,content,receivedAt\nconv-001,Jane Smith,agent-1,\n  cust-abc,"Hello!",2024-01-15`}
                </pre>
              ) : (
                <pre className="overflow-x-auto rounded-xl bg-slate-950 p-3 text-[11px] leading-relaxed text-emerald-300">
                  {`[\n  {\n    "externalId": "conv-001",\n    "agentName": "Jane Smith",\n    "content": "Hello!",\n    "receivedAt": "2024-01-15"\n  }\n]`}
                </pre>
              )}
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                  <span className="text-xs text-slate-600"><span className="font-semibold">Required:</span> content</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                  <span className="text-xs text-slate-500"><span className="font-medium">Optional:</span> externalId, agentName, agentId, customerRef, receivedAt</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  <span className="text-xs text-slate-500">Max 500 rows per upload</span>
                </div>
              </div>
              {mode === 'csv' && (
                <button
                  onClick={downloadTemplate}
                  className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Download CSV Template
                </button>
              )}
            </div>
          </div>
        </div>
        </div>{/* end two-column flex */}
      </div>
    </>
  );
}
