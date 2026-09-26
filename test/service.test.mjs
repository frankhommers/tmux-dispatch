import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server-dist/db.js';
import test from 'node:test';
import { WebSocket } from 'ws';

import { loadConfig } from '../server-dist/config.js';
import { startService } from '../server-dist/http.js';
import { localAccount } from '../server-dist/auth.js';
import { parseAgentMessage } from '../server-dist/protocol.js';

const PROTOCOL_VERSION = '1.6';

test('malformed inventory validation is ignored', () => {
  const frame = { type: 'validation', id: 'v-1', tmuxServer: '/socket:1:100', missing: ['%3', '@4'] };
  assert.deepEqual(parseAgentMessage(JSON.stringify(frame)), frame);
  for (const missing of [null, '%3', ['*'], ['%3', 4]]) {
    assert.equal(parseAgentMessage(JSON.stringify({ ...frame, missing })), null);
  }
});

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
function connectAgent(url, token, {
  protocolVersion = PROTOCOL_VERSION,
  instanceId = randomUUID(),
  cwd = '/tmp',
  tmuxServer = '/private/tmp/tmux-501/default:1:1',
} = {}) {
  const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/agent`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const received = [];
  const state = {
    socket,
    received,
    send: message => socket.send(JSON.stringify(message)),
    waitFor: async (type, timeoutMs = 4000, where = () => true) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = received.find(m => m.type === type && where(m));
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
    agent: { instanceId, pid: 1, host: 'test', cwd, tmuxServer, tmuxSession: null, scope: 'none', client: 'test' },
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

const GRANT = { target: '%3', kind: 'pane', label: '%3  main:code.1  zsh', since: 1_700_000_000_000 };

/** Read the inbox the way the browser does. */
async function inbox(url, config) {
  return (await fetch(`${url}/api/requests`, {
    headers: { Authorization: `Bearer ${config.token}` },
  })).json();
}

test('what an agent holds is listed with the machine holding it', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send({ type: 'grants', grants: [GRANT] });
      await new Promise(r => setTimeout(r, 200));

      const body = await inbox(url, config);
      assert.equal(body.agents.length, 1);
      assert.deepEqual(body.agents[0].grants, [{ ...GRANT, lastActivity: null }]);
      assert.equal(body.agents[0].connected, true);
    } finally {
      agent.close();
    }
  });
});

test('an agent that hangs up is still listed with what it holds', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    await agent.waitFor('welcome');
    agent.send({ type: 'grants', grants: [GRANT] });
    await new Promise(r => setTimeout(r, 200));

    // Reporting and hanging up is normal: an idle agent keeps no socket open.
    agent.close();
    await new Promise(r => setTimeout(r, 300));

    const body = await inbox(url, config);
    assert.equal(body.agents.length, 1, 'the pane is still handed out, so say so');
    assert.deepEqual(body.agents[0].grants, [{ ...GRANT, lastActivity: null }]);
    assert.equal(body.agents[0].connected, false);
  });
});

test('the same server dialling back in is one machine, not two', async () => {
  await withService({}, async ({ url, config }) => {
    const instanceId = randomUUID();
    const first = connectAgent(url, config.token, { instanceId });
    await first.waitFor('welcome');
    first.send({ type: 'grants', grants: [GRANT] });
    await new Promise(r => setTimeout(r, 200));
    first.close();
    await new Promise(r => setTimeout(r, 200));

    const again = connectAgent(url, config.token, { instanceId });
    try {
      await again.waitFor('welcome');
      const body = await inbox(url, config);
      assert.equal(body.agents.length, 1);
      assert.equal(body.agents[0].id, instanceId);
    } finally {
      again.close();
    }
  });
});

test('taking a pane back reaches a connected agent at once', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send({ type: 'grants', grants: [GRANT] });
      await new Promise(r => setTimeout(r, 200));

      const body = await inbox(url, config);
      const response = await fetch(`${url}/api/agents/${body.agents[0].id}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ target: '%3' }),
      });
      assert.equal(response.status, 200);

      const revoke = await agent.waitFor('revoke');
      assert.equal(revoke.target, '%3');
    } finally {
      agent.close();
    }
  });
});

