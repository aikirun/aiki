export interface ProcessWrapper {
	addSignalListener(signal: string, handler: () => void): void;
	exit(code: number): never;
}
