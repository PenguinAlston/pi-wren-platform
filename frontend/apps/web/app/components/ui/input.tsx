import type { InputHTMLAttributes, ReactNode } from 'react';

export type InputSize = 'small' | 'middle' | 'large';

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: InputSize;
  prefix?: ReactNode;
  suffix?: ReactNode;
  allowClear?: boolean;
  status?: 'error' | 'warning';
  onClear?: () => void;
}

const SIZE_CLASS: Record<InputSize, string> = {
  small: ' pw-input-sm',
  middle: '',
  large: ' pw-input-lg',
};

/** 输入框：带 prefix/suffix/allowClear 时用 affix 容器包裹，否则渲染裸 input。 */
export function Input({
  size = 'middle',
  prefix,
  suffix,
  allowClear = false,
  status,
  onClear,
  className,
  value,
  onChange,
  ...rest
}: InputProps) {
  let cls = 'pw-input' + SIZE_CLASS[size];
  if (status === 'error') cls += ' pw-input-error';
  else if (status === 'warning') cls += ' pw-input-warning';
  if (className) cls += ' ' + className;

  const showClear = allowClear && value != null && String(value).length > 0;
  if (!prefix && !suffix && !showClear) {
    return <input className={cls} value={value} onChange={onChange} {...rest} />;
  }

  return (
    <span className="pw-input-affix">
      {prefix && <span className="pw-input-prefix">{prefix}</span>}
      <input className={cls} value={value} onChange={onChange} {...rest} />
      {showClear && (
        <button
          type="button"
          className="pw-input-clear"
          aria-label="清空"
          onClick={() => {
            onClear?.();
          }}
        >
          ×
        </button>
      )}
      {suffix && <span className="pw-input-suffix">{suffix}</span>}
    </span>
  );
}