test('an agent asking about a pane is told yes until it is taken back', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send({ type: 'grants', grants: [GRANT] });
      await new Promise(r => setTimeout(r, 200));

      agent.send({ type: 'check', id: 'c-1', target: '%3' });
      const yes = await agent.waitFor('verdict');
      assert.equal(yes.id, 'c-1');
      assert.equal(yes.allowed, true);

      const body = await inbox(url, config);
      await fetch(`${url}/api/agents/${body.agents[0].id}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ target: '%3' }),
      });
      await agent.waitFor('revoke');

      agent.send({ type: 'check', id: 'c-2', target: '%3' });
      const no = await agent.waitFor('verdict', 4000, m => m.id === 'c-2');
      assert.equal(no.allowed, false, 'a pane taken back must not be confirmed again');
    } finally {
      agent.close();
    }
  });
});

test('unpairing a machine drops the socket it is using', async () => {
  await withService({}, async ({ url, config, service }) => {
    const account = localAccount(service.store);
    const { device, token } = service.store.createDevice(account.id, 'frank-mbp');

    const agent = connectAgent(url, token);
    await agent.waitFor('welcome');
    const closed = new Promise(resolve => agent.socket.on('close', resolve));

    const response = await fetch(`${url}/api/devices/${device.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${config.token}` },
    });
    assert.equal(response.status, 200);

    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('the socket stayed open')), 2000)),
    ]);
  });
});

test('a pane taken back is not listed again while the agent still reports it', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send({ type: 'grants', grants: [GRANT] });
      await new Promise(r => setTimeout(r, 200));

      const before = await inbox(url, config);
      await fetch(`${url}/api/agents/${before.agents[0].id}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ target: '%3' }),
      });

      // The agent has not noticed yet and reports the old picture.
      agent.send({ type: 'grants', grants: [GRANT] });
      await new Promise(r => setTimeout(r, 200));

      const after = await inbox(url, config);
      assert.deepEqual(after.agents[0].grants, [], 'what was taken back must stay out of view');
    } finally {
      agent.close();
    }
  });
});

test('handing the same pane back over makes it current again', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send({ type: 'grants', grants: [GRANT] });
      await new Promise(r => setTimeout(r, 200));

      const before = await inbox(url, config);
      await fetch(`${url}/api/agents/${before.agents[0].id}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ target: '%3' }),
      });
      await agent.waitFor('revoke');

      // A human hands the same pane over again: a newer assignment, so it counts.
      agent.send({ type: 'grants', grants: [{ ...GRANT, since: Date.now() + 1000 }] });
      await new Promise(r => setTimeout(r, 200));

      const after = await inbox(url, config);
      assert.equal(after.agents[0].grants.length, 1, 'a fresh assignment is not the old one');

      agent.send({ type: 'check', id: 'c-3', target: '%3' });
      const verdict = await agent.waitFor('verdict', 4000, m => m.id === 'c-3');
      assert.equal(verdict.allowed, true);
    } finally {
      agent.close();
    }
  });
});

test('a machine that is gone and holds nothing is not listed, but is still refused', async () => {
  await withService({}, async ({ url, config }) => {
    const instanceId = randomUUID();
    const agent = connectAgent(url, config.token, { instanceId });
    await agent.waitFor('welcome');
    agent.send({ type: 'grants', grants: [GRANT] });
    await new Promise(r => setTimeout(r, 200));

    await fetch(`${url}/api/agents/${instanceId}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ target: '%3' }),
    });
    agent.close();
    await new Promise(r => setTimeout(r, 300));

    const body = await inbox(url, config);
    assert.deepEqual(body.agents, [], 'nothing connected and nothing held is nothing to show');

    // Forgetting it on screen is not forgetting it: the pane stays taken back.
    const again = connectAgent(url, config.token, { instanceId });
    try {
      await again.waitFor('welcome');
      again.send({ type: 'check', id: 'c-9', target: '%3' });
      const verdict = await again.waitFor('verdict', 4000, m => m.id === 'c-9');
      assert.equal(verdict.allowed, false);
    } finally {
      again.close();
    }
  });
});

test('a check is activity, and is shown with the pane it was about', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send({ type: 'grants', grants: [GRANT] });
      await new Promise(r => setTimeout(r, 200));

      const idle = await inbox(url, config);
      assert.equal(idle.agents[0].grants[0].lastActivity, null, 'nothing has happened yet');

      const before = Date.now();
      agent.send({ type: 'check', id: 'c-a', target: '%3' });
      await agent.waitFor('verdict', 4000, m => m.id === 'c-a');

      const busy = await inbox(url, config);
      const activity = busy.agents[0].grants[0].lastActivity;
      assert.ok(activity >= before, `the pane should show recent use, got ${activity}`);
    } finally {
      agent.close();
    }
  });
});

test('why a pane was handed over is kept with it', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send({ type: 'grants', grants: [{ ...GRANT, reason: 'run the suite' }] });
      await new Promise(r => setTimeout(r, 200));

      const body = await inbox(url, config);
      assert.equal(body.agents[0].grants[0].reason, 'run the suite');
    } finally {
      agent.close();
    }
  });
});

test('a suggestion travels with the request, without deciding anything', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send({ ...REQUEST, id: 'r-sug', suggested: '%5' });
      await new Promise(r => setTimeout(r, 200));

      const body = await (await fetch(`${url}/api/requests`, {
        headers: { Authorization: `Bearer ${config.token}` },
      })).json();
      assert.equal(body.requests.length, 1, 'a suggestion is not an answer; the request still waits');
      assert.equal(body.requests[0].suggested, '%5');
      assert.equal(agent.received.some(m => m.type === 'answer'), false, 'nothing may be assigned on its own');
    } finally {
      agent.close();
    }
  });
});

