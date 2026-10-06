import { describe, expect, it } from 'vitest'
import { parseManagedDownloadSource, validateManagedSpec } from '../managed-local'
import { changeModelProfileProvider } from '../model-profile-draft'

const valid = { engine: 'llamacpp' as const, modelId: '12345678-1234-1234-1234-123456789abc', contextSize: 4096, device: 'auto' as const }
describe('managed local boundary values', () => {
  it('accepts a bounded engine selection without preserving extra executable fields', () => {
    expect(validateManagedSpec({ ...valid, command: 'untrusted.exe' })).toEqual(valid)
  })
  it.each([
    { engine: 'powershell' }, { modelId: '../secret' }, { modelId: 'x' }, { device: 'remote' },
    { contextSize: 0 }, { contextSize: -1 }, { contextSize: 999999 }, { contextSize: 4096.5 }, { contextSize: '4096' },
  ])('rejects invalid input %j', invalid => expect(() => validateManagedSpec({ ...valid, ...invalid })).toThrow())
  it('leaves the publisher share link genuinely unconfigured', () => {
    expect(parseManagedDownloadSource({ url: '', extractionCode: '' })).toEqual({ configured: false, url: '', extractionCode: '' })
  })
  it('allows only an explicit Quark HTTPS share-page intent', () => {
    expect(parseManagedDownloadSource({ url: 'https://pan.quark.cn/s/example123', extractionCode: 'abcd' })).toEqual({ configured: true, url: 'https://pan.quark.cn/s/example123', extractionCode: 'abcd' })
  })
  it.each([
    'javascript:alert(1)', 'file:///C:/Windows/notepad.exe', 'http://pan.quark.cn/s/example',
    'https://pan.quark.cn.evil.example/s/example', 'https://evil.example/s/example',
    'https://user:password@pan.quark.cn/s/example', 'https://pan.quark.cn:8443/s/example',
    'https://pan.quark.cn/login', 'https://pan.quark.cn/s/../../login',
  ])('rejects unsafe share URL %s', url => expect(() => parseManagedDownloadSource({ url })).toThrow())
  it('rejects control characters in extraction codes', () => {
    expect(() => parseManagedDownloadSource({ url: 'https://pan.quark.cn/s/example', extractionCode: 'abc\n' + 'd' })).toThrow()
  })
  it('clears the engine marker when explicitly switching to another provider', () => {
    const result = changeModelProfileProvider({ id: 'test', name: '', provider: 'custom', protocol: 'openai', modelName: 'local', apiKey: 'old', baseUrl: 'http://127.0.0.1:1234/v1', temperature: 0.7, maxTokens: 1024, purposes: ['generation'], managedLocal: valid }, 'openai')
    expect(result.managedLocal).toBeUndefined()
    expect(result.apiKey).toBe('')
  })
})
