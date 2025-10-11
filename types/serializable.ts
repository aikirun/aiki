export type SerializableInput =
	| null
	| string
	| number
	| boolean
	| { [key: string]: SerializableInput }
	| SerializableInput[];
