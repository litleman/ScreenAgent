import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { logger } from './utils/logger.js'
import { config } from './utils/config.js'

import { discoverSchema, discoverHandler } from './tools/discover.js'
import { actSchema, actHandler } from './tools/act.js'
import { visionSchema, visionHandler } from './tools/vision.js'
import {
  waitForElementSchema,
  waitForStableSchema,
  waitForElementHandler,
  waitForStableHandler,
} from './tools/wait.js'

const server = new McpServer({
  name: 'screen-agent',
  version: '0.1.0',
  description: 'Universal desktop GUI vision-agent — see, understand, and operate any software on Windows',
})

server.tool(
  'screen_discover',
  'Scan the current screen and return all interactive UI elements (OCR + UIA)',
  discoverSchema,
  discoverHandler,
)

server.tool(
  'screen_act',
  'Click, type, press keys, or hover on UI elements by label or coordinates',
  actSchema,
  actHandler,
)

server.tool(
  'screen_vision',
  'Analyze the current screen — get OCR text, element positions, and focus info',
  visionSchema,
  visionHandler,
)

server.tool(
  'screen_wait_for_element',
  'Wait until a specific UI element appears on screen',
  waitForElementSchema,
  waitForElementHandler,
)

server.tool(
  'screen_wait_for_stable',
  'Wait until the screen stops changing (loading/spinner finished)',
  waitForStableSchema,
  waitForStableHandler,
)

async function main() {
  logger.info(`Screen Agent starting (logLevel=${config.logLevel})`)
  logger.info(`Python: ${config.pythonPath}`)
  logger.info(`Vision script: ${config.visionScriptPath}`)

  const transport = new StdioServerTransport()
  await server.connect(transport)

  logger.info('Screen Agent MCP server running on stdio')
}

main().catch((err) => {
  logger.error('Fatal error', err)
  process.exit(1)
})
