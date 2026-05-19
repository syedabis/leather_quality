"use client";
import { useEffect, useRef, useState } from 'react';

interface CounterBadgeProps {
  value: number;
  className?: string;
}

/**
 * CounterBadge — animated piece count. Bumps scale when value increments.
 */
export default function CounterBadge({ value, className = "" }: CounterBadgeProps) {
  const [display,  setDisplay]  = useState(value);
  const [bumping,  setBumping]  = useState(false);
  const prevRef = useRef(value);

  useEffect(() => {
    if (value !== prevRef.current) {
      prevRef.current = value;
      setDisplay(value);
      setBumping(true);
      const t = setTimeout(() => setBumping(false), 400);
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <span
      className={`tabular-nums font-bold font-[family-name:var(--font-inter-tight)] transition-colors ${
        bumping ? 'count-bump text-[#2AAA8A]' : ''
      } ${className}`}
    >
      {display?.toLocaleString() ?? '--'}
    </span>
  );
}
