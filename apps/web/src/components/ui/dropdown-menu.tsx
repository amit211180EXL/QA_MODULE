'use client';

/**
 * DropdownMenu — renders its panel with `position: fixed` so it escapes any
 * overflow:hidden / overflow:auto ancestor (e.g. scrollable table wrappers).
 *
 * Usage:
 *   <DropdownMenu trigger={<MoreVertical … />}>
 *     <DropdownMenuItem onClick={…}>Publish</DropdownMenuItem>
 *     <DropdownMenuItem onClick={…} variant="danger">Delete</DropdownMenuItem>
 *   </DropdownMenu>
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface DropdownMenuItemProps {
  onClick: () => void;
  variant?: 'default' | 'danger';
  children: React.ReactNode;
}

export function DropdownMenuItem({
  onClick,
  variant = 'default',
  children,
}: DropdownMenuItemProps) {
  return (
    <button
      type="button"
      className={`block w-full px-4 py-2 text-left text-sm font-medium transition-all duration-base ${
        variant === 'danger'
          ? 'text-danger-600 hover:bg-danger-50'
          : 'text-slate-700 hover:bg-slate-50'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'right' | 'left';
}

export function DropdownMenu({ trigger, children, align = 'right' }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const open_ = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords({
      top: rect.bottom + window.scrollY + 4,
      left: align === 'right' ? rect.right + window.scrollX : rect.left + window.scrollX,
    });
    setOpen(true);
  }, [align]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on scroll / resize
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open]);

  const panel = open ? (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: coords.top,
        ...(align === 'right'
          ? { right: `calc(100vw - ${coords.left}px)` }
          : { left: coords.left }),
        zIndex: 9999,
      }}
      className="min-w-[9rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
      onClick={() => setOpen(false)}
    >
      {children}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="rounded p-1 hover:bg-slate-100 text-slate-600 transition-all duration-base"
        onClick={(e) => {
          e.stopPropagation();
          open ? setOpen(false) : open_();
        }}
      >
        {trigger}
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </>
  );
}
