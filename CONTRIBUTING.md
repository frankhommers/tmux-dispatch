# Contributing

Issues and pull requests are welcome. For bugs, include the tmux-dispatch and
tmux-mcp versions, authentication mode, and steps to reproduce. Remove tokens,
passwords and private terminal content from logs and screenshots.

Use Node.js 24 or newer and npm:

```sh
npm ci
npm run dev:server
# In a second terminal:
npm run dev
```

Before submitting a change, run `npm run build` and `npm test`.
The service tests use temporary databases and simulated agents; they do not
require tmux. Changes to the wire protocol must remain compatible with
[tmux-mcp](https://github.com/frankhommers/tmux-mcp) and update
[the protocol document](docs/protocol.md) in both repositories.

Pull requests run the build, tests and container build. Only pushes to `main`
and version tags publish images. Contributions are licensed under the project's
[MIT license](LICENSE).
