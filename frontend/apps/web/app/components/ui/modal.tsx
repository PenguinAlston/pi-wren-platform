'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Button } from './button';

export interface ModalProps {
  open: boolean;
  title?: ReactNode;
  width?: number | string;
  maskClosable?: boolean;
  closable?: boolean;
  footer?: ReactNode | null;
  onClose?: () => void;
  onOk?: () => void;
  children?: ReactNode;
  className?: string;
}

/** 模态框：portal 渲染 + 遮罩 + Esc 关闭 + 锁滚动；footer 缺省为「取消/确定」。 */
export function Modal({
  open,
  title,
  width = 460,
  maskClosable = true,
  closable = true,
  footer,
  onClose,
  onOk,
  children,
  className,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closable) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, closable, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="pw-modal-root">
      <div
        className="pw-modal-mask"
        onClick={maskClosable ? onClose : undefined}
      />
      <div
        className={'pw-modal' + (className ? ' ' + className : '')}
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
        role="dialog"
        aria-modal="true"
      >
        {(title || closable) && (
          <div className="pw-modal-header">
            <div className="pw-modal-title">{title}</div>
            {closable && (
              <button
                type="button"
                className="pw-modal-close"
                aria-label="关闭"
                onClick={onClose}
              >
                <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
                  <path
                    d="M1 1l12 12M13 1L1 13"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="pw-modal-body">{children}</div>
        {footer !== null && (
          <div className="pw-modal-footer">
            {footer ?? (
              <>
                <Button onClick={onClose}>取消</Button>
                <Button type="primary" onClick={onOk}>
                  确定
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
