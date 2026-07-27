#!/usr/bin/env node
/**
 * AsteronEngine MCP — stdio server that talks to the live Electron agent HTTP API.
 * Discovery: ~/.asteron/agent.json (written when AsteronEngine starts).
 * Logs must go to stderr only (stdout is JSON-RPC).
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const DISCOVERY_PATH = join(homedir(), '.asteron', 'agent.json');

/** @typedef {{ host?: string, port: number, token: string, pid?: number }} AgentDiscovery */

async function readDiscovery() {
  try {
    const raw = await readFile(DISCOVERY_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (
      typeof data?.port !== 'number'
      || typeof data?.token !== 'string'
      || !data.token
    ) {
      return null;
    }
    return /** @type {AgentDiscovery} */ (data);
  } catch {
    return null;
  }
}

/**
 * @param {string} method
 * @param {string} path
 * @param {Record<string, unknown>} [body]
 * @param {Record<string, string | number | boolean | undefined>} [query]
 */
async function agentFetch(method, path, body, query) {
  const discovery = await readDiscovery();
  if (!discovery) {
    return {
      error: 'editor_unavailable',
      message:
        `AsteronEngine is not running (missing ${DISCOVERY_PATH}). Start with npm run editor:dev or npm run editor.`,
    };
  }

  const host = typeof discovery.host === 'string' ? discovery.host : '127.0.0.1';
  const url = new URL(`http://${host}:${discovery.port}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${discovery.token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    return {
      error: 'editor_unavailable',
      message:
        `Cannot reach AsteronEngine agent at ${url.origin}: ${
          error instanceof Error ? error.message : String(error)
        }`,
    };
  }

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    return {
      error: 'bad_response',
      message: `Non-JSON agent response (${response.status}): ${text.slice(0, 400)}`,
    };
  }

  if (!response.ok) {
    return {
      error: typeof payload.error === 'string' ? payload.error : 'agent_error',
      message:
        typeof payload.message === 'string'
          ? payload.message
          : `Agent HTTP ${response.status}`,
      status: response.status,
      details: payload,
    };
  }
  return payload;
}

function textResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function imageResult(payload) {
  const { data, mimeType, ...meta } = payload;
  if (typeof data !== 'string' || typeof mimeType !== 'string') {
    return textResult(payload);
  }
  return {
    content: [
      { type: 'image', mimeType, data },
      { type: 'text', text: JSON.stringify(meta, null, 2) },
    ],
  };
}

const server = new McpServer({
  name: 'asteron-engine',
  version: '1.0.0',
});

server.registerTool(
  'session',
  {
    description:
      'AsteronEngine session: project root, name, backendUrl, hub vs editor boot, and live dirty/tab/play state.',
    inputSchema: {},
  },
  async () => textResult(await agentFetch('GET', '/agent/v1/session')),
);

server.registerTool(
  'open_document',
  {
    description:
      'Live open scene/prefab document (unsaved edits included): type, id, name, kind, isolation breadcrumb.',
    inputSchema: {},
  },
  async () => textResult(await agentFetch('GET', '/agent/v1/open_document')),
);

server.registerTool(
  'hierarchy',
  {
    description:
      'Capped hierarchy summary of the open document (id, name, component types).',
    inputSchema: {
      depth: z.number().int().min(0).max(32).optional().describe('Max child depth (default 8)'),
      limit: z.number().int().min(1).max(2000).optional().describe('Max nodes (default 400)'),
    },
  },
  async ({ depth, limit }) =>
    textResult(await agentFetch('GET', '/agent/v1/hierarchy', undefined, { depth, limit })),
);

server.registerTool(
  'selection',
  {
    description: 'Current entity selection and optional GLB sub-selection (node name).',
    inputSchema: {},
  },
  async () => textResult(await agentFetch('GET', '/agent/v1/selection')),
);

server.registerTool(
  'entity',
  {
    description: 'Full detail for one entity in the open document (transform, components, GLB overrides).',
    inputSchema: {
      id: z.string().describe('Entity id'),
    },
  },
  async ({ id }) => textResult(await agentFetch('GET', '/agent/v1/entity', undefined, { id })),
);

server.registerTool(
  'play_state',
  {
    description: 'In-editor Play status: playing, paused, active tab, open document id.',
    inputSchema: {},
  },
  async () => textResult(await agentFetch('GET', '/agent/v1/play_state')),
);

server.registerTool(
  'capture_viewport',
  {
    description:
      'Screenshot the active 3D view (Scene/Ship viewport while editing, Play host while playing). Returns JPEG image content plus metadata.',
    inputSchema: {
      maxWidth: z
        .number()
        .int()
        .min(320)
        .max(1920)
        .optional()
        .describe('Max image width in pixels (default 1280)'),
    },
  },
  async ({ maxWidth }) => {
    const payload = await agentFetch('GET', '/agent/v1/capture_viewport', undefined, {
      maxWidth,
    });
    if (payload && typeof payload === 'object' && 'error' in payload) {
      return textResult(payload);
    }
    return imageResult(payload);
  },
);

server.registerTool(
  'list_scenes',
  {
    description: 'List scene documents on disk in the open project.',
    inputSchema: {},
  },
  async () => textResult(await agentFetch('GET', '/agent/v1/list_scenes')),
);

server.registerTool(
  'list_prefabs',
  {
    description: 'List prefab documents on disk in the open project.',
    inputSchema: {},
  },
  async () => textResult(await agentFetch('GET', '/agent/v1/list_prefabs')),
);

server.registerTool(
  'get_scene',
  {
    description: 'Read a saved scene document from disk by id (may differ from dirty open doc).',
    inputSchema: {
      id: z.string().describe('Scene id'),
    },
  },
  async ({ id }) => textResult(await agentFetch('GET', '/agent/v1/get_scene', undefined, { id })),
);

server.registerTool(
  'get_prefab',
  {
    description: 'Read a saved prefab document from disk by id (may differ from dirty open doc).',
    inputSchema: {
      id: z.string().describe('Prefab id'),
    },
  },
  async ({ id }) => textResult(await agentFetch('GET', '/agent/v1/get_prefab', undefined, { id })),
);

server.registerTool(
  'play',
  {
    description: 'Start in-editor Play (same as F6 / menu Play) if not already playing.',
    inputSchema: {},
  },
  async () => textResult(await agentFetch('POST', '/agent/v1/play')),
);

server.registerTool(
  'stop_play',
  {
    description: 'Stop in-editor Play.',
    inputSchema: {},
  },
  async () => textResult(await agentFetch('POST', '/agent/v1/stop_play')),
);

server.registerTool(
  'save',
  {
    description: 'Save the current editor document / active tab (same as File → Save).',
    inputSchema: {},
  },
  async () => textResult(await agentFetch('POST', '/agent/v1/save')),
);

server.registerTool(
  'select_entity',
  {
    description: 'Select an entity by id; optionally sub-select a GLB node by name.',
    inputSchema: {
      id: z.string().describe('Entity id'),
      nodeName: z.string().optional().describe('GLB node name for sub-selection'),
    },
  },
  async ({ id, nodeName }) =>
    textResult(await agentFetch('POST', '/agent/v1/select_entity', { id, nodeName })),
);

server.registerTool(
  'open_document_by_id',
  {
    description: 'Open a scene or prefab by id in the editor workspace (may prompt on dirty docs).',
    inputSchema: {
      id: z.string().describe('Document id'),
      documentType: z
        .enum(['scene', 'prefab'])
        .optional()
        .describe('Defaults to scene'),
    },
  },
  async ({ id, documentType }) =>
    textResult(
      await agentFetch('POST', '/agent/v1/open_document_by_id', {
        id,
        documentType: documentType ?? 'scene',
      }),
    ),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[asteron-mcp] listening on stdio; discovery ${DISCOVERY_PATH}`);
}

main().catch((error) => {
  console.error('[asteron-mcp] fatal:', error);
  process.exit(1);
});
