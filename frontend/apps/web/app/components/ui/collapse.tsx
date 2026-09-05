'use client';

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export interface CollapseProps {
  question: ReactNode;
  answer: ReactNode;
  defaultExpanded?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** 折叠面板（question 为标题行，answer 为展开内容）。 */
export function Collapse({
  question,
  answer,
  defaultExpanded = false,
  disabled = false,
  className,
  style,
}: CollapseProps) {
  const [open, setOpen] = useState(defaultExpanded);

  return (
    <div
      className={'pw-collapse' + (open ? ' pw-collapse-open' : '') + (className ? ' ' + className : '')}
      style={style}
    >
      <button
        type="button"
        className="pw-collapse-head"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          className="pw-collapse-arrow"
          viewBox="0 0 12 12"
          width="12"
          height="12"
          aria-hidden
        >
          <path
            d="M4 2l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="pw-collapse-title">{question}</span>
      </button>
      {open && <div className="pw-collapse-body">{answer}</div>}
    </div>
  );
}
