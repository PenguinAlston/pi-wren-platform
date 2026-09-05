export interface DividerProps {
  className?: string;
  style?: React.CSSProperties;
}

/** 分隔线。 */
export function Divider({ className, style }: DividerProps) {
  return <hr className={'pw-divider' + (className ? ' ' + className : '')} style={style} />;
}
