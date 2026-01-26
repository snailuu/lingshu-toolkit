export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type NotUnion<T> = Equal<[T] extends [never] ? never : T[], T extends any ? T[] : never>;
