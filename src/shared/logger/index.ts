export const logger = new Proxy(console, {
  get(target, prop, receiver) {
    const oldLog = Reflect.get(target, prop, receiver).bind(console);
    return (...args: any) => {
      oldLog('[@cmtlyt/lingshu-toolkit]:', ...args);
    };
  },
});
