import { type } from "arktype";

export const inputHashSchema = type({
	value: "string > 0",
	"deprecatedValues?": type("string > 0").array().or("undefined"),
});
