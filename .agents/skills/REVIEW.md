# Reviewing a pull request

How review comments on this repository are written, by people and by agents. A review is read by the author next to their code, one comment at a time. Each comment should tell them what to change without making them work out what it means.

## Start with the design

Most pull requests are now written with AI, and each one tends to add entropy: a concept that blurs an existing one, or a layer that leaks what it was meant to hide. Line comments can't fix that, so a review starts above the lines.

- First ask whether the change is needed at all. Find the problem it solves and the issue or design decision it builds on, and check that the problem is real.
- Then check that the design fits the model the code already has. Read each concept the change adds or reshapes, such as a type, a field, a function or a name, against the ones around it. Look for:
  - one name for two things, such as two flags for two separate codec slots that share one name;
  - an abstraction that exposes what it should hide, such as a composed codec that reports which codecs it was built from;
  - a type or field that only carries a value the caller already has;
  - a name for the wrong kind of thing, such as `workflowOutput` for a codec;
  - logic that only a code comment explains, such as a parameter that already holds another codec composed in. Let the code show it, through a name or by doing the step where the value is read.
- Raise the design problems first. A design change moves or removes the code a line comment would point at, so line comments wait until the design is settled.
- Put a design comment on the line that defines the concept, such as the field or the type. When it spans the whole change, put it in the summary.

## What to comment on

- Comment only on what should change in the code. Leave out nits about wording, test titles and code comments unless they cause a real problem.
- One point per comment, each on the lines it is about. A small pull request gets a handful of comments, not a dozen.
- When a file repeats the code of another file, comment on the original and leave one line on the copy pointing to it.
- Verify a finding before posting it, by running the code or reading the code it depends on. Don't post a guess.
- Put anything that isn't about a specific line, such as a needed rebase or an outdated description, in one short summary comment.

## How to write a comment

- Say what's wrong in one sentence, then ask for the change directly: "Let's remove that branch and log the problems here instead." Prefer "Let's …" or "Let the …" to "Could …?".
- Add a code snippet only when the fix isn't obvious from the sentence. Indent it with 2 spaces, because GitHub shows a tab as 8 spaces, and keep lines under about 90 characters.
- Don't defend the ask. Leave out proof, issue history, measurements, library output, and reasons the author doesn't need to make the change. The author can ask for more.
- Every "this", "that" or "above" has to point at code the author can see next to the comment. Otherwise name the thing: a test by its title, a message by its text.
- Don't put a number next to a status code it could be read as: "500 bad runs" in a comment about a 500 response.
- When one comment depends on another, link to it.

## Examples

| Too much, or unclear | Better |
|---|---|
| This sends every problem back to the client in the 500. The messages also show internal paths and stored values like `(was "paused")`, and for a list of 500 bad runs the message grows to about 49 KB. … | This sends the list of problems back to the client. The client can't fix them, because a bad response is a bug on the server. Let the message stay `Output validation failed`, with the problems only in the log. |
| If the message stays plain, the branch above only adds a log. Could the problems be logged here instead, so that branch can go? | With the change suggested [here](…), the error sent back to the client is just `Output validation failed`, without the problems. The output validation branch above then throws the same error as this one. Let's remove that branch and log the problems here instead. |
| It replaces the test on this line and the next one. | With this test in place, "logs and re-throws an output validation error with problems" and "includes the problem list in the re-thrown output validation error message" can be removed. |
