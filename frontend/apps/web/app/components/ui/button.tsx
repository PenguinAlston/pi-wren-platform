import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonType = 'primary' | 'default' | 'dashed' | 'text' | 'link';
export type ButtonSize = 'small' | 'middle' | 'large';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  type?: ButtonType;
  size?: ButtonSize;
  danger?: boolean;
  ghost?: boolean;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  htmlType?: 'submit' | 'reset' | 'button';
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  small: ' pw-btn-sm',
  middle: '',
  large: ' pw-btn-lg',
};

const TYPE_CLASS: Record<ButtonType, string> = {
  primary: ' pw-btn-primary',
  default: '',
  dashed: ' pw-btn-dashed',
  text: ' pw-btn-text',
  link: ' pw-btn-link',
};

/** 按钮：type 决定视觉层级（primary/default/text/link），loading 时禁用并展示旋转图标。 */
export function Button({
  type = 'default',
  size = 'middle',
  danger = false,
  ghost = false,
  block = false,
  loading = false,
  disabled = false,
  icon,
  htmlType = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  let cls = 'pw-btn' + TYPE_CLASS[type] + SIZE_CLASS[size];
  if (danger) cls += ' pw-btn-danger';
  if (ghost) cls += ' pw-btn-ghost';
  if (block) cls += ' pw-btn-block';
  if (loading) cls += ' pw-btn-loading';
  if (className) cls += ' ' + className;

  return (
    <button
      type={htmlType}
      className={cls}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <i className="pw-spin" aria-hidden />}
      {!loading && icon}
      {children}
    </button>
  );
}
