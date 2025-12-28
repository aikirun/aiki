export type Serializable = null | string | number | boolean | { [key: string]: Serializable } | Serializable[];

export interface SerializableError {
	message: string;
	name: string;
	stack?: string;
	cause?: SerializableError;
}
