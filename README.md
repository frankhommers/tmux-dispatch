# tmux-mcp-ui

The control UI for [tmux-mcp](https://github.com/frankhommers/tmux-mcp): a web
service where a human answers an agent's request for a tmux pane, from a
laptop or a phone.

## How it fits together

```
  your machine                            this service
  ┌───────────────────────┐               ┌──────────────────────┐
  │ tmux-mcp (MCP server) │  wss:// ────► │  the inbox           │
  │  · talks to tmux      │               │  · what is waiting   │
  │  · owns the scope     │ ◄──  answer   │  · the pre-assigned  │
  │  · validates answers  │               │    pool              │
  └───────────────────────┘               └──────────────────────┘
```

The MCP server **dials out** and carries everything tmux-shaped with it: the
pane candidates, the scope, the validation. This service never runs tmux and
mounts nothing.

That direction is not a preference. A container on macOS cannot reach the
host's tmux socket, even with matching versions:

```
$ docker run --rm -v /private/tmp/tmux-501:/sock alpine:edge \
    sh -c 'apk add tmux && tmux -S /sock/default list-panes -a'
error connecting to /sock/default (Not supported)
```

And because the connection is outbound, a laptop behind any router reaches a
hosted deployment without opening a port, and nothing on it listens.

## Running it

```bash
docker compose up -d
```

Sign-in is chosen by what you configure:

| Configured | You get |
|---|---|
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | OIDC, any compliant provider |
| `ADMIN_PASSWORD` (≥ 12 characters) | one password prompt |
| neither | a token printed at startup, for loopback only |

`AUTH_MODE` overrides the detection. Other settings: `PUBLIC_URL`,
`SESSION_SECRET`, `DATABASE_PATH`, `OIDC_ALLOWED_SUBS`, `PORT`.

GitHub is not a sign-in option on its own: it publishes no OIDC discovery for
user login (`github.com/.well-known/openid-configuration` is a 404). Federate
it behind a provider that does.

Put TLS in front for anything public. When `PUBLIC_URL` is `https://`, the
service refuses requests forwarded as plain http.

## Connecting a machine

```bash
tmux-mcp ui-login --url https://tmux.example.com
# Open https://tmux.example.com/link and enter: WQ7F-2K9P

tmux-mcp --human-assigned --ui-url wss://tmux.example.com/agent
```

Pairing is a device-code flow, so no secret is ever pasted by hand. Devices
are listed and revoked from the UI; revoking drops the socket.

## Assigning without being asked

The pool holds entries — a pane id like `%3`, or a glob over the candidate
label like `*agents:*`. When a request matches, it is answered immediately and
you see what happened afterwards. Matching runs against the candidates the
agent sent, so an entry decides *faster*, never *wider*. A non-reusable entry
is used once.

## What this service can and cannot do

It can see what an agent offers: session and window names, pane titles,
working directories and running commands. On a hosted deployment that
information sits on the hosting machine. That is the accepted cost of
answering from a phone.

It cannot widen anything. Every answer is validated by the MCP server that
asked, against its own `--scope` and live tmux state. A wrong target comes
back as an error and the request stays open.

## The wire contract

`docs/protocol.md`, mirrored in the tmux-mcp repository. There is deliberately
no shared package: both sides declare their own types and agree at runtime
through `PROTOCOL_VERSION` in `hello`. Different majors refuse to talk, and
the MCP server falls back to its requests directory.

## Development

```bash
npm install
npm run dev         # the React app, proxying /api and /events to a running service
npm run dev:server  # the service, with reload
npm test            # the service's tests
npm run build       # app into dist/, service into server-dist/
```
