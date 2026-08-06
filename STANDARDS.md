# Standards for cookbook examples

All the code in this repository is public. Developers copy it into their own projects. These rules make the
examples consistent and safe to copy.

To make a new example, copy the `examples/_template/` directory.

## Structure

- Put each example in its own directory in `examples/`.
- Each example must run after a new clone of the repository. Do not add steps that are not in the README of
  the example.
- The `name` in `package.json` must be the same as the directory name.
- If the example has a `package.json`, give the minimum Node version in `engines`. The minimum version for
  the repository is in `.nvmrc`.
- If the example has no `package.json`, no tool can check the minimum version. Do not put flags in the README
  that need a specific version of Node. Use environment variables.

## API keys

- Read the API key from an environment variable.
- Do not put a key in the code. Do not print a key. Do not commit a key.
- Add a `.env.example` file. Put example values in it.
- For a Next.js example, name the file `.env.local.example`. Next.js reads `.env.local`.
- Add the real environment file to `.gitignore`.

## Format and lint

- The `.prettierrc` file in the root directory controls the format of the JavaScript, TypeScript, JSON, CSS
  and Markdown files.
- The `ruff.toml` file controls the format of the Python files.
- If the example has a `package.json`, add a `format` script.
- The CI pipeline does `prettier --check` and `ruff check` for each pull request. Do these commands on your
  computer first.

## Failures

An example can fail for these usual reasons:

- The user did not set the API key.
- The API rejected the key.
- The network failed.

For each of these failures, the example must print one line that tells the user what to do. Then the example
must stop with an exit code that is not zero. Do not let the example print a stack trace.

Most users get the first failure, because they forgot to set the API key. Give the most attention to that
failure.

## README structure

Use these sections, in this sequence, in each README:

1. What the example does, and a link to the related guide if there is one
2. Requirements
3. Setup
4. How to run the example
5. What happens when you run it

Write as few statements of fact as possible. Each version number, flag and command in a README is a statement
that must stay correct.

Write the documentation in Simplified Technical English (ASD-STE100). Many readers of this repository do not
have English as their first language. Obey these rules:

- Write short sentences. Use a maximum of 20 words in an instruction, and 25 words in a description.
- Write one instruction in each sentence.
- Use the active voice. Write "Set the API key", not "The API key must be set".
- Use the same word for the same thing each time.
- Do not use idioms, metaphors or humour.

## Before you make a pull request

You must read the code and run it before you make a pull request. Then do these checks:

1. Clone the repository again. Run the example with no API key. Read the message.
2. Run the example with an incorrect API key. Read the message.
3. Do each command in your README, in the correct sequence.
4. Run the formatter and the linter.
5. If the example is in two languages, compare the two files. If they are different, one of them is
   incorrect.
