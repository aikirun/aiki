import { TaskImpl } from "./service.ts";
import { TaskParams, Task } from "./type.ts";

export function task<
	Payload = undefined, 
	Result = void
>(params: TaskParams<Payload, Result>): Task<Payload, Result> {
	return new TaskImpl(params);
}