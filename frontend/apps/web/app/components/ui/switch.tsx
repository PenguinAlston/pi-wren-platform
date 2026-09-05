'use client';

import { useState } from 'react';

export type SwitchSize = 'small' | 'default';

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  size?: SwitchSize;
  disabled?: boolean;
  loading?: boolean;
  checkedChildren?: React.ReactNode;
  unCheckedChildren?: React.ReactNode;
  onChange?: (checked: boolean) => void;
  className?: string;
}

/** 开关：checked 传入时受控，否则内部状态（defaultChecked 起始值）。 */
export function Switch({
  checked,
  defaultChecked = false,
  size = 'default',
  disabled = false,
  loading = false,
  checkedChildren,
  unCheckedChildren,
  onChange,
  className,
}: SwitchProps) {
  const [inner, setInner] = useState(defaultChecked);
  const isControlled = checked !== undefined;
  const active = isControlled ? checked : inner;

  let cls = 'pw-switch' + (active ? ' pw-switch-on' : '');
  if (size === 'small') cls += ' pw-switch-sm';
  if (disabled) cls += ' pw-switch-disabled';
  if (loading) cls += ' pw-switch-loading';
  if (className) cls += ' ' + className;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      className={cls}
      disabled={disabled || loading}
      onClick={() => {
        if (isControlled) onChange?.(!active);
        else {
          setInner(!active);
          onChange?.(!active);
        }
      }}
    >
      {loading ? (
        <i className="pw-spin pw-switch-spin" aria-hidden />
      ) : (
        <span className="pw-switch-thumb" aria-hidden />
      )}
      <span className="pw-switch-text">
        {active ? checkedChildren : unCheckedChildren}
      </span>
    </button>
  );
}
