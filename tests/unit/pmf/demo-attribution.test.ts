import { describe, expect, it, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readDemoToken, stageSignupDemo, retrySignupDemo } from '@/lib/pmf/demo-attribution'
const actor='11111111-1111-4111-8111-111111111111',company='22222222-2222-4222-8222-222222222222'
function request(cookie='__ops_demo='+'a'.repeat(43)) {return new Request('https://app.opsapp.co/api/setup/progress',{headers:{cookie,origin:'https://app.opsapp.co'}})}
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
describe('server demo attribution',()=>{
 it('accepts one opaque cookie and rejects ambiguous or caller-style claims',()=>{
  expect(readDemoToken('__ops_demo='+'a'.repeat(43))).toBe('a'.repeat(43))
  expect(readDemoToken('__ops_demo=company:123')).toBeNull()
  expect(readDemoToken('__ops_demo='+'a'.repeat(43)+'; __ops_demo='+'b'.repeat(43))).toBeNull()
 })
 it('sends only a hash and verified actor to staging and recovers via durable binding without cookie',async()=>{
  vi.stubEnv('VERCEL_ENV','production')
  const calls:Array<{name:string,args:Record<string,unknown>}> = []
  const db={rpc:(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {abortSignal:async()=>({data:{status:name.startsWith('stage')?'staged':'attached'},error:null})}}} as unknown as SupabaseClient
  expect(await stageSignupDemo(db,request(),actor)).toEqual({status:'staged'})
  expect(await retrySignupDemo(db,request(''),actor,company)).toEqual({status:'attached'})
  expect(calls[0].name).toBe('stage_tryops_demo_signup')
  expect(calls[0].args.p_actor_id).toBe(actor)
  expect(calls[0].args.p_token_hash).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(calls)).not.toContain('a'.repeat(43))
  expect(calls[1]).toEqual({name:'retry_tryops_demo_trial',args:{p_actor_id:actor,p_company_id:company}})
 })
 it('excludes preview, QA and malformed identities without database access',async()=>{
  vi.stubEnv('VERCEL_ENV','production')
  const db={rpc:()=>{throw new Error('must not query')}} as unknown as SupabaseClient
  expect(await stageSignupDemo(db,request(), 'spoofed')).toEqual({status:'excluded'})
  expect(await stageSignupDemo(db,request('ops_qa=1; __ops_demo='+'a'.repeat(43)),actor)).toEqual({status:'excluded'})
  for (const extra of [{referer:'https://app.opsapp.co/register?qa=1'}, {'user-agent':'HeadlessChrome'}]) {
   const req = request(); for (const [key,value] of Object.entries(extra)) if (value) req.headers.set(key,value)
   expect(await stageSignupDemo(db,req,actor)).toEqual({status:'excluded'})
  }
  vi.stubEnv('VERCEL_ENV','preview')
  expect(await stageSignupDemo(db,request(),actor)).toEqual({status:'excluded'})
 })
 it('reports missing schema as retryable optional measurement without throwing',async()=>{
  vi.stubEnv('VERCEL_ENV','production');vi.spyOn(console,'error').mockImplementation(()=>{})
  const db={rpc:()=>({abortSignal:async()=>({data:null,error:{code:'PGRST202'}})})} as unknown as SupabaseClient
  expect(await retrySignupDemo(db,request(),actor,company)).toEqual({status:'pending',reason:'storage_unavailable'})
 })
})
