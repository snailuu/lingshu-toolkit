export function throwError(fnName: string, message: string, ErrorClass = Error): never {
  throw new ErrorClass(`[@cmtlyt/lingshu-toolkit#${fnName}]: ${message}`);
}

export function throwType(fnName: string, message: string): never {
  throwError(fnName, message, TypeError);
}
