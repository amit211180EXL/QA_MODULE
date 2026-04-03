'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import React from 'react';

/**
 * Thin progress bar shown at the top of the page during route transitions.
 * Detects navigation by watching pathname changes.
 */
function RouteTransitionLoaderComponent() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevPath = useRef(pathname);

  // Start the bar whenever the pathname changes.
  useEffect(() => {
    if (pathname === prevPath.current) return;     // same page, skip
    prevPath.current = pathname;

    // Clear any running animation
    if (intervalRef.current) clearInterval(intervalRef.current);

    setVisible(true);
    setProgress(15);

    intervalRef.current = setInterval(() => {
      setProgress((p) => (p >= 90 ? 90 : p + Math.random() * 25));
    }, 180);

    // Navigation is complete by the time this effect fires, so finish quickly.
    const done = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setProgress(100);
      setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 280);
    }, 120);

    return () => {
      clearTimeout(done);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [pathname]);

  if (!visible && progress === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 h-1 z-50 pointer-events-none">
      <div
        className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 rounded-full shadow-lg"
        style={{
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
          transition: 'width 280ms ease-out, opacity 200ms ease-out',
        }}
      />
    </div>
  );
}

export const RouteTransitionLoader = React.memo(RouteTransitionLoaderComponent);
