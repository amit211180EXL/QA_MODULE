'use client';

// The evaluation review page (qa-queue/[id]) handles all workflow states:
// QA_PENDING, QA_IN_PROGRESS, QA_COMPLETED, VERIFIER_IN_PROGRESS, LOCKED.
// This page re-exports it so verifier queue links (/verifier-queue/:id) work too.

export { default } from '../../qa-queue/[id]/page';
