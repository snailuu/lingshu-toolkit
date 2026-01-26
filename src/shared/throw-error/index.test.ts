import { describe, expect, test } from 'vitest';
import { throwError, throwType } from '.';

describe('throw-error', () => {
  const prefix = '[@cmtlyt/lingshu-toolkit]: ';

  test('默认类型', () => {
    expect(() => throwError('test')).toThrowErrorMatchingInlineSnapshot(`[Error: ${prefix}test]`);
  });

  test('类型错误', () => {
    expect(() => throwType('test')).toThrowErrorMatchingInlineSnapshot(`[TypeError: ${prefix}test]`);
    expect(() => throwError('test', TypeError)).toThrowErrorMatchingInlineSnapshot(`[TypeError: ${prefix}test]`);
  });

  test('其他错误', () => {
    expect(() => throwError('test', SyntaxError)).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: ${prefix}test]`);
    expect(() => throwError('test', EvalError)).toThrowErrorMatchingInlineSnapshot(`[EvalError: ${prefix}test]`);
    expect(() => throwError('test', RangeError)).toThrowErrorMatchingInlineSnapshot(`[RangeError: ${prefix}test]`);
    expect(() => throwError('test', ReferenceError)).toThrowErrorMatchingInlineSnapshot(
      `[ReferenceError: ${prefix}test]`,
    );
    expect(() => throwError('test', URIError)).toThrowErrorMatchingInlineSnapshot(`[URIError: ${prefix}test]`);
  });
});
