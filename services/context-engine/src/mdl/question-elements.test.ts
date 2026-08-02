import { describe, expect, it } from 'vitest';
import { extractQuestionElements } from './question-elements';

describe('extractQuestionElements', () => {
  it('extracts the year from the question', () => {
    const elements = extractQuestionElements('2025终止的保单有哪些？');
    expect(elements.years).toEqual(['2025']);
    expect(elements.hasYear).toBe(true);
  });

  it('detects detail intent words', () => {
    expect(
      extractQuestionElements('2025终止的保单有哪些？同时告诉我被保人的姓名和保单号码').wantsDetail,
    ).toBe(true);
    expect(extractQuestionElements('保单状态分布如何？').wantsDetail).toBe(false);
  });

  it('detects aggregate intent words', () => {
    expect(extractQuestionElements('终止的保单有多少？').wantsAggregate).toBe(true);
    expect(extractQuestionElements('终止的保单有哪些？').wantsAggregate).toBe(false);
  });

  it('distinguishes status vs expiry wording', () => {
    expect(extractQuestionElements('2025终止的保单有哪些').hasTerminatedWord).toBe(true);
    expect(extractQuestionElements('2025年到期或满期的保单').hasExpiryWord).toBe(true);
    expect(extractQuestionElements('2025年到期或满期的保单').hasTerminatedWord).toBe(false);
  });
});
