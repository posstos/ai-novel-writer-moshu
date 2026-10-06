import { createServer, type IncomingMessage, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAIProvider } from '../openai-provider'
import { ModelDiscoveryService } from '../../services/model-discovery-service'
import { embedOpenAI } from '../../embedding'
import { createLocalModelProfileDraft } from '../../../src/shared/model-profile-draft'

const servers: Server[] = []
async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
}
async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  let content = ''
  for await (const chunk of request) content += String(chunk)
  return JSON.parse(content)
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

describe('keyless local OpenAI-compatible HTTP boundary', () => {
  it('lists installed models with no Authorization header and no inference or download request', async () => {
    const paths: string[] = []
    const baseUrl = await listen((request, response) => {
      paths.push(request.url ?? '')
      expect(request.headers.authorization).toBeUndefined()
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'local-writer:7b' }] }))
    })
    const profile = { ...createLocalModelProfileDraft({ id: 'local', purposes: ['generation'] }), baseUrl }
    expect(await new ModelDiscoveryService().discoverModels(profile)).toEqual({
      success: true, models: [{ id: 'local-writer:7b', name: 'local-writer:7b', value: 'local-writer:7b' }],
    })
    expect(paths).toEqual(['/v1/models'])
  })

  it('generates without bearer, response-format or reasoning extensions by default', async () => {
    let received: Record<string, unknown> = {}
    const baseUrl = await listen(async (request, response) => {
      expect(request.url).toBe('/v1/chat/completions')
      expect(request.headers.authorization).toBeUndefined()
      received = await bodyOf(request)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { content: 'A fictional chapter.' }, finish_reason: 'stop' }] }))
    })
    const profile = { ...createLocalModelProfileDraft({ id: 'local', purposes: ['generation'], modelName: 'writer' }), baseUrl }
    const result = await new OpenAIProvider().generate(profile, [{ role: 'user', content: 'Write a short fictional scene.' }], { temperature: undefined, maxTokens: profile.maxTokens, responseFormat: { type: 'json_object' } })
    expect(result).toMatchObject({ success: true, content: 'A fictional chapter.', finishReason: 'stop' })
    expect(received).toMatchObject({ model: 'writer', max_tokens: 2048, stream: false })
    expect(received).not.toHaveProperty('response_format')
    expect(received).not.toHaveProperty('reasoning_effort')
    expect(received).not.toHaveProperty('stream_options')
  })

  it('streams a local response without assuming optional usage or structured-output support', async () => {
    const baseUrl = await listen(async (request, response) => {
      expect(request.headers.authorization).toBeUndefined()
      const body = await bodyOf(request)
      expect(body).not.toHaveProperty('stream_options')
      expect(body).not.toHaveProperty('response_format')
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"choices":[{"delta":{"content":"Hello local"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    })
    const profile = { ...createLocalModelProfileDraft({ id: 'local', purposes: ['generation'], service: 'lmstudio', modelName: 'writer' }), baseUrl }
    const done = vi.fn(), error = vi.fn()
    await new OpenAIProvider().generateStream(profile, [], { temperature: undefined, maxTokens: profile.maxTokens, signal: new AbortController().signal, onChunk: vi.fn(), onDone: done, onError: error })
    expect(error).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledWith('Hello local', undefined, 'stop')
  })

  it('retains explicit credentials and opt-in local structured-output support', async () => {
    const baseUrl = await listen(async (request, response) => {
      expect(request.headers.authorization).toBe('Bearer local-test-key')
      expect(await bodyOf(request)).toHaveProperty('response_format', { type: 'json_object' })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }))
    })
    const profile = createLocalModelProfileDraft({ id: 'local', purposes: ['generation'], modelName: 'writer' })
    const result = await new OpenAIProvider().generate({ ...profile, baseUrl, apiKey: 'local-test-key', capabilities: { ...profile.capabilities!, structuredOutput: true } }, [], { temperature: undefined, maxTokens: profile.maxTokens, responseFormat: { type: 'json_object' } })
    expect(result.success).toBe(true)
  })

  it('embeds locally without a fabricated API key', async () => {
    const baseUrl = await listen(async (request, response) => {
      expect(request.url).toBe('/v1/embeddings')
      expect(request.headers.authorization).toBeUndefined()
      expect(await bodyOf(request)).toMatchObject({ model: 'local-embedding', input: ['fictional text'] })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }] }))
    })
    expect(await embedOpenAI(['fictional text'], { baseUrl, apiKey: '', modelName: 'local-embedding' })).toEqual([[0.1, 0.2]])
  })

  it('reports an empty list separately from a server failure', async () => {
    const baseUrl = await listen((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ data: [] }))
    })
    const profile = { ...createLocalModelProfileDraft({ id: 'local', purposes: ['generation'] }), baseUrl }
    expect(await new ModelDiscoveryService().discoverModels(profile)).toEqual({ success: false, errorCode: 'empty' })
  })

  it('returns local HTTP failures without retrying another model or endpoint', async () => {
    let requests = 0
    const baseUrl = await listen((_request, response) => { requests++; response.writeHead(404); response.end('Model not installed') })
    const profile = { ...createLocalModelProfileDraft({ id: 'local', purposes: ['generation'], modelName: 'missing' }), baseUrl }
    expect(await new OpenAIProvider().generate(profile, [], { temperature: undefined, maxTokens: profile.maxTokens })).toMatchObject({ success: false, finishReason: 'error' })
    expect(requests).toBe(1)
  })
})
