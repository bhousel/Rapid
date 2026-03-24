# Contributing

This project uses **GitHub** to track issues and manage our source code.
- Check out the [Git Guides](https://github.com/git-guides) to learn more.

This project uses the **JavaScript** programming language.
- [MDN's JavaScript guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide) is a great resource for learning about JavaScript.

This project uses the **TypeScript** programming language.
- Check out the [TypeScript Docs](https://www.typescriptlang.org/docs/) to learn more.
- (It's a superset of JavaScript, so knowing that already will help you a lot).

This project uses **Bun** as our development environment.
- Check out the [Bun Docs](https://bun.com/docs) to learn more.
- (It's similar to other JavaScript tools like Node/Jest/Esbuild/Vite, so knowing any of those already will help you a lot).
- Bun supports both JavaScript and TypeScript.

If you want to contribute to Rapid, you'll probably need to:
- [Install Bun](https://bun.com/docs/installation)
- `git clone` Rapid
- `cd` into the project folder
- `bun install` the dependencies

As you change things, you'll want to `bun run all` to ensure that things are working.
(This command runs `clean` and `build`, which includes validation, bundling, etc.)

You can also test in a local server:
- `bun start` — builds the project and starts a local dev server

It's also good to check on the dependencies sometimes with commands like:
- `bun outdated` — what packages have updates available?
- `bun update` — update dependencies to the latest versions within their ranges

Try to keep things simple!


## Translations

Translations are managed using the [Transifex](https://www.transifex.com/) platform.

1. Create an an account on Transifex.
2. Visit Rapid's project page here: https://www.transifex.com/rapid-editor/rapid-editor/
3. Optional: You can click the "eyeball" icon to watch the project and get notified when there are new translations needed.
4. Select a language and click **Translate** to get started!

👉 Important:  Any words in brackets, for example `{name}`, are placeholders and should not be translated.
For example, a French translation of `Couldn't locate a place named '{name}'` might look like
`Impossible de localiser l'endroit nommé '{name}'`.

Translations are licensed under [ISC](LICENSE.md), the same license as Rapid.


## Issues

We use GitHub issues to track bugs and feature requests. In case of bug reports, please ensure your description is clear and has sufficient instructions for reproducing the bugs.


## AI-Assisted Contributions

We welcome contributions made with the help of AI tools. If you use them, you are responsible for understanding and reviewing the output before submitting it. Generated code, issues, and PR descriptions should be clear and relevant — not verbose for the sake of it.
