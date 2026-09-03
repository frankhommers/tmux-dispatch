# tmux-mcp-ui

The control UI for [tmux-mcp](https://github.com/frankhommers/tmux-mcp): a
small web service where a human answers an agent's request for a tmux pane.

## Why it is a separate service

The MCP server runs on your machine, inside tmux's world. This service does
not, and does not need to: it never runs `tmux` and mounts nothing. The MCP
server **dials out** to this service over a WebSocket and carries everything
tmux-shaped with it — the pane candidates, the scope, the validation.

That direction is what makes hosting it possible at all. A container on macOS
cannot reach the host's tmux socket:

```
$ docker run --rm -v /private/tmp/tmux-501:/sock alpine:edge \
    sh -c 'apk add tmux && tmux -S /sock/default list-panes -a'
error connecting to /sock/default (Not supported)
```

And because the connection is outbound, a laptop behind any router reaches a
public deployment without opening a port.

## Status

Early. The React app and the request inbox work; the WebSocket transport,
sign-in and the pre-assigned pool are being built. See `DESIGN.md`.

## The wire contract

`docs/protocol.md` — mirrored in the tmux-mcp repository. There is deliberately
no shared package: both sides declare their own types and agree at runtime
through `PROTOCOL_VERSION` in the `hello` message. Different majors refuse to
talk, and the MCP server falls back to its requests directory.

## Development

```bash
npm install
npm run dev      # the React app, proxying /api and /events to a running service
npm run build    # production assets into dist/
```
