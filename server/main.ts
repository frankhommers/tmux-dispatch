import { loadConfig } from './config.js';
import { startService } from './http.js';

const config = loadConfig();
const service = await startService(config);

console.log(`tmux-dispatch listening on :${service.port} (auth: ${config.authMode})`);
if (config.authMode === 'token') {
  console.log(`Open ${config.publicUrl}/?t=${config.token}`);
}
console.log(`Agents connect to ${config.publicUrl.replace(/^http/, 'ws')}/agent`);

const shutdown = () => { void service.close().then(() => process.exit(0)); };
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
