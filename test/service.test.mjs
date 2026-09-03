import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket } from 'ws';

import { loadConfig } from '../server-dist/config.js';
import { startService } from '../server-dist/http.js';

const PROTOCOL_VERSION = '1.0';

async function withService(env, run) {
  const config = loadConfig({ PORT: '0', DATABASE_PATH: ':memory:', SESSION_SECRET: 'test-secret', ...env });
  const service = await startService(config);
  try {
    await run({ service, config, url: service.url });
  } finally {
    await service.close();
  }
}

/** A stand-in MCP server: dials in, says hello, and records what it is told. */
function connectAgent(url, token, { protocolVersion = PROTOCOL_VERSION } = {}) {
  const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/agent`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const received = [];
  const state = {
    socket,
    received,
    send: message => socket.send(JSON.stringify(message)),
    waitFor: async (type, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = received.find(m => m.type === type);
        if (found) return found;
        await new Promise(r => setTimeout(r, 20));
      }
      throw new Error(`no ${type}; got ${JSON.stringify(received.map(m => m.type))}`);
    },
    close: () => socket.close(),
  };
  socket.on('message', data => received.push(JSON.parse(String(data))));
  socket.on('open', () => state.send({
    type: 'hello',
    protocolVersion,
    agent: { pid: 1, host: 'test', cwd: '/tmp', tmuxSession: null, scope: 'none', client: 'test' },
  }));
  return state;
}

const REQUEST = {
  type: 'request',
  id: 'r-abc123',
  reason: 'run the suite',
  kind: 'pane',
  createdAt: Date.now(),
  expiresAt: Date.now() + 1_800_000,
  candidates: [
    { id: '%3', label: '%3  main:code.1  zsh  "~/app"' },
    { id: '%5', label: '%5  dev:server.0  node  "~/app"' },
  ],
};

test('the mode is derived from what is configured', async () => {
  assert.equal(loadConfig({ DATABASE_PATH: ':memory:' }).authMode, 'token');
  assert.equal(loadConfig({ DATABASE_PATH: ':memory:', ADMIN_PASSWORD: 'long-enough-password' }).authMode, 'password');
  assert.equal(loadConfig({
    DATABASE_PATH: ':memory:',
    OIDC_ISSUER: 'https://id.example.com',
    OIDC_CLIENT_ID: 'id',
    OIDC_CLIENT_SECRET: 'secret',
  }).authMode, 'oidc');
});

test('a short admin password stops the service from starting', () => {
  assert.throws(
    () => loadConfig({ DATABASE_PATH: ':memory:', ADMIN_PASSWORD: 'short' }),
    /at least 12 characters/
  );
});

test('an agent connects, and its request appears in the inbox', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    try {
      const welcome = await agent.waitFor('welcome');
      assert.equal(welcome.protocolVersion, PROTOCOL_VERSION);

      agent.send(REQUEST);
      await new Promise(r => setTimeout(r, 200));

      const res = await fetch(`${url}/api/requests`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      const body = await res.json();
      assert.equal(body.requests.length, 1);
      assert.equal(body.requests[0].reason, 'run the suite');
      assert.equal(body.requests[0].candidates.length, 2);
      assert.equal(body.agents.length, 1);
      assert.equal(body.agents[0].identity.host, 'test');
    } finally {
      agent.close();
    }
  });
});

test('an agent with the wrong token is refused the socket', async () => {
  await withService({}, async ({ url }) => {
    const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/agent`, {
      headers: { Authorization: 'Bearer wrong' },
    });
    const failed = await new Promise(resolve => {
      socket.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      socket.on('error', () => resolve('error'));
      socket.on('open', () => resolve('opened'));
    });
    assert.notEqual(failed, 'opened');
  });
});

test('a different protocol major is refused with the version named', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token, { protocolVersion: '2.0' });
    try {
      const refusal = await agent.waitFor('refuse');
      assert.equal(refusal.reason, 'protocol_version');
      assert.equal(refusal.protocolVersion, PROTOCOL_VERSION);
    } finally {
      agent.close();
    }
  });
});

test('assigning from the inbox reaches the agent as an answer', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send(REQUEST);
      await new Promise(r => setTimeout(r, 200));

      const res = await fetch(`${url}/api/requests/${REQUEST.id}/grant`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ target: '%5' }),
      });
      assert.equal(res.status, 200);

      const answer = await agent.waitFor('answer');
      assert.equal(answer.target, '%5');
      assert.equal(answer.id, REQUEST.id);
    } finally {
      agent.close();
    }
  });
});

test('a refused answer is shown with its reason and the request stays', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send(REQUEST);
      await new Promise(r => setTimeout(r, 200));

      await fetch(`${url}/api/requests/${REQUEST.id}/grant`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ target: '%99' }),
      });
      await agent.waitFor('answer');
      agent.send({ type: 'result', id: REQUEST.id, ok: false, error: '%99 does not exist' });
      await new Promise(r => setTimeout(r, 200));

      const body = await (await fetch(`${url}/api/requests`, {
        headers: { Authorization: `Bearer ${config.token}` },
      })).json();
      assert.equal(body.requests.length, 1);
      assert.match(body.requests[0].lastError, /does not exist/);
    } finally {
      agent.close();
    }
  });
});

test('a pre-assigned entry answers without a human', async () => {
  await withService({}, async ({ url, config }) => {
    await fetch(`${url}/api/pool`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: '*dev:server*', kind: 'pane' }),
    });

    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send(REQUEST);

      const answer = await agent.waitFor('answer');
      assert.equal(answer.target, '%5', 'the entry matching dev:server should win');
    } finally {
      agent.close();
    }
  });
});

