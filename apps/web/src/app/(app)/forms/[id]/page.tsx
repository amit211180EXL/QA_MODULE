'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { formsApi, type FormSectionDef, type FormQuestionDef } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-4">
          <h3 className="text-base font-bold text-slate-900">
            {initial ? 'Edit section' : 'New section'}
          </h3>
        </div>
        <form onSubmit={handleSubmit(onSave)} className="space-y-4 p-6">
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
  allQuestions,
  onSave,
  onClose,
}: {
  initial?: FormQuestionDef;
  existingKeys: Set<string>;
  allQuestions: FormQuestionDef[];
  onSave: (q: Partial<FormQuestionDef>) => void;
  onClose: () => void;
}) {
  const [condEnabled, setCondEnabled] = useState(!!initial?.conditionalLogic);
  const [condKey, setCondKey] = useState(initial?.conditionalLogic?.showIf.questionKey ?? '');
  const [condOp, setCondOp] = useState<'eq' | 'neq' | 'gt' | 'lt'>(
    initial?.conditionalLogic?.showIf.operator ?? 'eq',
  );
  const [condVal, setCondVal] = useState(
    initial?.conditionalLogic?.showIf.value !== undefined
      ? String(initial.conditionalLogic.showIf.value)
      : '',
  );
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

    if (condEnabled && condKey && condVal !== '') {
      partial.conditionalLogic = {
        showIf: { questionKey: condKey, operator: condOp, value: condVal },
      };
    } else {
      partial.conditionalLogic = undefined;
    }

    onSave(partial);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-4">
          <h3 className="text-base font-bold text-slate-900">
            {initial ? 'Edit question' : 'New question'}
          </h3>
        </div>
        <div className="overflow-y-auto p-6">
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
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Type</label>
              <select
                {...register('type')}
                className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-blue-600"
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
              className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {type === 'rating' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Rating anchors (one per line: <code className="rounded bg-slate-100 px-1 text-xs">value:label</code>)
              </label>
              <textarea
                {...register('anchorsRaw')}
                rows={4}
                placeholder={'0:Unacceptable\n1:Poor\n2:Fair\n3:Good\n4:Great\n5:Excellent'}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {type === 'select' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Options (one per line: <code className="rounded bg-slate-100 px-1 text-xs">value:label</code>)
              </label>
              <textarea
                {...register('optionsRaw')}
                rows={4}
                placeholder={'yes:Yes\nno:No\nna:N/A'}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Conditional logic */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={condEnabled}
                onChange={(e) => setCondEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              Only show if another question has a specific answer
            </label>
            {condEnabled && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Question</label>
                  <select
                    value={condKey}
                    onChange={(e) => setCondKey(e.target.value)}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select…</option>
                    {allQuestions
                      .filter((q) => q.id !== initial?.id)
                      .map((q) => (
                        <option key={q.key} value={q.key}>
                          {q.key}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Operator</label>
                  <select
                    value={condOp}
                    onChange={(e) => setCondOp(e.target.value as 'eq' | 'neq' | 'gt' | 'lt')}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="eq">equals</option>
                    <option value="neq">not equals</option>
                    <option value="gt">greater than</option>
                    <option value="lt">less than</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Value</label>
                  <input
                    type="text"
                    value={condVal}
                    onChange={(e) => setCondVal(e.target.value)}
                    placeholder="e.g. 3 or true"
                    className="block w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{initial ? 'Save' : 'Add question'}</Button>
          </div>
        </form>
        </div>
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
  readOnly,
}: {
  question: FormQuestionDef;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  total: number;
  readOnly?: boolean;
}) {
  const TYPE_LABELS: Record<string, string> = {
    rating: 'Rating',
    boolean: 'Boolean',
    text: 'Text',
    select: 'Select',
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2 text-sm shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-sm">
      <GripVertical className="h-4 w-4 shrink-0 text-slate-200" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-800">{question.label}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">{question.key}</span>
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-600">{TYPE_LABELS[question.type] ?? question.type}</span>
          <span className="text-[11px] text-slate-400">×{question.weight}</span>
          {question.required && (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-500">required</span>
          )}
          {question.conditionalLogic && (
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-500">
              if {question.conditionalLogic.showIf.questionKey}{' '}
              {question.conditionalLogic.showIf.operator}{' '}
              {String(question.conditionalLogic.showIf.value)}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {!readOnly && (
          <>
            <button
              type="button"
              disabled={question.order === 0}
              onClick={() => onMove(-1)}
              className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
              title="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={question.order >= total - 1}
              onClick={() => onMove(1)}
              className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
              title="Move down"
            >
              ↓
            </button>
            <button type="button" onClick={onEdit} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onDelete} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
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
  readOnly,
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
  readOnly?: boolean;
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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
      {/* Section header */}
      <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span className="flex-1 text-sm font-bold text-slate-800">
          {section.title}
          <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
            ×{section.weight}
          </span>
        </span>
        <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-500">
          {questions.length} question{questions.length !== 1 ? 's' : ''}
        </span>
        <div className="ml-1 flex items-center gap-0.5">
          {!readOnly && (
            <>
              <button
                type="button"
                disabled={sectionIndex === 0}
                onClick={() => onMoveSection(-1)}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={sectionIndex >= totalSections - 1}
                onClick={() => onMoveSection(1)}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                title="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={onEditSection}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <Pencil className="h-3.5 w-3.5 text-gray-500" />
              </button>
              <button
                type="button"
                onClick={onDeleteSection}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {open && (
        <div className="space-y-1.5 p-3">
          {questions.length === 0 && (
            <p className="py-3 text-center text-sm text-slate-400">No questions yet.</p>
          )}
          {questions.map((q) => (
            <QuestionRow
              key={q.id}
              question={q}
              total={questions.length}
              readOnly={readOnly}
              onEdit={() => onEditQuestion(q)}
              onDelete={() => onDeleteQuestion(q.id)}
              onMove={(dir) => onMoveQuestion(q.id, dir)}
            />
          ))}
          {!readOnly && (
            <button
              type="button"
              onClick={onAddQuestion}
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 py-2 text-sm text-slate-400 transition-colors hover:border-blue-400 hover:text-blue-600"
            >
              <Plus className="h-4 w-4" />
              Add question
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Save-choice modal ────────────────────────────────────────────────────────

function SaveChoiceModal({
  isSaving,
  onUpdateExisting,
  onNewVersion,
  onClose,
}: {
  isSaving: boolean;
  onUpdateExisting: () => void;
  onNewVersion: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-4">
          <h3 className="text-base font-bold text-slate-900">Save your changes</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Choose how you want to apply these changes to the form.
          </p>
        </div>

        <div className="space-y-3 p-6">
          <button
            type="button"
            disabled={isSaving}
            onClick={onUpdateExisting}
            className="group w-full rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-60"
          >
            <p className="font-bold text-blue-700">Update existing form</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Apply changes to this form and republish it. The version number stays the same.
            </p>
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={onNewVersion}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:bg-slate-100 disabled:opacity-60"
          >
            <p className="font-bold text-slate-800">Create a new form version</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Save changes as a new draft version. The original published form stays unchanged until
              you publish the new version.
            </p>
          </button>
        </div>

        <div className="flex justify-end border-t border-slate-100 px-6 py-4">
          <Button type="button" variant="secondary" disabled={isSaving} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
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
    refetchOnMount: 'always',
  });

  const [sections, setSections] = useState<FormSectionDef[]>([]);
  const [questions, setQuestions] = useState<FormQuestionDef[]>([]);
  const [passMark, setPassMark] = useState<number>(70);
  const [isDirty, setIsDirty] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Guard: only seed local state ONCE per mount. After the initial seed, local
  // state is the single source of truth while editing. Without this flag, any
  // subsequent form-object change (setQueryData after save, background refetch,
  // etc.) would re-run the effect and wipe out the user's unsaved edits.
  const seededRef = useRef(false);

  const [wasUnpublished, setWasUnpublished] = useState(false);
  const [saveChoiceOpen, setSaveChoiceOpen] = useState(false);

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

  // Seed local state from server data on first load only.
  useEffect(() => {
    if (form && !seededRef.current) {
      const validSections = (form.sections ?? []).filter(
        (v): v is FormSectionDef => v !== null && typeof v === 'object' && !Array.isArray(v),
      );
      const validQuestions = (form.questions ?? []).filter(
        (v): v is FormQuestionDef => v !== null && typeof v === 'object' && !Array.isArray(v),
      );
      setSections([...validSections].sort((a, b) => a.order - b.order));
      setQuestions([...validQuestions].sort((a, b) => a.order - b.order));
      setPassMark(form.scoringStrategy?.passMark ?? 70);
      seededRef.current = true;
      setInitialized(true);
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
        ...(partial.conditionalLogic ? { conditionalLogic: partial.conditionalLogic } : {}),
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
    mutationFn: (action: 'publish' | 'unpublish' | 'deprecate' | 'archive') =>
      formsApi.changeStatus(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form', id] });
      queryClient.invalidateQueries({ queryKey: ['forms'] });
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: () => formsApi.changeStatus(id, 'unpublish'),
    onSuccess: () => {
      setWasUnpublished(true);
      queryClient.invalidateQueries({ queryKey: ['form', id] });
      queryClient.invalidateQueries({ queryKey: ['forms'] });
    },
  });

  // "Update existing" — save edits then republish
  const saveAndRepublishMutation = useMutation({
    mutationFn: async () => {
      await formsApi.update(id, {
        sections,
        questions,
        scoringStrategy: { type: 'WEIGHTED', passMark },
      });
      return formsApi.changeStatus(id, 'publish');
    },
    onSuccess: () => {
      setWasUnpublished(false);
      setIsDirty(false);
      setSaveChoiceOpen(false);
      queryClient.invalidateQueries({ queryKey: ['form', id] });
      queryClient.invalidateQueries({ queryKey: ['forms'] });
    },
  });

  // "New form" — save as a new version, leave original as DRAFT (republish original)
  const saveAsNewVersionMutation = useMutation({
    mutationFn: async () => {
      // Republish the original form unchanged (undo the unpublish)
      await formsApi.changeStatus(id, 'publish');
      // Create new draft version with the edits
      return formsApi.create({
        formKey: form!.formKey,
        name: form!.name,
        description: form!.description ?? undefined,
        channels: form!.channels,
        scoringStrategy: { type: 'WEIGHTED', passMark },
        sections,
        questions,
      });
    },
    onSuccess: (newForm) => {
      setSaveChoiceOpen(false);
      setWasUnpublished(false);
      queryClient.invalidateQueries({ queryKey: ['forms'] });
      router.push(`/forms/${newForm.id}`);
    },
  });

  // ── Render ──

  if (isLoading)
    return <div className="py-16 text-center text-sm text-gray-500">Loading form…</div>;
  if (isError || !form)
    return (
      <div className="p-6">
        <Alert variant="danger">Failed to load form.</Alert>
      </div>
    );

  const isDraft = form.status === 'DRAFT';

  // For DRAFT: use local editable state once initialized; before useEffect runs,
  // fall back directly to server data so there is no flash of empty content.
  // For non-DRAFT: always read from server data (immutable, no local edits).
  // Guard against corrupted data (items stored as [] instead of objects).
  const isObject = (v: unknown): boolean =>
    v !== null && typeof v === 'object' && !Array.isArray(v);

  const serverSections = [...(form.sections ?? [])]
    .filter(isObject)
    .sort((a, b) => (a as FormSectionDef).order - (b as FormSectionDef).order) as FormSectionDef[];
  const serverQuestions = (form.questions ?? []).filter(isObject) as FormQuestionDef[];

  const displaySections = isDraft ? (initialized ? sections : serverSections) : serverSections;
  const displayQuestions = isDraft ? (initialized ? questions : serverQuestions) : serverQuestions;

  const sortedSections = [...displaySections].sort((a, b) => a.order - b.order);
  const existingKeys = new Set(displayQuestions.map((q) => q.key));

  return (
    <div className="max-w-3xl pb-4 pt-1">
      <Topbar title="Form Builder" />
      <button
        type="button"
        onClick={() => router.push('/forms')}
        className="surface-glass mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-slate-600 transition hover:text-primary-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> All forms
      </button>

      <PageHeader
        eyebrow="Form builder"
        title={form.name}
        titleGradient
        description={
          <>
            <code className="rounded-md bg-slate-100/90 px-2 py-0.5 font-mono text-sm text-slate-600">
              {form.formKey}
            </code>
            <span className="ml-2 text-slate-400">v{form.version}</span>
          </>
        }
        aside={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                form.status === 'PUBLISHED'
                  ? 'bg-success-50 text-success-700 ring-1 ring-success-200/60'
                  : form.status === 'DRAFT'
                    ? 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80'
                    : 'bg-warning-50 text-warning-800 ring-1 ring-warning-200/60'
              }`}
            >
              {form.status}
            </span>
            {form.status === 'PUBLISHED' && (
              <Button
                size="sm"
                variant="secondary"
                isLoading={unpublishMutation.isPending}
                onClick={() => unpublishMutation.mutate()}
              >
                Unpublish
              </Button>
            )}
            {isDraft && wasUnpublished && (
              <Button size="sm" onClick={() => setSaveChoiceOpen(true)} disabled={!isDirty}>
                <Save className="mr-1 h-4 w-4" />
                Save changes
              </Button>
            )}
            {isDraft && !wasUnpublished && (
              <>
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
                <Button
                  size="sm"
                  isLoading={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                  disabled={!isDirty}
                >
                  <Save className="mr-1 h-4 w-4" />
                  Save
                </Button>
              </>
            )}
          </div>
        }
        className="mb-4"
      />

      {form.status === 'PUBLISHED' && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm text-amber-800">
            This form is <strong>PUBLISHED</strong> and cannot be edited. Click{' '}
            <strong>Unpublish</strong> to make changes.
          </p>
        </div>
      )}

      {isDraft && wasUnpublished && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm text-amber-800">
            Form unpublished — you can now edit it. When done, click <strong>Save changes</strong>{' '}
            to choose whether to update the existing form or create a new version.
          </p>
        </div>
      )}

      {(form.status === 'DEPRECATED' || form.status === 'ARCHIVED') && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm text-amber-800">
            This form is <strong>{form.status}</strong> — editing is disabled.
          </p>
        </div>
      )}

      {saveMutation.isError && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-sm text-red-700">Failed to save. Please try again.</p>
        </div>
      )}

      {isDirty && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
          <div className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          <p className="text-sm font-medium text-amber-700">You have unsaved changes.</p>
        </div>
      )}

      {/* Scoring strategy */}
      <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-2.5">
          <h2 className="text-sm font-bold text-slate-700">Scoring strategy</h2>
        </div>
        <div className="flex items-center gap-4 px-5 py-3">
          <label className="text-sm font-medium text-slate-700">Pass mark (%)</label>
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
            className="w-24 rounded-lg border border-slate-200 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
          />
          <span className="text-xs text-slate-400">
            Conversations scoring at or above this mark pass QA.
          </span>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {sortedSections.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 py-10 text-center">
            <p className="text-sm text-slate-400">No sections yet. Add a section to get started.</p>
          </div>
        )}

        {sortedSections.map((section, idx) => {
          const sectionQs = [...displayQuestions.filter((q) => q.sectionId === section.id)].sort(
            (a, b) => a.order - b.order,
          );

          return (
            <SectionCard
              key={section.id}
              section={section}
              questions={sectionQs}
              sectionIndex={idx}
              totalSections={sortedSections.length}
              readOnly={!isDraft}
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
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 py-3 text-sm font-medium text-slate-400 transition-colors hover:border-blue-400 hover:text-blue-600"
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
          allQuestions={displayQuestions}
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

      {/* Save choice modal */}
      {saveChoiceOpen && (
        <SaveChoiceModal
          isSaving={saveAndRepublishMutation.isPending || saveAsNewVersionMutation.isPending}
          onUpdateExisting={() => saveAndRepublishMutation.mutate()}
          onNewVersion={() => saveAsNewVersionMutation.mutate()}
          onClose={() => setSaveChoiceOpen(false)}
        />
      )}
    </div>
  );
}
