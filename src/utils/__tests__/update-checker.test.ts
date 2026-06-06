import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  readCache,
  writeCache,
  isCacheValid,
  showWindowsNotification,
  fetchLatestVersion,
  checkForUpdate,
  type UpdateCache,
} from '../update-checker.js'
import https from 'https'
import { exec } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { logger } from '../logger.js'

vi.mock('child_process')
vi.mock('fs')
vi.mock('https')
vi.mock('../config.js', () => ({ APP_VERSION: '0.2.0' }))

describe('isCacheValid', () => {
  it('null 缓存返回 false', () => {
    expect(isCacheValid(null)).toBe(false)
  })

  it('无效格式返回 false', () => {
    const cache = { latestVersion: '0.1.3', checkedAt: 0 } as UpdateCache
    expect(isCacheValid(cache)).toBe(false)
  })

  it('24h 内有效', () => {
    const cache: UpdateCache = { latestVersion: '0.1.3', checkedAt: Date.now() - 1000 }
    expect(isCacheValid(cache)).toBe(true)
  })

  it('超过 24h 无效', () => {
    const cache: UpdateCache = { latestVersion: '0.1.3', checkedAt: Date.now() - 25 * 60 * 60 * 1000 }
    expect(isCacheValid(cache)).toBe(false)
  })
})

describe('readCache / writeCache', () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReset()
    vi.mocked(writeFileSync).mockReset()
    vi.mocked(mkdirSync).mockReset()
  })

  it('读取有效缓存', () => {
    vi.mocked(readFileSync).mockReturnValue('{"latestVersion":"0.2.0","checkedAt":1000}')
    const result = readCache()
    expect(result).toEqual({ latestVersion: '0.2.0', checkedAt: 1000 })
  })

  it('文件不存在返回 null', () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
    expect(readCache()).toBeNull()
  })

  it('写缓存创建目录', () => {
    vi.mocked(writeFileSync).mockReturnValue(undefined)
    vi.mocked(mkdirSync).mockReturnValue(undefined)
    writeCache({ latestVersion: '0.2.0', checkedAt: 1000 })
    expect(mkdirSync).toHaveBeenCalled()
    expect(writeFileSync).toHaveBeenCalled()
  })
})

describe('showWindowsNotification', () => {
  beforeEach(() => {
    vi.mocked(exec).mockReset()
  })

  it('调用 exec 执行 PowerShell', () => {
    vi.mocked(exec).mockImplementation((_cmd: string, _opts: any, cb: any) => {
      if (cb) cb(null, '', '')
      return {} as any
    })
    showWindowsNotification('0.2.0')
    expect(exec).toHaveBeenCalled()
    const cmd = vi.mocked(exec).mock.calls[0][0] as string
    expect(cmd).toContain('powershell')
    expect(cmd).toContain('0.2.0')
  })

  it('非 semver 版本不会执行命令', () => {
    showWindowsNotification('; rm -rf /')
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('fetchLatestVersion', () => {
  beforeEach(() => {
    vi.mocked(https.get).mockReset()
  })

  it('成功解析版本号', async () => {
    const mockReq = { on: vi.fn(), destroy: vi.fn() }
    const mockRes = {
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'data') cb('{"version":"0.2.0"}')
        if (event === 'end') cb()
        return mockRes
      }),
    }
    vi.mocked(https.get).mockImplementation((_url: any, _opts: any, cb?: any) => {
      if (cb) cb(mockRes)
      return mockReq as any
    })
    const result = await fetchLatestVersion()
    expect(result).toBe('0.2.0')
  })

  it('JSON 解析失败返回 null', async () => {
    const mockReq = { on: vi.fn(), destroy: vi.fn() }
    const mockRes = {
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'data') cb('invalid json')
        if (event === 'end') cb()
        return mockRes
      }),
    }
    vi.mocked(https.get).mockImplementation((_url: any, _opts: any, cb?: any) => {
      if (cb) cb(mockRes)
      return mockReq as any
    })
    const result = await fetchLatestVersion()
    expect(result).toBeNull()
  })

  it('网络超时返回 null', async () => {
    const mockReq = { on: vi.fn(), destroy: vi.fn() }
    vi.mocked(https.get).mockImplementation((_url: any, _opts: any, _cb?: any) => {
      return mockReq as any
    })

    const promise = fetchLatestVersion()

    const timeoutCb = mockReq.on.mock.calls.find((c: any[]) => c[0] === 'timeout')?.[1]
    expect(timeoutCb).toBeDefined()
    timeoutCb()

    await expect(promise).resolves.toBeNull()
    expect(mockReq.destroy).toHaveBeenCalled()
  })
})

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReset()
    vi.mocked(writeFileSync).mockReset()
    vi.mocked(mkdirSync).mockReset()
    vi.mocked(https.get).mockReset()
    vi.mocked(exec).mockReset()
  })

  it('缓存有效时跳过检查和通知', async () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      latestVersion: '0.1.3',
      checkedAt: Date.now(),
    }))
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    await checkForUpdate()
    expect(infoSpy).not.toHaveBeenCalled()
    expect(https.get).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
    infoSpy.mockRestore()
  })

  it('有更新时打印日志（非 Windows 不弹窗）', async () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(writeFileSync).mockReturnValue(undefined)
    vi.mocked(mkdirSync).mockReturnValue(undefined)
    vi.mocked(exec).mockImplementation((_cmd: string, _opts: any, cb: any) => {
      if (cb) cb(null, '', '')
      return {} as any
    })

    const mockReq = { on: vi.fn(), destroy: vi.fn() }
    const mockRes = {
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'data') cb('{"version":"9.9.9"}')
        if (event === 'end') cb()
        return mockRes
      }),
    }
    vi.mocked(https.get).mockImplementation((_url: any, _opts: any, cb?: any) => {
      if (cb) cb(mockRes)
      return mockReq as any
    })

    const origPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })

    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    await checkForUpdate()

    expect(infoSpy).toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()

    Object.defineProperty(process, 'platform', { value: origPlatform })
    infoSpy.mockRestore()
  })

  it('无更新时仅写缓存不通知', async () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(writeFileSync).mockReturnValue(undefined)
    vi.mocked(mkdirSync).mockReturnValue(undefined)

    const mockReq = { on: vi.fn(), destroy: vi.fn() }
    const mockRes = {
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'data') cb('{"version":"0.2.0"}')
        if (event === 'end') cb()
        return mockRes
      }),
    }
    vi.mocked(https.get).mockImplementation((_url: any, _opts: any, cb?: any) => {
      if (cb) cb(mockRes)
      return mockReq as any
    })

    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    await checkForUpdate()

    expect(infoSpy).not.toHaveBeenCalled()
    expect(writeFileSync).toHaveBeenCalled()
    infoSpy.mockRestore()
  })
})
