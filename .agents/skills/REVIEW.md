# Reviewing a pull request

How review comments on this repository are written, by people and by agents. A review is read by the author next to their code, one comment at a time. Each comment should tell them what to change without making them work out what it means.

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
