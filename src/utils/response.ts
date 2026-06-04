import type { ToolHandler } from './types.js'

export interface McpResponse {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

export function success(data: Record<string, unknown>, pretty = true): McpResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, pretty ? 2 : undefined) }],
  }
}

export function error(message: string, extra?: Record<string, unknown>): McpResponse {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: false, error: message, ...extra }, null, 2),
    }],
    isError: true,
  }
}

export function wrapHandler(fn: (args: Record<string, unknown>) => Promise<McpResponse>): ToolHandler {
  return async (args) => {
    try {
      return await fn(args)
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err))
    }
  }
}
