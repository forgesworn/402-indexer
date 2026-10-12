import { EventEmitter } from 'node:events'
import { describe,it,expect,vi,beforeEach } from 'vitest'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { readStorageDescription } from '../src/storage.js'
vi.mock('node:dns/promises',() => ({lookup:vi.fn()}))
vi.mock('node:https',() => ({request:vi.fn()}))
beforeEach(() => vi.resetAllMocks())
function response(status = 200,body = '{"ok":true}',type = 'application/json') {
  vi.mocked(lookup).mockResolvedValue([{address:'8.8.8.8',family:4}] as never)
  vi.mocked(request).mockImplementation((...args: unknown[]) => {
    const req = new EventEmitter() as EventEmitter & {end(): void}
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter() as EventEmitter & {statusCode:number;headers:object;destroy(error?:Error):void}
      res.statusCode = status; res.headers = {'content-type':type}
      res.destroy = error => { if (error) res.emit('error',error) }
      ;(args[2] as (r: typeof res) => void)(res)
      res.emit('data',Buffer.from(body));res.emit('end')
    })
    return req as never
  })
}
describe('storage inspection transport',() => {
  it('pins the validated address while retaining the original HTTPS hostname and GET-only path',async () => {
    response()
    expect(await readStorageDescription('https://storage.example/services/v1')).toEqual({ok:true})
    const [target,options] = vi.mocked(request).mock.calls[0] as unknown as [URL,{method:string;signal:AbortSignal;headers:object;lookup:Function}]
    expect(target.hostname).toBe('storage.example'); expect(options.method).toBe('GET')
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options.headers).not.toHaveProperty('Authorization')
    const callback = vi.fn();options.lookup('storage.example',{},callback)
    expect(callback).toHaveBeenCalledWith(null,'8.8.8.8',4)
    const all = vi.fn();options.lookup('storage.example',{all:true},all)
    expect(all).toHaveBeenCalledWith(null,[{address:'8.8.8.8',family:4}])
  })
  it('refuses mixed public/private DNS before making any socket request',async () => {
    vi.mocked(lookup).mockResolvedValue([{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}] as never)
    await expect(readStorageDescription('https://storage.example/services/v1')).rejects.toThrow(/Blocked/)
    expect(request).not.toHaveBeenCalled()
  })
  it('refuses redirects, non-JSON, malformed and oversized responses',async () => {
    for (const [status,body,type] of [[302,'{}','application/json'],[200,'{}','text/html'],[200,'bad','application/json'],[200,'x'.repeat(65537),'application/json']] as const) {
      response(status,body,type)
      await expect(readStorageDescription('https://storage.example/services/v1')).rejects.toThrow()
    }
  })
  it('refuses onion, insecure, credentialled and non-inspection URLs before DNS',async () => {
    for (const url of ['http://storage.example/services/v1','https://example.onion/services/v1','https://user:pass@storage.example/services/v1','https://storage.example/checkout/v1/orders','https://storage.example/services/v1?q=x'])
      await expect(readStorageDescription(url)).rejects.toThrow(/Unsupported/)
    expect(lookup).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled()
  })
})
