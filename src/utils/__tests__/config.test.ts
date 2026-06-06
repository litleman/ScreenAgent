import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
    delete process.env.SCREEN_AGENT_TIMEOUT
    delete process.env.SCREEN_AGENT_POLL_INTERVAL
    delete process.env.SCREEN_AGENT_PYTHON
    delete process.env.SCREEN_AGENT_LOG_LEVEL
    delete process.env.SCREEN_AGENT_CACHE_TTL
  vi.resetModules()
})

describe('config', () => {

  it('默认配置有合理的值', async () => {
    const { config } = await import('../config.js')
    expect(config.pythonPath).toBe('python')
    expect(config.defaultTimeout).toBe(60000)
    expect(config.pollInterval).toBe(500)
    expect(config.visionScriptPath).toContain('omniparser.py')
    expect(config.uiaScriptPath).toContain('uia_bridge.py')
    expect(config.cacheEnabled).toBe(true)
    expect(config.cacheTtl).toBe(500)
  })

  it('SCREEN_AGENT_TIMEOUT=0 不会回退到默认值', async () => {
    process.env.SCREEN_AGENT_TIMEOUT = '0'
    process.env.SCREEN_AGENT_POLL_INTERVAL = '0'
    const { config } = await import('../config.js')
    expect(config.defaultTimeout).toBe(0)
    expect(config.pollInterval).toBe(0)
  })

  it('环境变量能覆盖 pythonPath', async () => {
    process.env.SCREEN_AGENT_PYTHON = 'python3.12'
    const { config } = await import('../config.js')
    expect(config.pythonPath).toBe('python3.12')
  })

  it('logLevel 环境变量生效', async () => {
    process.env.SCREEN_AGENT_LOG_LEVEL = 'error'
    const { config } = await import('../config.js')
    expect(config.logLevel).toBe('error')
  })
})