test('a rule bound to a directory only answers agents working there', async () => {
  await withService({}, async ({ url, config, service }) => {
    const account = localAccount(service.store);
    service.store.addPoolEntry(account.id, '%3', 'pane', true, {
      cwd: '*/Repos/foo*',
      tmuxServer: 'socket:1:100',
    });

    const elsewhere = connectAgent(url, config.token, { cwd: '/Users/frank/Repos/bar', tmuxServer: 'socket:1:100' });
    try {
      await elsewhere.waitFor('welcome');
      elsewhere.send({ ...REQUEST, id: 'r-elsewhere' });
      await new Promise(r => setTimeout(r, 300));
      assert.equal(elsewhere.received.some(m => m.type === 'answer'), false,
        'another directory must not collect this rule');
    } finally {
      elsewhere.close();
    }

    const there = connectAgent(url, config.token, { cwd: '/Users/frank/Repos/foo', tmuxServer: 'socket:1:100' });
    try {
      await there.waitFor('welcome');
      there.send({ ...REQUEST, id: 'r-there' });
      const answer = await there.waitFor('answer');
      assert.equal(answer.target, '%3');
    } finally {
      there.close();
    }
  });
});

test('a rule on a bare id is dead once that tmux server is gone', async () => {
  await withService({}, async ({ url, config, service }) => {
    const account = localAccount(service.store);
    service.store.addPoolEntry(account.id, '%3', 'pane', true, {
      cwd: '*/Repos/foo*',
      tmuxServer: 'socket:1:100',
    });

    // Same directory, but tmux restarted: %3 is not the pane it was.
    const restarted = connectAgent(url, config.token, { cwd: '/Users/frank/Repos/foo', tmuxServer: 'socket:2:200' });
    try {
      await restarted.waitFor('welcome');
      restarted.send({ ...REQUEST, id: 'r-restarted' });
      await new Promise(r => setTimeout(r, 300));
      assert.equal(restarted.received.some(m => m.type === 'answer'), false,
        'the human should be asked again rather than handed the wrong pane');
    } finally {
      restarted.close();
    }
  });
});

test('a rule without a directory keeps answering anyone, as before', async () => {
  await withService({}, async ({ url, config, service }) => {
    const account = localAccount(service.store);
    service.store.addPoolEntry(account.id, '%3', 'pane', true);

    const agent = connectAgent(url, config.token, { cwd: '/anywhere', tmuxServer: 'whatever:9:9' });
    try {
      await agent.waitFor('welcome');
      agent.send(REQUEST);
      const answer = await agent.waitFor('answer');
      assert.equal(answer.target, '%3');
    } finally {
      agent.close();
    }
  });
});

test('keeping an assignment turns it into a rule bound to that agent', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token, {
      cwd: '/Users/frank/Repos/foo',
      tmuxServer: '/private/tmp/tmux-501/default:16186:1788462695',
    });
    try {
      await agent.waitFor('welcome');
      agent.send({ type: 'grants', grants: [GRANT] });
      await new Promise(r => setTimeout(r, 200));

      const body = await inbox(url, config);
      const response = await fetch(`${url}/api/agents/${body.agents[0].id}/keep`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ target: '%3' }),
      });
      assert.equal(response.status, 200);

      const { pool } = await (await fetch(`${url}/api/pool`, {
        headers: { Authorization: `Bearer ${config.token}` },
      })).json();
      assert.equal(pool.length, 1);
      assert.equal(pool[0].pattern, '%3');
      assert.equal(pool[0].reusable, true, 'a standing rule answers every restart, not once');
      assert.equal(pool[0].cwd, '/Users/frank/Repos/foo');
      assert.equal(pool[0].tmuxServer, '/private/tmp/tmux-501/default:16186:1788462695');
    } finally {
      agent.close();
    }
  });
});

test('an assignment nobody holds cannot be kept', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token, { cwd: '/Users/frank/Repos/foo' });
    try {
      await agent.waitFor('welcome');
      agent.send({ type: 'grants', grants: [GRANT] });
      await new Promise(r => setTimeout(r, 200));

      const body = await inbox(url, config);
      const response = await fetch(`${url}/api/agents/${body.agents[0].id}/keep`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ target: '%999' }),
      });
      assert.equal(response.status, 404);
      const { error } = await response.json();
      assert.match(error, /not held/i, 'a rule may only be made from something really handed over');
    } finally {
      agent.close();
    }
  });
});

test('a stuck request can be thrown away without involving the agent', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token);
    try {
      await agent.waitFor('welcome');
      agent.send(REQUEST);
      await new Promise(r => setTimeout(r, 200));
      assert.equal((await inbox(url, config)).requests.length, 1);

      const response = await fetch(`${url}/api/requests/${REQUEST.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${config.token}` },
      });
      assert.equal(response.status, 200);
      assert.equal((await inbox(url, config)).requests.length, 0);

      // Throwing the card away is not an answer: the agent is told nothing,
      // because the point is that it is no longer listening.
      assert.equal(agent.received.some(m => m.type === 'answer'), false);
    } finally {
      agent.close();
    }
  });
});

