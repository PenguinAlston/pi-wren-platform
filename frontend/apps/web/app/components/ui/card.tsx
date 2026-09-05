import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';

export interface CardProps {
  type?: 'default' | 'title';
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

/** 卡片：白底 + 1px 边框 + 轻阴影；交互场景传 onClick 获得悬停反馈。 */
export function Card({ children, className, style, onClick }: CardProps) {
  let cls = 'pw-card';
  if (onClick) cls += ' pw-card-clickable';
  if (className) cls += ' ' + className;
  return (
    <div className={cls} style={style} onClick={onClick}>
      {children}
    </div>
  );
}
