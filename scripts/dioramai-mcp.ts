import { DEFAULT_BRIDGE_PORT } from '@dioramai/local-bridge';
import { DIORAMAI_MCP_TOOL_DEFINITIONS } from '@dioramai/mcp';

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

const port = Number(process.env.DIORAMAI_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT);
const bridgeUrl = `http://127.0.0.1:${port}`;

const tools = DIORAMAI_MCP_TOOL_DEFINITIONS;

const writeResponse = (id: JsonRpcId | undefined, result: unknown): void => {
  if (id === undefined) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
};

const writeError = (id: JsonRpcId | undefined, code: number, message: string): void => {
  if (id === undefined) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
};

const bridgeFetch = async (toolName: string, args: unknown): Promise<unknown> => {
  const response = await fetch(`${bridgeUrl}/tools/${encodeURIComponent(toolName)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.DIORAMAI_BRIDGE_TOKEN ? { 'x-dioramai-token': process.env.DIORAMAI_BRIDGE_TOKEN } : {}),
    },
    body: JSON.stringify(args ?? {}),
  });
  return response.json() as Promise<unknown>;
};

const ensureBridge = async (): Promise<void> => {
  try {
    const health = await fetch(`${bridgeUrl}/health`);
    if (health.ok) return;
  } catch {
    // The MCP adapter is intentionally a bridge proxy only.
  }
  throw new Error(`Dioramai MCP requires a running local bridge at ${bridgeUrl}. Start it with: npx dioramai dev`);
};

const toolResult = (payload: unknown) => {
  const isError = typeof payload === 'object' && payload !== null && 'ok' in payload && (payload as { ok: unknown }).ok === false;
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    isError,
  };
};

const handleRequest = async (request: JsonRpcRequest): Promise<void> => {
  switch (request.method) {
    case 'initialize':
      writeResponse(request.id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'dioramai',
          version: '0.1.0',
        },
      });
      return;
    case 'notifications/initialized':
      return;
    case 'ping':
      writeResponse(request.id, {});
      return;
    case 'tools/list':
      writeResponse(request.id, { tools });
      return;
    case 'tools/call': {
      const name = typeof request.params?.name === 'string' ? request.params.name : '';
      const args = request.params?.arguments ?? {};
      if (!tools.some((tool) => tool.name === name)) {
        writeResponse(request.id, toolResult({ ok: false, error: { code: 'TOOL_NOT_FOUND', message: `Unknown tool: ${name}` } }));
        return;
      }
      const payload = await bridgeFetch(name, args);
      writeResponse(request.id, toolResult(payload));
      return;
    }
    default:
      writeError(request.id, -32601, `Method not found: ${request.method}`);
  }
};

const run = async (): Promise<void> => {
  await ensureBridge();
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (line.length === 0) continue;
      void Promise.resolve()
        .then(() => handleRequest(JSON.parse(line) as JsonRpcRequest))
        .catch((error) => writeError(undefined, -32603, error instanceof Error ? error.message : String(error)));
    }
  });
};

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
