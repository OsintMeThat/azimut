# Contributing to Azimut

Issues and pull requests are welcome.

## Before your first pull request

Every contributor signs the [Contributor License Agreement](CLA.md) once. When
you open a pull request, a bot posts a comment asking you to sign: reply with
the sentence it gives you and the check turns green. A pull request is not
merged until every author on it has signed.

The CLA lets the maintainer keep Azimut's licensing in one hand: the project
stays published under the [AGPL-3.0-only](LICENSE), and may also be offered
under other terms. You keep the copyright in your work.

## What a pull request needs

- Tests covering the change. CI runs the backend suite, the frontend tests,
  svelte-check, ruff and mypy, and a red check blocks the merge.
- English for code, comments, commit messages and docs.
- Docs updated in the same change when the behaviour they describe moves.
