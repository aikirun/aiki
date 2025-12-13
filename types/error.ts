export type SerializableInput =
	| null
	| string
	| number
	| boolean
	| { [key: string]: SerializableInput }
	| SerializableInput[];

export interface SerializableError {
	message: string;
	name: string;
	stack?: string;
	cause?: SerializableError;
}
