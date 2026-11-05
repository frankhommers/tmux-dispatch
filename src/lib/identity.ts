import type { AgentIdentity } from '@/lib/api';
import { projectName } from '@/lib/format';

/** What the agent calls itself: the MCP client name, else the raw client. */
export function clientName(identity: AgentIdentity | null | undefined): string {
  return identity?.mcpClient || identity?.client || 'Agent';
}

export function projectOf(identity: AgentIdentity | null | undefined): string | null {
  return identity?.cwd ? projectName(identity.cwd) : null;
}
