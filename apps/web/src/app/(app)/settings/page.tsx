'use client';

import Link from 'next/link';
import { Zap, ChevronRight } from 'lucide-react';

const SETTINGS_SECTIONS = [
  {
    href: '/settings/llm',
    icon: Zap,
    title: 'LLM Configuration',
    description: 'Connect an AI model to power automated QA evaluations.',
  },
];

export default function SettingsPage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Configure your workspace preferences.</p>
      </div>

      <div className="space-y-3">
        {SETTINGS_SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100">
              <section.icon className="h-5 w-5 text-primary-700" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-gray-900">{section.title}</p>
              <p className="mt-0.5 text-sm text-gray-500">{section.description}</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" />
          </Link>
        ))}
      </div>
    </div>
  );
}
