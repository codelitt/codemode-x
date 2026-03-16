#!/usr/bin/env node
/**
 * Minimal MCP server fixture for testing the MCP Bridge adapter.
 * Exposes 3 tools: echo, add, list_items.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'echo-test-server',
  version: '1.0.0',
});

// A simple echo tool (read-only by nature)
server.tool(
  'get_echo',
  'Echo back the input message',
  { message: z.string().describe('The message to echo back') },
  async ({ message }) => ({
    content: [{ type: 'text', text: JSON.stringify({ echoed: message }) }],
  }),
);

// A math tool (read-only)
server.tool(
  'add_numbers',
  'Add two numbers together',
  {
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  },
  async ({ a, b }) => ({
    content: [{ type: 'text', text: JSON.stringify({ result: a + b }) }],
  }),
);

// A write tool (name implies mutation)
server.tool(
  'create_item',
  'Create a new item',
  {
    name: z.string().describe('Item name'),
    category: z.string().optional().describe('Item category'),
  },
  async ({ name, category }) => ({
    content: [{ type: 'text', text: JSON.stringify({ id: '123', name, category: category ?? 'default' }) }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
