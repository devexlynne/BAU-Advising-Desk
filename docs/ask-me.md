# Ask Me: the rule-based advising guide

The portal guide is called **Ask Me**. It is not an AI assistant and it does not use an LLM,
an API key, or any external service.

Ask Me runs entirely inside the portal. It recognises questions about a student, a course code,
the current registration, degree progress, prerequisites, repeats, probation, the Mathematics
minor, and the written advising rules. Every answer is calculated from the same deterministic
rule engine used by the student pages.

## Privacy and consistency

- No question or student record is sent outside the portal.
- There is no model fallback.
- The same record and question produce the same answer.
- If a question is not recognised, Ask Me says so and offers useful examples instead of guessing.

The server has no `/api/ask` route and no model or LLM environment variables. The browser store
also exposes no model connector. The smoke tests verify that recognised questions are answered
locally and unrecognised questions keep the local fallback.

## Mathematics minor answer

Ask Me explains the department rule in plain words: the minor needs 18 separate MATH credits and
must include **MATH246 Real Analysis I** or **MATH346 Abstract Algebra I**. Mathematics courses
already used as Computer Science core, departmental electives, or General Science are not counted
again in the minor.
