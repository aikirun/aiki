// biome-ignore lint/suspicious/noConfusingVoidType: allow for returning void in handlers
export type Serializable = void | null | string | number | boolean | { [key: string]: Serializable } | Serializable[];
