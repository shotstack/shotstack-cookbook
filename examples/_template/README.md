# Example name

What the example does. Write one or two sentences. Tell the user what they get at the end.

Related guide: [Guide title](https://shotstack.io/learn/...). Remove this line if there is no guide.

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and an API key
- Each other tool that the example needs, and its minimum version

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/<name>
```

```bash
export SHOTSTACK_API_KEY="your_api_key"
```

## Run

```bash
<the command>
```

## What happens

What the example prints. How long it takes. What to do with the result.

---

Remove this line and all the text below it.

Keep the five sections above, in this sequence.

The `STANDARDS.md` file in the root directory gives the rules for all the examples. It tells you how to use
API keys, how to format the code, and what the example must do when it fails. It also lists the checks to do
before you make a pull request.

Add a `package.json` file only if the example has dependencies. If you add one, set `engines` and a `format`
script.
