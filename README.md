# tmux-dispatch

[![Container build](https://github.com/frankhommers/tmux-dispatch/actions/workflows/container.yml/badge.svg)](https://github.com/frankhommers/tmux-dispatch/actions/workflows/container.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

The optional dispatch service for [tmux-mcp](https://github.com/frankhommers/tmux-mcp): a web
service where a human answers an agent's request for a tmux pane, from a
laptop or a phone.

tmux-mcp works independently by default. Human-assigned access is opt-in, and
even in that mode the CLI and assign hooks work without this web service.
Use tmux-dispatch when you want a browser inbox for those assignments.

Approve or deny requests, pin panes for automatic assignment, revoke access,
and manage paired machines. Accounts and assignments persist in SQLite.
Confirmed closed panes are automatically removed from the inventory.

**Companion project:** [tmux-mcp](https://github.com/frankhommers/tmux-mcp)
runs on each machine with tmux. Install and configure it there; tmux-dispatch
provides the browser inbox and can run anywhere Docker runs.

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

The public image is `ghcr.io/frankhommers/tmux-dispatch:latest`, for
`linux/amd64` and `linux/arm64`. Docker selects the matching architecture.

```bash
git clone https://github.com/frankhommers/tmux-dispatch.git
cd tmux-dispatch
cp .env.example .env
chmod 600 .env
```

Edit `.env`: choose an `ADMIN_PASSWORD` of at least 12 characters and set
`SESSION_SECRET` to the output of `openssl rand -hex 32`. Then start it:

```bash
docker compose pull
docker compose up -d
```

Open [http://127.0.0.1:7676](http://127.0.0.1:7676) and sign in. The named
volume keeps state across updates. No tmux socket or Docker socket is mounted.

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

## Keeping it running on one machine

For a permanent local deployment, put the settings in an `.env` beside the
compose file rather than passing them on the command line. Compose reads it
automatically, so a later `docker compose up -d` with no arguments cannot
silently fall back to token mode:

```bash
cat > .env <<'EOF'
PUBLIC_URL=http://127.0.0.1:7676
ADMIN_PASSWORD=<at least twelve characters>
SESSION_SECRET=<openssl rand -hex 32>
EOF
chmod 600 .env
docker compose up -d
```

`.env` is gitignored. `restart: unless-stopped` brings the container back
after a crash or a reboot — but only once the Docker daemon is running, so on
a desktop install enable *Start Docker Desktop when you sign in* as well.

The `/data` volume holds accounts, paired devices, auto-assign rules, reported
pane assignments, last activity and pending revocations. These survive a
container restart or image rebuild. Changes are written immediately to SQLite,
not only at shutdown. Restored agents start disconnected until they check in;
a revoked pane stays revoked when its agent returns.

Pending requests belong to their live connection and are not restored. Agents
with no assignments or pending revocations are not retained. Removing a machine,
forgetting an agent, or detecting a replaced tmux server still cleans up its
entries. Data already lost by an older version cannot be recovered; an agent's
next report repopulates its assignments. Pairing is a one-time step per machine.
Keep the named volume when redeploying (`docker compose pull && docker compose up -d`); deleting
the volume also deletes this state.

## Connecting a machine

Dispatch support is included in
[tmux-mcp 0.3.0](https://github.com/frankhommers/tmux-mcp/releases/tag/v0.3.0)
and on its default branch. The commands below pin that release on your tmux
host. Both `--human-assigned` and `--dispatch-url` are needed to use this
optional web inbox:

```bash
npx --prefer-online -y github:frankhommers/tmux-mcp#v0.3.0 dispatch-login --url https://tmux.example.com
# Open https://tmux.example.com/link and enter: WQ7F-2K9P

npx --prefer-online -y github:frankhommers/tmux-mcp#v0.3.0 --human-assigned --dispatch-url wss://tmux.example.com/agent
```

Pairing is a device-code flow, so no secret is ever pasted by hand. Devices
are listed and revoked from dispatch; revoking drops the socket.

## Taking a pane back

Every agent reports what it currently holds, so dispatch lists each machine
with its panes. "Revoke" ends one assignment; unpairing ends the machine's
access altogether.

Because an agent asks dispatch before each action on a pane it holds, taking
one back lands at its next step — even if it was not connected at the time.
If dispatch cannot be reached, the agent keeps working on the grant it already
has: a service that is down must not silently take panes away.

Machines that are gone leave the list by themselves when that can be proven: a
tmux server restarted on the same socket takes the machines of the old one with
it, and a pane a newer agent reports holding is no longer shown with a vanished
one. Anything else can be forgotten from the pane's actions menu; what you revoked from it stays
revoked, in case it was only asleep.

A candidate another agent already holds on the same tmux server is marked as
such, so you do not hand the same pane out twice. The bin next to Deny throws a
card away without answering it: for requests the agent has long forgotten, where
answering only earns a refusal.

## Assigning without being asked

The pool holds entries — a pane id like `%3`, or a glob over the candidate
label like `*agents:*`. When a request matches, it is answered immediately and
you see what happened afterwards. Matching runs against the candidates the
agent sent, so an entry decides *faster*, never *wider*. A non-reusable entry
is used once.

"Keep" next to a pane a machine holds turns that assignment into a standing
rule: agents working in the same directory get it back without asking. Such a
rule is bound to that directory and to the tmux server the id belongs to, so a
restarted tmux makes it fall silent rather than hand out a pane that now means
something else.

With protocol 1.6 on both sides, active MCP servers also validate saved pane and
window ids after tmux changes and every 30 seconds. A confirmed missing id
removes its pin rules and old assignments from this account, machine and tmux
server. Pattern rules remain. A disconnected agent or an unreachable tmux server
does not prove that a pane is gone: cleanup waits for a successful live check.

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
npm ci
npm run dev         # the React app, proxying /api and /events to a running service
npm run dev:server  # the service, with reload
npm test            # the service's tests
npm run build       # app into dist/, service into server-dist/
```

Use Node.js 24 or newer. To build and run your checkout in Docker:

```bash
docker build -t tmux-dispatch:local .
TMUX_DISPATCH_IMAGE=tmux-dispatch:local docker compose up -d --pull never
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for changes and bug reports.

## Container releases

[GitHub Actions](https://github.com/frankhommers/tmux-dispatch/actions/workflows/container.yml)
runs the application build and tests before building the container:

- `main` publishes `latest` and `sha-<full commit SHA>`.
- A tag such as `v1.2.3` publishes `1.2.3`, `1.2`, and its commit tag.
- Pull requests build both architectures without publishing.

Images include source and license labels, build provenance and an SBOM.
Set `TMUX_DISPATCH_IMAGE` in `.env` to a version tag or digest to pin a deployment.
`latest` follows `main`; pushing a version tag does not move it.

## Related projects and license

- [frankhommers/tmux-mcp](https://github.com/frankhommers/tmux-mcp): the companion
  MCP server with human-approved pane access and dispatch support.
- [nickgnd/tmux-mcp](https://github.com/nickgnd/tmux-mcp): Nicolò Gnudi's original
  tmux MCP server, from which the companion project is forked.

tmux-dispatch is open source under the [MIT license](LICENSE).
