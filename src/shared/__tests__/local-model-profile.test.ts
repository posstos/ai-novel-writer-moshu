import { describe, expect, it } from 'vitest'
import { createModelProfileDraft } from '../model-profile-draft'
import { hasModelConnectionFields, isLoopbackModelEndpoint, isModelApiKeyOptional, optionalBearerAuthorization } from '../local-model-profile'

describe('local endpoint policy', () => {
  it.each(['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8000/v1', 'http://127.1.2.3:8000/v1'])('recognizes loopback %s', url => {
    expect(isLoopbackModelEndpoint(url)).toBe(true)
  })

  it.each(['https://localhost.example.com/v1', 'https://example.com/localhost', 'https://127.0.0.1.example/v1', 'file:///localhost', 'invalid', 'http://secret@localhost:11434/v1'])('does not mistake a remote or unsafe URL for loopback: %s', url => {
    expect(isLoopbackModelEndpoint(url)).toBe(false)
  })

  it('allows keyless custom local endpoints without relaxing cloud or Gemini requirements', () => {
    const model = { ...createModelProfileDraft({ id: 'local', purposes: ['generation'] }), provider: 'custom' as const, modelName: 'installed-model', baseUrl: 'http://127.0.0.1:1234/v1' }
    expect(hasModelConnectionFields(model)).toBe(true)
    expect(isModelApiKeyOptional(model)).toBe(true)
    expect(hasModelConnectionFields({ ...model, baseUrl: 'https://example.com/v1' })).toBe(false)
    expect(hasModelConnectionFields({ ...model, protocol: 'gemini' })).toBe(false)
    expect(hasModelConnectionFields({ ...model, modelName: '  ' })).toBe(false)
    expect(hasModelConnectionFields({ ...model, baseUrl: 'not-a-url', apiKey: 'key' })).toBe(false)
    expect(hasModelConnectionFields({ ...model, baseUrl: 'https://example.com/v1', apiKey: 'key' })).toBe(true)
  })

  it('preserves explicit keyless Ollama LAN support', () => {
    const model = { ...createModelProfileDraft({ id: 'lan', purposes: ['generation'] }), modelName: 'installed', baseUrl: 'http://192.168.1.20:11434/v1' }
    expect(hasModelConnectionFields(model)).toBe(true)
    expect(isLoopbackModelEndpoint(model.baseUrl)).toBe(false)
  })

  it('omits empty bearer headers but preserves supplied credentials', () => {
    expect(optionalBearerAuthorization('')).toEqual({})
    expect(optionalBearerAuthorization('  ')).toEqual({})
    expect(optionalBearerAuthorization('test-key')).toEqual({ Authorization: 'Bearer test-key' })
  })
})
