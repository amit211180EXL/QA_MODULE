'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import React from 'react';

function RouteTransitionLoaderComponent() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let progressInterval: NodeJS.Timeout;

    const handleStart = () => {
      setIsLoading(true);
      setProgress(10);

      // Increment progress gradually
      progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) return 90;
          return prev + Math.random() * 30;
        });
      }, 200);
    };

    const handleComplete = () => {
      setProgress(100);
      clearInterval(progressInterval);
      
      // Hide loader after animation completes
      setTimeout(() => {
        setIsLoading(false);
        setProgress(0);
      }, 300);
    };

    // Listen to route change events
    const timer = setInterval(() => {
      // This is a fallback; real detection happens via page visibility or navigation timing
    }, 100);

    // Use popstate for back/forward navigation
    window.addEventListener('popstate', handleStart);

    // For Link navigation, we need to detect it differently
    // We'll use MutationObserver on the document
    const observer = new MutationObserver(() => {
      if (document.readyState === 'loading') {
        handleStart();
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-nextjs-scroll-focus-boundary'],
    });

    // Detect navigation completion
    const handleLoad = () => {
      handleComplete();
    };

    window.addEventListener('load', handleLoad);
    
    // Also complete when route change completes
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;

    window.history.pushState = function (...args) {
      handleStart();
      originalPush.apply(window.history, args);
      // Complete after a short delay
      setTimeout(handleComplete, 500);
      return undefined as any;
    };

    window.history.replaceState = function (...args) {
      originalReplace.apply(window.history, args);
      return undefined as any;
    };

    return () => {
      clearInterval(timer);
      clearInterval(progressInterval);
      window.removeEventListener('popstate', handleStart);
      window.removeEventListener('load', handleLoad);
      observer.disconnect();
    };
  }, [router]);

  if (!isLoading && progress === 0) return null;

  const barStyle = useMemo(
    () => ({
      width: `${progress}%`,
      opacity: isLoading ? 1 : 0,
    }),
    [progress, isLoading],
  );

  return (
    <div className="fixed top-0 left-0 right-0 h-1 z-50 pointer-events-none">
      <div
        className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 rounded-full transition-all duration-300 ease-out shadow-lg"
        style={barStyle}
      />
    </div>
  );
}

export const RouteTransitionLoader = React.memo(RouteTransitionLoaderComponent);
