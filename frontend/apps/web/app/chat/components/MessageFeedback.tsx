'use client';

import { Button } from 'animal-island-ui';
import { nextFeedback, type FeedbackValue } from './chat-utils';

interface MessageFeedbackProps {
  rating: FeedbackValue;
  disabled?: boolean;
  /** 点击后的新状态（同值再点为 null = 取消）；提交由父组件处理，失败由父组件回滚。 */
  onRate: (next: FeedbackValue) => void;
}

/** 回答反馈（赞/踩文字按钮，沿用库内无图标库的文本按钮风格）。 */
export function MessageFeedback({ rating, disabled, onRate }: MessageFeedbackProps) {
  return (
    <>
      <Button
        type="link"
        size="small"
        disabled={disabled}
        onClick={() => onRate(nextFeedback(rating, 'up'))}
      >
        {rating === 'up' ? '已赞' : '赞'}
      </Button>
      <Button
        type="link"
        size="small"
        disabled={disabled}
        onClick={() => onRate(nextFeedback(rating, 'down'))}
      >
        {rating === 'down' ? '已踩' : '踩'}
      </Button>
    </>
  );
}
