'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { formsApi, type FormSectionDef, type FormQuestionDef } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  Save,
  CheckCircle2,
  AlertTriangle,
  GripVertical,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID();
}

// ─── Section modal ────────────────────────────────────────────────────────────

const sectionSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  weight: z.coerce.number().min(0.1, 'Weight must be > 0').max(100),
});
type SectionValues = z.infer<typeof sectionSchema>;

function SectionModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: FormSectionDef;
  onSave: (values: SectionValues) => void;
  onClose: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SectionValues>({
    resolver: zodResolver(sectionSchema),
    defaultValues: { title: initial?.title ?? '', weight: initial?.weight ?? 1 },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          {initial ? 'Edit section' : 'New section'}
        </h3>
        <form onSubmit={handleSubmit(onSave)} className="space-y-4">
          <Input
            label="Title"
            placeholder="e.g. Communication Skills"
            error={errors.title?.message}
            {...register('title')}
          />
          <Input
            label="Weight"
            type="number"
            step="0.1"
            placeholder="1"
            hint="Relative weight used for scoring"
            error={errors.weight?.message}
            {...register('weight')}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{initial ? 'Save' : 'Add'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Question modal ───────────────────────────────────────────────────────────

const questionSchema = z.object({
  key: z
    .string()
    .min(1, 'Key is required')
    .regex(/^[a-z0-9_]+$/, 'Only lowercase letters, numbers and underscores'),
  label: z.string().min(2, 'Label is required'),
  type: z.enum(['rating', 'boolean', 'text', 'select']),
  required: z.boolean(),
  weight: z.coerce.number().min(0.1).max(100),
  rubricGoal: z.string().optional(),
  validationMin: z.coerce.number().optional(),
  validationMax: z.coerce.number().optional(),
  optionsRaw: z.string().optional(),
  anchorsRaw: z.string().optional(),
});
type QuestionValues = z.infer<typeof questionSchema>;

function QuestionModal({
  initial,
  existingKeys,
  onSave,
  onClose,
}: {
  initial?: FormQuestionDef;
  existingKeys: Set<string>;
  onSave: (q: Partial<FormQuestionDef>) => void;
  onClose: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<QuestionValues>({
    resolver: zodResolver(questionSchema),
    defaultValues: {
      key: initial?.key ?? '',
      label: initial?.label ?? '',
      type: (initial?.type as QuestionValues['type']) ?? 'rating',
      required: initial?.required ?? true,
      weight: initial?.weight ?? 1,
      rubricGoal: initial?.rubric?.goal ?? '',
      validationMin: initial?.validation?.min ?? 0,
      validationMax: initial?.validation?.max ?? 5,
      optionsRaw: initial?.options?.map((o) => `${o.value}:${o.label}`).join('\n') ?? '',
      anchorsRaw: initial?.rubric?.anchors?.map((a) => `${a.value}:${a.label}`).join('\n') ?? '',
    },
  });

  const type = watch('type');

  const submit = (vals: QuestionValues) => {
    if (!initial && existingKeys.has(vals.key)) {
      setError('key', { message: 'Key already exists in this form' });
      return;
    }

    const partial: Partial<FormQuestionDef> = {
      key: vals.key,
      label: vals.label,
      type: vals.type,
      required: vals.required,
      weight: vals.weight,
    };

    if (vals.rubricGoal) {
      partial.rubric = { goal: vals.rubricGoal, anchors: [] };
      if (vals.anchorsRaw) {
        partial.rubric.anchors = vals.anchorsRaw
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const [v, ...rest] = l.split(':');
            return { value: Number(v), label: rest.join(':') };
          });
      }
    }

    if (vals.type === 'select' && vals.optionsRaw) {
      partial.options = vals.optionsRaw
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [v, ...rest] = l.split(':');
          return { value: v, label: rest.join(':') };
        });
    }

    if (vals.type === 'rating') {
      partial.validation = {
        min: vals.validationMin ?? 0,
        max: vals.validationMax ?? 5,
      };
    }

    onSave(partial);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl overflow-y-auto max-h-[90vh]">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          {initial ? 'Edit question' : 'New question'}
        </h3>
        <form onSubmit={handleSubmit(submit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Key (unique, no spaces)"
              placeholder="solution_quality"
              hint="Used as answer identifier"
              error={errors.key?.message}
              className="col-span-2"
              {...register('key')}
            />
            <Input
              label="Label"
              placeholder="How well did the agent solve the issue?"
              error={errors.label?.message}
              className="col-span-2"
              {...register('label')}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Type</label>
              <select
                {...register('type')}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="rating">Rating</option>
                <option value="boolean">Boolean (Yes/No)</option>
                <option value="text">Text</option>
                <option value="select">Select</option>
              </select>
            </div>
            <Input
              label="Weight"
              type="number"
              step="0.1"
              placeholder="1"
              error={errors.weight?.message}
              {...register('weight')}
            />
            <div className="flex items-end pb-0.5">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 accent-primary-600"
                  {...register('required')}
                />
                Required
              </label>
            </div>
          </div>

          {type === 'rating' && (
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Min value"
                type="number"
                step="1"
                defaultValue={0}
                {...register('validationMin')}
              />
              <Input
                label="Max value"
                type="number"
                step="1"
                defaultValue={5}
                {...register('validationMax')}
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Rubric / Goal description
            </label>
            <textarea
              {...register('rubricGoal')}
              rows={2}
              placeholder="Evaluator should assess whether the agent fully resolved the customer's issue."
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {type === 'rating' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Rating anchors (one per line: <code className="text-xs">value:label</code>)
              </label>
              <textarea
                {...register('anchorsRaw')}
                rows={4}
                placeholder={'0:Unacceptable\n1:Poor\n2:Fair\n3:Good\n4:Great\n5:Excellent'}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          )}

          {type === 'select' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Options (one per line: <code className="text-xs">value:label</code>)
              </label>
              <textarea
                {...register('optionsRaw')}
                rows={4}
                placeholder={'yes:Yes\nno:No\nna:N/A'}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{initial ? 'Save' : 'Add question'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Question row ─────────────────────────────────────────────────────────────

function QuestionRow({
  question,
  onEdit,
  onDelete,
  onMove,
  total,
}: {
  question: FormQuestionDef;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  total: number;
}) {
  const TYPE_LABELS: Record<string, string> = {
    rating: 'Rating',
    boolean: 'Boolean',
    text: 'Text',
    select: 'Select',
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
      <GripVertical className="h-4 w-4 shrink-0 text-gray-300" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-gray-800">{question.label}</p>
        <p className="text-xs text-gray-500">
          <span className="font-mono">{question.key}</span> ·{' '}
          {TYPE_LABELS[question.type] ?? question.type} · w={question.weight}
          {question.required && ' · required'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={question.order === 0}
          onClick={() => onMove(-1)}
          className="rounded p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
          title="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={question.order >= total - 1}
          onClick={() => onMove(1)}
          className="rounded p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
          title="Move down"
        >
          ↓
        </button>
        <button type="button" onClick={onEdit} className="rounded p-1 hover:bg-gray-200">
          <Pencil className="h-3.5 w-3.5 text-gray-500" />
        </button>
        <button type="button" onClick={onDelete} className="rounded p-1 hover:bg-red-50">
          <Trash2 className="h-3.5 w-3.5 text-red-400" />
        </button>
      </div>
    </div>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({
  section,
  questions,
  sectionIndex,
  totalSections,
  onEditSection,
  onDeleteSection,
  onMoveSection,
  onAddQuestion,
  onEditQuestion,
  onDeleteQuestion,
  onMoveQuestion,
}: {
  section: FormSectionDef;
  questions: FormQuestionDef[];
  sectionIndex: number;
  totalSections: number;
  onEditSection: () => void;
  onDeleteSection: () => void;
  onMoveSection: (dir: -1 | 1) => void;
  onAddQuestion: () => void;
  onEditQuestion: (q: FormQuestionDef) => void;
  onDeleteQuestion: (qId: string) => void;
  onMoveQuestion: (qId: string, dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Section header */}
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-gray-500 hover:text-gray-800"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span className="flex-1 font-semibold text-gray-800">
          {section.title}
          <span className="ml-2 text-xs font-normal text-gray-400">w={section.weight}</span>
        </span>
        <span className="text-xs text-gray-400">
          {questions.length} question{questions.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1 ml-2">
          <button
            type="button"
            disabled={sectionIndex === 0}
            onClick={() => onMoveSection(-1)}
            className="rounded p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
            title="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={sectionIndex >= totalSections - 1}
            onClick={() => onMoveSection(1)}
            className="rounded p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
            title="Move down"
          >
            ↓
          </button>
          <button type="button" onClick={onEditSection} className="rounded p-1 hover:bg-gray-200">
            <Pencil className="h-3.5 w-3.5 text-gray-500" />
          </button>
          <button type="button" onClick={onDeleteSection} className="rounded p-1 hover:bg-red-50">
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          </button>
        </div>
      </div>

      {open && (
        <div className="p-4 space-y-2">
          {questions.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-2">No questions yet</p>
          )}
          {questions.map((q) => (
            <QuestionRow
              key={q.id}
              question={q}
              total={questions.length}
              onEdit={() => onEditQuestion(q)}
              onDelete={() => onDeleteQuestion(q.id)}
              onMove={(dir) => onMoveQuestion(q.id, dir)}
            />
          ))}
          <button
            type="button"
            onClick={onAddQuestion}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 py-2 text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add question
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FormBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    data: form,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['form', id],
    queryFn: () => formsApi.get(id),
  });

  const [sections, setSections] = useState<FormSectionDef[]>([]);
  const [questions, setQuestions] = useState<FormQuestionDef[]>([]);
  const [passMark, setPassMark] = useState<number>(70);
  const [isDirty, setIsDirty] = useState(false);

  // Modals
  const [sectionModal, setSectionModal] = useState<{
    open: boolean;
    editing?: FormSectionDef;
    forAdd?: boolean;
  }>({ open: false });
  const [questionModal, setQuestionModal] = useState<{
    open: boolean;
    editing?: FormQuestionDef;
    sectionId?: string;
  }>({ open: false });

  // Populate local state when form loads
  useEffect(() => {
    if (form) {
      setSections([...(form.sections ?? [])].sort((a, b) => a.order - b.order));
      setQuestions([...(form.questions ?? [])].sort((a, b) => a.order - b.order));
      setPassMark(form.scoringStrategy?.passMark ?? 70);
      setIsDirty(false);
    }
  }, [form]);

  const markDirty = () => setIsDirty(true);

  // ── Section ops ──

  const addSection = useCallback((vals: { title: string; weight: number }) => {
    setSections((prev) => {
      const next = [
        ...prev,
        { id: uid(), title: vals.title, weight: vals.weight, order: prev.length },
      ];
      return next;
    });
    setSectionModal({ open: false });
    markDirty();
  }, []);

  const editSection = useCallback((id: string, vals: { title: string; weight: number }) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...vals } : s)));
    setSectionModal({ open: false });
    markDirty();
  }, []);

  const deleteSection = useCallback((sId: string) => {
    setSections((prev) => prev.filter((s) => s.id !== sId).map((s, i) => ({ ...s, order: i })));
    setQuestions((prev) => prev.filter((q) => q.sectionId !== sId));
    markDirty();
  }, []);

  const moveSection = useCallback((sId: string, dir: -1 | 1) => {
    setSections((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((s) => s.id === sId);
      const other = idx + dir;
      if (other < 0 || other >= sorted.length) return prev;
      [sorted[idx].order, sorted[other].order] = [sorted[other].order, sorted[idx].order];
      return [...sorted].sort((a, b) => a.order - b.order);
    });
    markDirty();
  }, []);

  // ── Question ops ──

  const addQuestion = useCallback((sectionId: string, partial: Partial<FormQuestionDef>) => {
    setQuestions((prev) => {
      const sectionQs = prev.filter((q) => q.sectionId === sectionId);
      const next: FormQuestionDef = {
        id: uid(),
        sectionId,
        key: partial.key ?? uid().slice(0, 8),
        label: partial.label ?? '',
        type: partial.type ?? 'rating',
        required: partial.required ?? true,
        weight: partial.weight ?? 1,
        order: sectionQs.length,
        ...(partial.rubric ? { rubric: partial.rubric } : {}),
        ...(partial.options ? { options: partial.options } : {}),
        ...(partial.validation ? { validation: partial.validation } : {}),
      };
      return [...prev, next];
    });
    setQuestionModal({ open: false });
    markDirty();
  }, []);

  const editQuestion = useCallback((qId: string, partial: Partial<FormQuestionDef>) => {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== qId) return q;
        const updated = { ...q, ...partial };
        // Cleanup irrelevant props when type changes
        if (partial.type && partial.type !== 'select') delete updated.options;
        if (partial.type && partial.type !== 'rating') delete updated.validation;
        return updated;
      }),
    );
    setQuestionModal({ open: false });
    markDirty();
  }, []);

  const deleteQuestion = useCallback((qId: string) => {
    setQuestions((prev) => {
      const removed = prev.filter((q) => q.id !== qId);
      // Re-number orders within each section
      const sectionCounts: Record<string, number> = {};
      return removed.map((q) => {
        const order = sectionCounts[q.sectionId] ?? 0;
        sectionCounts[q.sectionId] = order + 1;
        return { ...q, order };
      });
    });
    markDirty();
  }, []);

  const moveQuestion = useCallback((qId: string, dir: -1 | 1) => {
    setQuestions((prev) => {
      const q = prev.find((x) => x.id === qId);
      if (!q) return prev;
      const sectionQs = [...prev.filter((x) => x.sectionId === q.sectionId)].sort(
        (a, b) => a.order - b.order,
      );
      const idx = sectionQs.findIndex((x) => x.id === qId);
      const other = idx + dir;
      if (other < 0 || other >= sectionQs.length) return prev;
      const newOrder: Record<string, number> = {};
      newOrder[sectionQs[idx].id] = sectionQs[other].order;
      newOrder[sectionQs[other].id] = sectionQs[idx].order;
      return prev.map((x) => (newOrder[x.id] !== undefined ? { ...x, order: newOrder[x.id] } : x));
    });
    markDirty();
  }, []);

  // ── Save mutation ──

  const saveMutation = useMutation({
    mutationFn: () =>
      formsApi.update(id, {
        sections,
        questions,
        scoringStrategy: { type: 'WEIGHTED', passMark },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['form', id], updated);
      setIsDirty(false);
    },
  });

  const statusMutation = useMutation({
    mutationFn: (action: 'publish' | 'deprecate' | 'archive') => formsApi.changeStatus(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form', id] });
      queryClient.invalidateQueries({ queryKey: ['forms'] });
    },
  });

  // ── Render ──

  if (isLoading)
    return <div className="py-16 text-center text-sm text-gray-500">Loading form…</div>;
  if (isError || !form)
    return (
      <div className="p-6">
        <Alert variant="error">Failed to load form.</Alert>
      </div>
    );

  const isDraft = form.status === 'DRAFT';
  const sortedSections = [...sections].sort((a, b) => a.order - b.order);
  const existingKeys = new Set(questions.map((q) => q.key));

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <button
        onClick={() => router.push('/forms')}
        className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" /> All forms
      </button>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {form.name} <span className="text-base font-normal text-gray-400">v{form.version}</span>
          </h1>
          <p className="mt-0.5 font-mono text-sm text-gray-500">{form.formKey}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
              form.status === 'PUBLISHED'
                ? 'bg-green-100 text-green-700'
                : form.status === 'DRAFT'
                  ? 'bg-gray-100 text-gray-600'
                  : 'bg-orange-100 text-orange-700'
            }`}
          >
            {form.status}
          </span>
          {isDraft && (
            <Button
              size="sm"
              variant="secondary"
              isLoading={statusMutation.isPending}
              onClick={() => statusMutation.mutate('publish')}
              disabled={isDirty}
              title={isDirty ? 'Save changes first' : 'Publish this form'}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" />
              Publish
            </Button>
          )}
          {isDraft && (
            <Button
              size="sm"
              isLoading={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              disabled={!isDirty}
            >
              <Save className="mr-1 h-4 w-4" />
              Save
            </Button>
          )}
        </div>
      </div>

      {!isDraft && (
        <Alert variant="warning" className="mb-6">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          This form is <strong>{form.status}</strong> — editing is disabled.
        </Alert>
      )}

      {saveMutation.isError && (
        <Alert variant="error" className="mb-4">
          Failed to save. Please try again.
        </Alert>
      )}

      {isDirty && (
        <Alert variant="warning" className="mb-4">
          You have unsaved changes.
        </Alert>
      )}

      {/* Scoring strategy */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 font-semibold text-gray-800">Scoring strategy</h2>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-700">Pass mark (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            disabled={!isDraft}
            value={passMark}
            onChange={(e) => {
              setPassMark(Number(e.target.value));
              markDirty();
            }}
            className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <span className="text-xs text-gray-400">
            Conversations scoring at or above this mark pass QA.
          </span>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {sortedSections.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center">
            <p className="text-sm text-gray-400">No sections yet. Add a section to get started.</p>
          </div>
        )}

        {sortedSections.map((section, idx) => {
          const sectionQs = [...questions.filter((q) => q.sectionId === section.id)].sort(
            (a, b) => a.order - b.order,
          );

          return (
            <SectionCard
              key={section.id}
              section={section}
              questions={sectionQs}
              sectionIndex={idx}
              totalSections={sortedSections.length}
              onEditSection={() => setSectionModal({ open: true, editing: section })}
              onDeleteSection={() => deleteSection(section.id)}
              onMoveSection={(dir) => moveSection(section.id, dir)}
              onAddQuestion={() => setQuestionModal({ open: true, sectionId: section.id })}
              onEditQuestion={(q) =>
                setQuestionModal({ open: true, editing: q, sectionId: q.sectionId })
              }
              onDeleteQuestion={deleteQuestion}
              onMoveQuestion={moveQuestion}
            />
          );
        })}
      </div>

      {/* Add section button */}
      {isDraft && (
        <button
          type="button"
          onClick={() => setSectionModal({ open: true })}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 py-3 text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add section
        </button>
      )}

      {/* Section modal */}
      {sectionModal.open && (
        <SectionModal
          initial={sectionModal.editing}
          onSave={(vals) => {
            if (sectionModal.editing) {
              editSection(sectionModal.editing.id, vals);
            } else {
              addSection(vals);
            }
          }}
          onClose={() => setSectionModal({ open: false })}
        />
      )}

      {/* Question modal */}
      {questionModal.open && (
        <QuestionModal
          initial={questionModal.editing}
          existingKeys={
            questionModal.editing
              ? new Set([...existingKeys].filter((k) => k !== questionModal.editing!.key))
              : existingKeys
          }
          onSave={(partial) => {
            if (questionModal.editing) {
              editQuestion(questionModal.editing.id, partial);
            } else if (questionModal.sectionId) {
              addQuestion(questionModal.sectionId, partial);
            }
          }}
          onClose={() => setQuestionModal({ open: false })}
        />
      )}
    </div>
  );
}
