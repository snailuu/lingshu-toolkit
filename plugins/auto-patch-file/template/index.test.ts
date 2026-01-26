import { describe, expect, test } from 'vitest';
import { $$name$$ } from './index';

describe('$$name$$', () => {
  test('导出测试', () => {
    expect($$name$$).toBeTypeOf('function');
  });
});