test('a request shows which of its candidates are already handed out here', async () => {
  await withService({}, async ({ url, config }) => {
    const server = '/private/tmp/tmux-501/default:16186:1788462695';
    const busy = connectAgent(url, config.token, { cwd: '/Users/frank/Repos/foo', tmuxServer: server });
    const asking = connectAgent(url, config.token, { cwd: '/Users/frank/Repos/bar', tmuxServer: server });
    const elsewhere = connectAgent(url, config.token, {
      cwd: '/Users/frank/Repos/baz',
      tmuxServer: '/private/tmp/tmux-501/other:2:2',
    });
    try {
      await busy.waitFor('welcome');
      await elsewhere.waitFor('welcome');
      busy.send({ type: 'grants', grants: [{ ...GRANT, target: '%3' }] });
      elsewhere.send({ type: 'grants', grants: [{ ...GRANT, target: '%5' }] });
      await new Promise(r => setTimeout(r, 200));

      await asking.waitFor('welcome');
      asking.send(REQUEST);
      await new Promise(r => setTimeout(r, 200));

      const [request] = (await inbox(url, config)).requests;
      // %3 is taken on this very tmux server; %5 only looks the same but lives
      // on another one, where that number means something else entirely.
      assert.deepEqual(request.heldElsewhere, { '%3': '/Users/frank/Repos/foo' });
    } finally {
      busy.close();
      asking.close();
      elsewhere.close();
    }
  });
});

const bearer = config => ({ Authorization: `Bearer ${config.token}` });
const settle = () => new Promise(r => setTimeout(r, 250));

test('a restarted tmux server takes the machines of the old one with it', async () => {
  await withService({}, async ({ url, config }) => {
    const old = connectAgent(url, config.token, { tmuxServer: '/private/tmp/tmux-501/default:1:100' });
    await old.waitFor('welcome');
    old.send({ type: 'grants', grants: [GRANT] });
    await settle();
    old.close();
    await settle();
    assert.equal((await inbox(url, config)).agents.length, 1, 'still shown while nothing proves it gone');

    const fresh = connectAgent(url, config.token, { tmuxServer: '/private/tmp/tmux-501/default:2:200' });
    try {
      await fresh.waitFor('welcome');
      await settle();
      const ids = (await inbox(url, config)).agents.map(a => a.identity.tmuxServer);
      assert.deepEqual(ids, ['/private/tmp/tmux-501/default:2:200'],
        'same socket, later start: the old ids mean nothing any more');
    } finally {
      fresh.close();
    }
  });
});

test('a tmux server on another socket leaves other machines alone', async () => {
  await withService({}, async ({ url, config }) => {
    const old = connectAgent(url, config.token, { tmuxServer: '/private/tmp/tmux-501/default:1:100' });
    await old.waitFor('welcome');
    old.send({ type: 'grants', grants: [GRANT] });
    await settle();
    old.close();
    await settle();

    const other = connectAgent(url, config.token, { tmuxServer: '/private/tmp/tmux-501/work:2:200' });
    try {
      await other.waitFor('welcome');
      await settle();
      assert.equal((await inbox(url, config)).agents.length, 2, 'two servers side by side is normal');
    } finally {
      other.close();
    }
  });
});

test('a pane now held by a newer agent is no longer shown with a vanished one', async () => {
  await withService({}, async ({ url, config }) => {
    const server = '/private/tmp/tmux-501/default:1:100';
    const old = connectAgent(url, config.token, { cwd: '/Users/frank/Repos/foo', tmuxServer: server });
    await old.waitFor('welcome');
    old.send({ type: 'grants', grants: [GRANT] });
    await settle();
    old.close();
    await settle();

    const restarted = connectAgent(url, config.token, { cwd: '/Users/frank/Repos/foo', tmuxServer: server });
    try {
      await restarted.waitFor('welcome');
      restarted.send({ type: 'grants', grants: [GRANT] });
      await settle();
      const agents = (await inbox(url, config)).agents;
      assert.equal(agents.length, 1, 'the same pane twice is the wart this removes');
      assert.equal(agents[0].connected, true);
    } finally {
      restarted.close();
    }
  });
});

test('two connected agents claiming one pane are both shown', async () => {
  await withService({}, async ({ url, config }) => {
    const server = '/private/tmp/tmux-501/default:1:100';
    const a = connectAgent(url, config.token, { tmuxServer: server });
    const b = connectAgent(url, config.token, { tmuxServer: server });
    try {
      await a.waitFor('welcome');
      await b.waitFor('welcome');
      a.send({ type: 'grants', grants: [GRANT] });
      await settle();
      b.send({ type: 'grants', grants: [GRANT] });
      await settle();
      const holders = (await inbox(url, config)).agents.filter(x => x.grants.length > 0);
      assert.equal(holders.length, 2, 'a live conflict is for a human to see, not to hide');
    } finally {
      a.close();
      b.close();
    }
  });
});