test('a used entry does not answer a second request', async () => {
  await withService({}, async ({ url, config }) => {
    const headers = { Authorization: `Bearer ${config.token}`, 'content-type': 'application/json' };
    await fetch(`${url}/api/pool`, { method: 'POST', headers, body: JSON.stringify({ pattern: '%5', kind: 'pane' }) });

    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send(REQUEST);
      await agent.waitFor('answer');
      agent.send({ type: 'result', id: REQUEST.id, ok: true, target: '%5' });
      await new Promise(r => setTimeout(r, 200));

      agent.received.length = 0;
      agent.send({ ...REQUEST, id: 'r-second' });
      await new Promise(r => setTimeout(r, 500));
      assert.equal(agent.received.filter(m => m.type === 'answer').length, 0,
        'a used entry must not be handed out twice');
    } finally {
      agent.close();
    }
  });
});

test('a pane entry never answers a window request', async () => {
  await withService({}, async ({ url, config }) => {
    const headers = { Authorization: `Bearer ${config.token}`, 'content-type': 'application/json' };
    await fetch(`${url}/api/pool`, { method: 'POST', headers, body: JSON.stringify({ pattern: '*', kind: 'pane' }) });

    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send({ ...REQUEST, id: 'r-window', kind: 'window', candidates: [{ id: '@2', label: '@2  main:code' }] });
      await new Promise(r => setTimeout(r, 500));
      assert.equal(agent.received.filter(m => m.type === 'answer').length, 0);
    } finally {
      agent.close();
    }
  });
});

test('password mode: wrong password is refused, right one signs in', async () => {
  await withService({ ADMIN_PASSWORD: 'correct-horse-battery' }, async ({ url }) => {
    const bad = await fetch(`${url}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    assert.equal(bad.status, 401);

    const good = await fetch(`${url}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct-horse-battery' }),
    });
    assert.equal(good.status, 200);
    const cookie = good.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    const session = await (await fetch(`${url}/api/session`, {
      headers: { cookie: cookie.split(';')[0] },
    })).json();
    assert.equal(session.signedIn, true);
    assert.equal(session.authMode, 'password');
  });
});

test('signed out, the api is closed but the app shell is not', async () => {
  await withService({ ADMIN_PASSWORD: 'correct-horse-battery' }, async ({ url }) => {
    assert.equal((await fetch(`${url}/api/requests`)).status, 401);
    assert.equal((await fetch(`${url}/events`)).status, 401);
    // The shell carries no data and a browser sends no credentials for it.
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
  });
});

test('pairing: a code is approved in the browser and claimed by the CLI', async () => {
  await withService({ ADMIN_PASSWORD: 'correct-horse-battery' }, async ({ url }) => {
    const start = await (await fetch(`${url}/api/pair/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'frank-mbp' }),
    })).json();
    assert.match(start.userCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // Nothing yet.
    const pendingClaim = await (await fetch(`${url}/api/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceCode: start.deviceCode }),
    })).json();
    assert.equal(pendingClaim.status, 'pending');

    const login = await fetch(`${url}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct-horse-battery' }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const approve = await fetch(`${url}/api/pair/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ userCode: start.userCode }),
    });
    assert.equal(approve.status, 200);

    const claimed = await (await fetch(`${url}/api/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceCode: start.deviceCode }),
    })).json();
    assert.equal(claimed.status, 'ready');
    assert.ok(claimed.token.length > 20);

    // That token now opens an agent socket.
    const agent = connectAgent(url, claimed.token);
    try {
      const welcome = await agent.waitFor('welcome');
      assert.equal(welcome.protocolVersion, PROTOCOL_VERSION);
    } finally {
      agent.close();
    }

    // And it is listed, and can be revoked.
    const devices = await (await fetch(`${url}/api/devices`, { headers: { cookie } })).json();
    assert.equal(devices.devices.length, 1);
    assert.equal(devices.devices[0].name, 'frank-mbp');
    const revoked = await fetch(`${url}/api/devices/${devices.devices[0].id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    assert.equal(revoked.status, 200);
  });
});

test('one account never sees another account\'s requests', async () => {
  await withService({}, async ({ url, config, service }) => {
    const other = service.store.upsertAccount('oidc:someone-else', 'someone else');
    const { token: otherToken } = service.store.createDevice(other.id, 'their-laptop');

    const mine = connectAgent(url, config.token);
    const theirs = connectAgent(url, otherToken);
    try {
      await mine.waitFor('welcome');
      await theirs.waitFor('welcome');
      theirs.send({ ...REQUEST, id: 'r-theirs', reason: 'not yours' });
      await new Promise(r => setTimeout(r, 300));

      const body = await (await fetch(`${url}/api/requests`, {
        headers: { Authorization: `Bearer ${config.token}` },
      })).json();
      assert.equal(body.requests.length, 0, 'their request must not appear here');
    } finally {
      mine.close();
      theirs.close();
    }
  });
});

test('a closing agent takes its open requests with it', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    await agent.waitFor('welcome');
    agent.send(REQUEST);
    await new Promise(r => setTimeout(r, 200));

    agent.close();
    await new Promise(r => setTimeout(r, 300));

    const body = await (await fetch(`${url}/api/requests`, {
      headers: { Authorization: `Bearer ${config.token}` },
    })).json();
    assert.equal(body.requests.length, 0, 'answering a dead socket would be a lie');
  });
});
