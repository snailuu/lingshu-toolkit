export function throwError(message: string, ErrorClass = Error): never {
  throw new ErrorClass(`[@cmtlyt/lingshu-toolkit]: ${message}`);
}

export function throwType(message: string): never {
  throwError(message, TypeError);
}
