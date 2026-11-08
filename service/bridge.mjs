import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export async function makeMcpHandler(runtime, identify, forward) {
  const require = createRequire(resolve(runtime, 'package.json'));
  const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
  const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const { z } = require('zod');
  return async (request, response, body) => {
    if (!identify(request.headers.authorization)) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Authentication required' } }));
      return;
    }
    const server = new McpServer({ name: 'contextledger', version: '1.0.0' });
    server.registerTool('get_authoritative_context', {
      description: 'Find verified Northstar Labs knowledge and citations. Reports abstention or unresolved conflicts.',
      inputSchema: { question: z.string().trim().min(3).max(300) },
      annotations: { readOnlyHint: true, idempotentHint: true }
    }, async ({ question }) => {
      const result = await forward('context', request.headers.authorization, { question });
      return { content: [{ type: 'text', text: JSON.stringify(result.body) }], isError: result.status >= 400 };
    });
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } finally {
      await server.close();
    }
  };
}
