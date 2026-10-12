import type { DurationObject } from "@aikirun/lib/duration";
import { type } from "arktype";

export const durationObjectSchema = type({
	"days?": "number.integer > 0 | undefined",
	"hours?": "number.integer > 0 | undefined",
	"minutes?": "number.integer > 0 | undefined",
	"seconds?": "number.integer > 0 | undefined",
	"milliseconds?": "number.integer > 0 | undefined",
}).narrow((obj, ctx): obj is DurationObject => {
	return (
		obj.days !== undefined ||
		obj.hours !== undefined ||
		obj.minutes !== undefined ||
		obj.seconds !== undefined ||
		obj.milliseconds !== undefined ||
		ctx.mustBe("a duration with at least one of days, hours, minutes, seconds or milliseconds")
	);
});