test('a vanished machine can be forgotten, and what was revoked stays revoked', async () => {
  await withService({}, async ({ url, config }) => {
    const instanceId = randomUUID();
    const gone = connectAgent(url, config.token, { instanceId });
    await gone.waitFor('welcome');
    gone.send({ type: 'grants', grants: [GRANT, { ...GRANT, target: '%5' }] });
    await settle();
    await fetch(`${url}/api/agents/${instanceId}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer(config) },
      body: JSON.stringify({ target: '%3' }),
    });
    gone.close();
    await settle();

    const forget = await fetch(`${url}/api/agents/${instanceId}`, { method: 'DELETE', headers: bearer(config) });
    assert.equal(forget.status, 200);
    assert.deepEqual((await inbox(url, config)).agents, []);

    // It was only asleep after all.
    const back = connectAgent(url, config.token, { instanceId });
    try {
      await back.waitFor('welcome');
      back.send({ type: 'check', id: 'c-back', target: '%3' });
      const verdict = await back.waitFor('verdict', 4000, m => m.id === 'c-back');
      assert.equal(verdict.allowed, false, 'forgetting a machine must not undo a revocation');
    } finally {
      back.close();
    }
  });
});

test('a machine that is still connected cannot be forgotten', async () => {
  await withService({}, async ({ url, config }) => {
    const instanceId = randomUUID();
    const live = connectAgent(url, config.token, { instanceId });
    try {
      await live.waitFor('welcome');
      live.send({ type: 'grants', grants: [GRANT] });
      await settle();
      const forget = await fetch(`${url}/api/agents/${instanceId}`, { method: 'DELETE', headers: bearer(config) });
      assert.equal(forget.status, 409, 'it is plainly there; forgetting it would only hide it');
      assert.equal((await inbox(url, config)).agents.length, 1);
    } finally {
      live.close();
    }
  });
});

/** Read the standing rules the way the browser does. */
async function rules(url, config) {
  return (await (await fetch(`${url}/api/pool`, {
    headers: { Authorization: `Bearer ${config.token}` },
  })).json()).pool;
}

test('a fresh inventory removes only confirmed missing ids from the same machine and server', async () => {
  await withService({}, async ({ url, config, service }) => {
    const account = localAccount(service.store);
    const otherAccount = service.store.upsertAccount('other-inventory', 'Other');
    const server = '/socket:1:100';
    const bound = { host: 'test', tmuxServer: server };
    const dead = service.store.addPoolEntry(account.id, '%3', 'pane', true, bound);
    const deadWindow = service.store.addPoolEntry(account.id, '@4', 'window', true, bound);
    const alive = service.store.addPoolEntry(account.id, '%5', 'pane', true, bound);
    const pattern = service.store.addPoolEntry(account.id, '*agents:*', 'pane', true, bound);
    const elsewhere = service.store.addPoolEntry(account.id, '%3', 'pane', true, { ...bound, cwd: '/other', host: 'other-host' });
    const otherServer = service.store.addPoolEntry(account.id, '%3', 'pane', true, { ...bound, tmuxServer: '/other:1:100' });
    const unbound = service.store.addPoolEntry(account.id, '%3', 'pane', true);
    const privateRule = service.store.addPoolEntry(otherAccount.id, '%3', 'pane', true, bound);
    const vanished = connectAgent(url, config.token, { tmuxServer: server });
    const inspector = connectAgent(url, config.token, { tmuxServer: server });
    try {
      await vanished.waitFor('welcome');
      vanished.send({ type: 'grants', grants: [GRANT] });
      await new Promise(resolve => setTimeout(resolve, 100));
      vanished.close();
      await new Promise(resolve => setTimeout(resolve, 100));
      await inspector.waitFor('welcome');
      inspector.send({ type: 'inventory-changed' });
      const check = await inspector.waitFor('validate');
      assert.deepEqual(check.targets.sort(), ['%3', '%5', '@4']);

      // An id first seen after this check started must not be swept by its reply.
      const fresh = service.store.addPoolEntry(account.id, '%99', 'pane', true, bound);
      for (const reply of [
        { ...check, id: 'unsolicited', missing: ['%3'] },
        { ...check, tmuxServer: '/different:1:100', missing: ['%3'] },
        { ...check, missing: ['%3', '%99'] },
      ]) inspector.send({ ...reply, type: 'validation' });
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok((await rules(url, config)).some(rule => rule.id === dead.id));

      inspector.send({ type: 'validation', id: check.id, tmuxServer: server, missing: ['%3', '@4'] });
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.deepEqual((await rules(url, config)).map(rule => rule.id),
        [alive, pattern, elsewhere, otherServer, unbound, fresh].map(rule => rule.id));
      assert.deepEqual(service.store.listPool(otherAccount.id).map(rule => rule.id), [privateRule.id]);
      assert.equal((await inbox(url, config)).agents.flatMap(agent => agent.grants).length, 0);
      assert.equal(service.store.loadAgents().flatMap(agent => agent.grants).length, 0, 'cleanup is persisted');
      assert.ok(!(await rules(url, config)).some(rule => rule.id === deadWindow.id));
    } finally {
      vanished.close();
      inspector.close();
    }
  });
});

test('disconnecting without an inventory result preserves pinned ids', async () => {
  await withService({}, async ({ url, config, service }) => {
    const account = localAccount(service.store);
    const server = '/socket:1:100';
    const entry = service.store.addPoolEntry(account.id, '%3', 'pane', true, { host: 'test', tmuxServer: server });
    const agent = connectAgent(url, config.token, { tmuxServer: server });
    await agent.waitFor('welcome');
    agent.send({ type: 'inventory-changed' });
    await agent.waitFor('validate');
    agent.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual((await rules(url, config)).map(rule => rule.id), [entry.id]);
  });
});

test('keeping the same assignment twice leaves one rule, not two', async () => {
  await withService({}, async ({ url, config }) => {
    const agent = connectAgent(url, config.token, {
      cwd: '/Users/frank/Repos/foo',
      tmuxServer: 'socket:1:100',
    });
    try {
      await agent.waitFor('welcome');
      agent.send({ type: 'grants', grants: [GRANT] });
      await new Promise(r => setTimeout(r, 200));

      const { agents } = await inbox(url, config);
      const keep = () => fetch(`${url}/api/agents/${agents[0].id}/keep`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ target: '%3' }),
      });
      const first = await (await keep()).json();
      const second = await (await keep()).json();

      assert.equal(second.entry.id, first.entry.id, 'the second press must find the rule it already made');
      assert.equal((await rules(url, config)).length, 1);
    } finally {
      agent.close();
    }
  });
});

test('a standing rule is swept away when its tmux server restarts', async () => {
  await withService({}, async ({ url, config, service }) => {
    const account = localAccount(service.store);
    service.store.addPoolEntry(account.id, '%3', 'pane', true, {
      cwd: '/Users/frank/Repos/foo',
      tmuxServer: '/private/tmp/tmux-501/default:100:1000',
      host: 'test',
    });
    // Bound to a tmux server that is still running elsewhere: not ours to drop.
    service.store.addPoolEntry(account.id, '%9', 'pane', true, {
      cwd: '/Users/frank/Repos/foo',
      tmuxServer: '/private/tmp/tmux-501/other:100:1000',
      host: 'test',
    });
    // Another machine may well have a tmux on that same socket path, happily
    // running. A socket path is not a machine, so it is not ours to sweep.
    service.store.addPoolEntry(account.id, '%4', 'pane', true, {
      cwd: '/Users/frank/Repos/foo',
      tmuxServer: '/private/tmp/tmux-501/default:100:1000',
      host: 'other-laptop',
    });

    // Same socket, newer start time: that tmux is gone and %3 means nothing.
    const agent = connectAgent(url, config.token, {
      cwd: '/Users/frank/Repos/foo',
      tmuxServer: '/private/tmp/tmux-501/default:200:2000',
    });
    try {
      await agent.waitFor('welcome');
      await new Promise(r => setTimeout(r, 200));

      const pool = await rules(url, config);
      assert.deepEqual(pool.map(entry => entry.pattern), ['%9', '%4'],
        'only this machine\'s rule on the restarted tmux server should be swept');
    } finally {
      agent.close();
    }
  });
});

test('the pool reports whether a rule can still fire', async () => {
  await withService({}, async ({ url, config, service }) => {
    const account = localAccount(service.store);
    service.store.addPoolEntry(account.id, '%3', 'pane', true, { tmuxServer: 'socket:1:100' });
    service.store.addPoolEntry(account.id, '%7', 'pane', true, { tmuxServer: 'elsewhere:1:100' });
    service.store.addPoolEntry(account.id, '*agents:*', 'pane', true);

    const agent = connectAgent(url, config.token, { cwd: '/Users/frank/Repos/foo', tmuxServer: 'socket:1:100' });
    try {
      await agent.waitFor('welcome');
      const pool = await rules(url, config);
      const live = Object.fromEntries(pool.map(entry => [entry.pattern, entry.live]));

      assert.equal(live['%3'], true, 'an agent is connected on exactly this tmux server');
      assert.equal(live['%7'], false, 'nothing is connected on that tmux server');
      assert.equal(live['*agents:*'], null, 'a rule bound to no tmux server has nothing to report');
    } finally {
      agent.close();
    }
  });
});

test('a standing rule records when it last handed out a pane', async () => {
  await withService({}, async ({ url, config, service }) => {
    const account = localAccount(service.store);
    const before = Date.now();
    service.store.addPoolEntry(account.id, '%3', 'pane', true, { tmuxServer: 'socket:1:100' });

    const agent = connectAgent(url, config.token, { cwd: '/Users/frank/Repos/foo', tmuxServer: 'socket:1:100' });
    try {
      await agent.waitFor('welcome');
      agent.send(REQUEST);
      await agent.waitFor('answer');

      const [entry] = await rules(url, config);
      assert.ok(entry.usedAt >= before, 'a reusable rule should still say when it last fired');

      // And it keeps answering: a standing rule is not spent by being used.
      agent.send({ ...REQUEST, id: 'r-again' });
      const again = await agent.waitFor('answer', 4000, m => m.id === 'r-again');
      assert.equal(again.target, '%3');
    } finally {
      agent.close();
    }
  });
});

test('a rule shows what the agent holding its pane is doing', async () => {
  await withService({}, async ({ url, config, service }) => {
    const account = localAccount(service.store);
    service.store.addPoolEntry(account.id, '%3', 'pane', true, {
      cwd: '/Users/frank/Repos/foo',
      tmuxServer: 'socket:1:100',
    });

    const agent = connectAgent(url, config.token, { cwd: '/Users/frank/Repos/foo', tmuxServer: 'socket:1:100' });
    try {
      await agent.waitFor('welcome');
      agent.send({ type: 'grants', grants: [GRANT] });
      const before = Date.now();
      agent.send({ type: 'check', id: 'c-1', target: '%3' });
      await agent.waitFor('verdict');

      const [entry] = await rules(url, config);
      assert.ok(entry.lastActivity >= before, 'the check the agent just made is the rule\'s activity');
    } finally {
      agent.close();
    }
  });
});

test('a rule from before hosts were recorded adopts the one it is running on', async () => {
  await withService({}, async ({ url, config, service }) => {
    const account = localAccount(service.store);
    // What an older version stored: bound to a tmux server, but to no machine.
    service.store.addPoolEntry(account.id, '%3', 'pane', true, { tmuxServer: 'socket:1:100' });

    const agent = connectAgent(url, config.token, { cwd: '/Users/frank/Repos/foo', tmuxServer: 'socket:1:100' });
    try {
      await agent.waitFor('welcome');
      await new Promise(r => setTimeout(r, 200));
      const [entry] = await rules(url, config);
      assert.equal(entry.host, 'test', 'the agent running on that very server says which machine it is');
    } finally {
      agent.close();
    }
  });
});


/** Restart the actual service against one on-disk database. */
async function withPersistentService(run) {
  const directory = await mkdtemp(join(tmpdir(), 'tmux-dispatch-persistence-'));
  const config = loadConfig({ PORT: '0', DATABASE_PATH: join(directory, 'state.db'), SESSION_SECRET: 'test-secret' });
  let service = await startService(config);
  const restart = async () => {
    await service.close();
    service = await startService(config);
    return service;
  };
  try {
    await run({ service, config, restart });
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('assignments and activity are committed before shutdown and restored without pending requests', async () => {
  await withPersistentService(async ({ service, config, restart }) => {
    const instanceId = randomUUID();
    const agent = connectAgent(service.url, config.token, { instanceId });
    await agent.waitFor('welcome');
    agent.send({ type: 'grants', grants: [{ ...GRANT, reason: 'persistent assignment' }] });
    agent.send(REQUEST);
    agent.send({ type: 'check', id: 'persist-check', target: GRANT.target });
    await agent.waitFor('verdict');
    const before = await inbox(service.url, config);

    // A separate SQLite connection can read the change while the server is
    // running: durability does not depend on a graceful shutdown hook.
    const reader = new Store(config.databasePath);
    try {
      const saved = reader.loadAgents();
      assert.equal(saved.length, 1);
      assert.equal(saved[0].grants[0].reason, 'persistent assignment');
      assert.equal(saved[0].activity[0][1], before.agents[0].grants[0].lastActivity);
    } finally { reader.close(); }

    service = await restart();
    const after = await inbox(service.url, config);
    assert.equal(after.agents.length, 1);
    assert.equal(after.agents[0].id, instanceId);
    assert.equal(after.agents[0].connected, false);
    assert.deepEqual(after.agents[0].grants, before.agents[0].grants);
    assert.deepEqual(after.requests, []);

    const again = connectAgent(service.url, config.token, { instanceId });
    await again.waitFor('welcome');
    assert.equal((await inbox(service.url, config)).agents.length, 1);
    again.close();
  });
});

test('hidden revocations survive restart and still refuse the returning agent', async () => {
  await withPersistentService(async ({ service, config, restart }) => {
    const instanceId = randomUUID();
    const agent = connectAgent(service.url, config.token, { instanceId });
    await agent.waitFor('welcome');
    agent.send({ type: 'grants', grants: [GRANT] });
    agent.send({ type: 'check', id: 'before-revoke', target: GRANT.target });
    await agent.waitFor('verdict');
    const accountId = localAccount(service.store).id;
    assert.equal(service.agents.revoke(accountId, instanceId, GRANT.target), true);
    await agent.waitFor('revoke');

    service = await restart();
    assert.deepEqual((await inbox(service.url, config)).agents, []);
    assert.equal(service.agents.forget(accountId, instanceId), 'forgotten');
    service = await restart();
    const again = connectAgent(service.url, config.token, { instanceId });
    await again.waitFor('welcome');
    again.send({ type: 'grants', grants: [GRANT] });
    again.send({ type: 'check', id: 'after-restart', target: GRANT.target });
    assert.equal((await again.waitFor('verdict')).allowed, false);
    assert.deepEqual((await inbox(service.url, config)).agents[0].grants, []);

    // Once a human grants it again, the settled revocation must also stay gone.
    again.send({ type: 'grants', grants: [{ ...GRANT, since: Date.now() + 1000 }] });
    again.send({ type: 'check', id: 'reassigned', target: GRANT.target });
    assert.equal((await again.waitFor('verdict', 4000, m => m.id === 'reassigned')).allowed, true);
    service = await restart();
    const third = connectAgent(service.url, config.token, { instanceId });
    await third.waitFor('welcome');
    third.send({ type: 'check', id: 'settled', target: GRANT.target });
    assert.equal((await third.waitFor('verdict')).allowed, true);
    third.close();
  });
});

test('forgotten agents and unpaired machines do not return after restart', async () => {
  await withPersistentService(async ({ service, config, restart }) => {
    const accountId = localAccount(service.store).id;
    const { device, token } = service.store.createDevice(accountId, 'persistent-device');
    const forgottenId = randomUUID();
    const gone = connectAgent(service.url, config.token, { instanceId: forgottenId });
    const paired = connectAgent(service.url, token);
    for (const agent of [gone, paired]) {
      await agent.waitFor('welcome');
      agent.send({ type: 'grants', grants: [GRANT] });
      agent.send({ type: 'check', id: 'ready', target: GRANT.target });
      await agent.waitFor('verdict');
    }
    service = await restart();
    assert.equal((await inbox(service.url, config)).agents.length, 2);
    assert.equal(service.agents.forget(accountId, forgottenId), 'forgotten');
    service.store.revokeDevice(accountId, device.id);
    service.agents.dropDevice(device.id);
    service = await restart();
    assert.deepEqual((await inbox(service.url, config)).agents, []);
    assert.deepEqual(service.store.loadAgents(), []);
  });
});

test('a restarted tmux server still removes restored obsolete assignments', async () => {
  await withPersistentService(async ({ service, config, restart }) => {
    const old = connectAgent(service.url, config.token, { tmuxServer: '/tmp/tmux:1:100' });
    await old.waitFor('welcome');
    old.send({ type: 'grants', grants: [GRANT] });
    old.send({ type: 'check', id: 'ready', target: GRANT.target });
    await old.waitFor('verdict');
    service = await restart();
    assert.equal((await inbox(service.url, config)).agents.length, 1);
    const fresh = connectAgent(service.url, config.token, { tmuxServer: '/tmp/tmux:2:200' });
    await fresh.waitFor('welcome');
    assert.equal((await inbox(service.url, config)).agents.every(agent => agent.grants.length === 0), true);
    service = await restart();
    assert.deepEqual((await inbox(service.url, config)).agents, []);
  });
});


test('restored state belongs to its authenticated device and account', async () => {
  await withPersistentService(async ({ service, config, restart }) => {
    const accountId = localAccount(service.store).id;
    const owner = service.store.createDevice(accountId, 'owner');
    const other = service.store.createDevice(accountId, 'other');
    const instanceId = randomUUID();
    const agent = connectAgent(service.url, owner.token, { instanceId });
    await agent.waitFor('welcome');
    agent.send({ type: 'grants', grants: [GRANT] });
    agent.send({ type: 'check', id: 'ready', target: GRANT.target });
    await agent.waitFor('verdict');
    service = await restart();
    const wrongDevice = connectAgent(service.url, other.token, { instanceId });
    assert.equal((await wrongDevice.waitFor('refuse')).reason, 'unauthorized');
    assert.equal((await inbox(service.url, config)).agents[0].connected, false);

    const outsiderAccount = service.store.upsertAccount('outside', 'Outside');
    const outsider = service.store.createDevice(outsiderAccount.id, 'outside');
    const wrongAccount = connectAgent(service.url, outsider.token, { instanceId });
    assert.equal((await wrongAccount.waitFor('refuse')).reason, 'unauthorized');

    // Simulate a crash between deleting a pairing and clearing its registry rows.
    service.store.revokeDevice(accountId, owner.device.id);
    service = await restart();
    assert.deepEqual((await inbox(service.url, config)).agents, []);
  });
});
