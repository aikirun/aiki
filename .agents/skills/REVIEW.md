# Reviewing a pull request

How review comments on this repository are written, by people and by agents. A review is read by the author next to their code, one comment at a time. Each comment should tell them what to change without making them work out what it means.

## Start with the design

Most pull requests are now written with AI, and each one tends to add entropy: a concept that blurs an existing one, or a layer that leaks what it was meant to hide. Line comments can't fix that, so a review starts above the lines.

- First ask whether the change is needed at all. Find the problem it solves and the issue or design decision it builds on, and check that the problem is real.
- Then check that the design fits the model the code already has. Read each concept the change adds or reshapes, such as a type, a field, a function or a name, against the ones around it. Look for:
  - one name for two things, such as one flag shared by two settings that can disagree;
  - an abstraction that exposes what it should hide, such as a wrapper that reports what it was built from;
  - a type or field that only carries a value the caller already has;
  - a name that doesn't fit what it names: a noun for the wrong kind of thing, a word that differs from the field it reads, a parameter named after only one of its callers, or a file named after one of the many things it holds;
  - logic that only a code comment explains, such as a parameter that has already been transformed. Let the code show it, through a name or by doing the step where the value is read;
  - a function that makes a choice its caller should make, such as picking between two inputs instead of using the one it is given. The caller knows which one applies, so let it pass that one in.
- Raise the design problems first. A design change moves or removes the code a line comment would point at, so line comments wait until the design is settled.
- Put a design comment on the line that defines the concept, such as the field or the type. When it spans the whole change, put it in the summary.

## What to comment on

- Comment only on what should change in the code. Leave out nits about wording, test titles and code comments unless they cause a real problem.
- Don't flag a refusal the design asks for. A change is unsafe only when it lets a wrong value through or leaks one, and breaking only when it refuses something that was designed to be accepted. Work that stops with a clear error until what it needs is back is the safe outcome.
- One point per comment, each on the lines it is about. A small pull request gets a handful of comments, not a dozen. A point folded into a bigger comment gets missed, so keep it in its own comment and link to it.
- When a file repeats the code of another file, comment on the original and leave one line on the copy pointing to it.
- Verify a finding before posting it, by running the code or reading the code it depends on. Don't post a guess.
- Put anything that isn't about a specific line, such as a needed rebase or an outdated description, in one short summary comment.

## How to write a comment

- Say what's wrong in one sentence, then ask for the change directly: "Let's remove that branch and log the problems here instead." Prefer "Let's …" or "Let the …" to "Could …?".
- For a design problem, that first sentence is the principle the code breaks, in terms the author already uses: "A wrapper should hide what it wraps." Not a list of which caller holds what; the author finds the callers when making the change.
- Write short, plain sentences. A colon joining a problem to its evidence, a clipped opener, a recipe in parentheses, or a reason tacked on at the end makes a comment read as if a bot wrote it. Say who does what instead of using shorthand like "the not-found → null → not-found round trip".
- When one fault leads to another, describe them in that order: the first defect, then what follows from it.
- Frame the ask around what the system does and expects, rather than what it can't do.
- Add a code snippet only when the fix isn't obvious from the sentence. Indent it with 2 spaces, because GitHub shows a tab as 8 spaces, and keep lines under about 90 characters.
- A snippet should make the fix look simpler. When it comes out longer than the code it replaces, look for a shape that removes code instead. A suggested signature follows [TYPESCRIPT.md](TYPESCRIPT.md), such as a params object when arguments share a type, with names that fit every caller and don't suggest the wrong type (`plaintext` reads as a string).
- Don't defend the ask. Leave out proof, issue history, measurements, library output, and reasons the author doesn't need to make the change. The author can ask for more.
- Every "this", "that", "above" or "below", and every "the constructor" or "the caller", has to point at code the author can see next to the comment. Otherwise name the thing: a function by its name, a test by its title, a message by its text.
- Don't put a number next to a status code it could be read as: "500 bad runs" in a comment about a 500 response.
- When one comment depends on another, link to it. When a comment rests on a design doc, link to the section, pinned to a commit so the link keeps showing the text you read.
- Refer to an earlier thread gently: "Similar to what we discussed on #123", not "As I said on #123".

## Examples

| Too much, or unclear | Better |
|---|---|
| This sends the stack trace back to the caller. It also shows file paths and config values like `(was "staging")`, and for a deep call chain the response grows to about 30 KB. … | This sends the stack trace back to the caller. The caller can't act on it, because a crash is a bug on our side. Let the response stay `Internal error`, with the trace only in the log. |
| If the response stays plain, the branch above only adds a log. Could the trace be logged here instead, so that branch can go? | With the change suggested [here](…), the response is just `Internal error`, without the trace. The timeout branch above then returns the same response as this one. Let's remove that branch and log the trace here instead. |
| It replaces the test on this line and the next one. | With this test in place, "logs the trace when a handler throws" and "includes the trace in the logged error" can be removed. |
| `hasCache` makes the wrapper report what it was built from, only to hand back something its callers already have: `createUser` holds `params.cache`, and the handler holds `this.cache`. … | A wrapper should hide what it wraps. `hasCache` tells its users whether a cache is inside. The callers that read it already have the cache, so let them check that instead. |
| Let the value be read the way the constructor below reads the input. | Nothing in this code shows that `value` was already parsed. Only the comment above says so. Let's parse it here, where it's read, so the comment can go. |
| Removing this option isn't safe the way adding it is: requests that still use it are refused from then on. | No comment. Refusing them is what the design asks for. |
