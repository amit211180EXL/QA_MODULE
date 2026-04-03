'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useAuth } from '@/context/auth-context';
import { onboardingApi, type OnboardingStatus } from '@/lib/api';
import { UserRole } from '@qa/shared';
import {
  CheckCircle,
  Circle,
  ChevronDown,
  ChevronUp,
  Cpu,
  Users,
  FileText,
  Upload,
  X,
} from 'lucide-react';

interface Step {
  key: keyof Omit<OnboardingStatus, 'isComplete'>;
  label: string;
  description: string;
  href: string;
  actionLabel: string;
  icon: React.ElementType;
}

const STEPS: Step[] = [
  {
    key: 'hasLlmConfig',
    label: 'Configure LLM',
    description: 'Connect an AI provider so evaluations can be scored automatically.',
    href: '/settings',
    actionLabel: 'Go to Settings',
    icon: Cpu,
  },
  {
    key: 'hasPublishedForm',
    label: 'Publish a QA Form',
    description: 'Create and publish at least one QA scorecard for your agents.',
    href: '/forms',
    actionLabel: 'Go to Forms',
    icon: FileText,
  },
  {
    key: 'hasNonAdminUsers',
    label: 'Invite QA & Verifier users',
    description: 'Add team members with QA or Verifier roles to start reviewing.',
    href: '/users',
    actionLabel: 'Invite Users',
    icon: Users,
  },
  {
    key: 'hasConversations',
    label: 'Upload first conversations',
    description: 'Import conversations via CSV or JSON to kick off the evaluation pipeline.',
    href: '/upload',
    actionLabel: 'Upload Now',
    icon: Upload,
  },
];

const STORAGE_KEY = 'onboarding_dismissed_v1';

function isDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === '1';
}

function dismiss() {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, '1');
  }
}

export function OnboardingWizard() {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(isDismissed);

  const { data: status, isLoading } = useQuery<OnboardingStatus>({
    queryKey: ['onboarding-status'],
    queryFn: onboardingApi.getStatus,
    staleTime: 60_000,
    enabled: user?.role === UserRole.ADMIN && !dismissed,
  });

  // Only shown to admin; hidden if complete, loading, or dismissed
  if (user?.role !== UserRole.ADMIN) return null;
  if (dismissed) return null;
  if (isLoading) return null;
  if (!status || status.isComplete) return null;

  const completedCount = STEPS.filter((s) => status[s.key]).length;
  const totalCount = STEPS.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);

  const handleDismiss = () => {
    dismiss();
    setDismissed(true);
  };

  return (
    <div className="mx-6 mt-4 rounded-xl border border-indigo-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between bg-indigo-50 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <div className="relative h-9 w-9">
              <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
                <circle cx="18" cy="18" r="15" fill="none" stroke="#e0e7ff" strokeWidth="4" />
                <circle
                  cx="18"
                  cy="18"
                  r="15"
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth="4"
                  strokeDasharray={`${2 * Math.PI * 15}`}
                  strokeDashoffset={`${2 * Math.PI * 15 * (1 - progressPct / 100)}`}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-indigo-700">
                {progressPct}%
              </span>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-indigo-900">
              Getting started — {completedCount}/{totalCount} steps complete
            </p>
            <p className="text-xs text-indigo-600">
              Complete setup to start evaluating conversations
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <button
            onClick={handleDismiss}
            className="rounded p-1 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Steps */}
      {!collapsed && (
        <div className="divide-y divide-gray-100">
          {STEPS.map((step) => {
            const done = status[step.key];
            const Icon = step.icon;
            return (
              <div
                key={step.key}
                className={`flex items-center gap-4 px-5 py-3.5 ${done ? 'opacity-60' : ''}`}
              >
                {/* Status icon */}
                <div className="flex-shrink-0">
                  {done ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-gray-300" />
                  )}
                </div>

                {/* Step icon */}
                <div
                  className={`flex-shrink-0 rounded-lg p-2 ${
                    done ? 'bg-green-50' : 'bg-indigo-50'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 ${done ? 'text-green-500' : 'text-indigo-500'}`}
                  />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium ${
                      done ? 'text-gray-400 line-through' : 'text-gray-800'
                    }`}
                  >
                    {step.label}
                  </p>
                  {!done && (
                    <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>
                  )}
                </div>

                {/* CTA */}
                {!done && (
                  <Link href={step.href}>
                    <button className="flex-shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors">
                      {step.actionLabel}
                    </button>
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
