// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks=vi.hoisted(()=>({verify:vi.fn(),find:vi.fn(),service:vi.fn()}))
vi.mock('@/lib/firebase/admin-verify',()=>({verifyAuthToken:mocks.verify}))
vi.mock('@/lib/supabase/find-user-by-auth',()=>({findUserByAuth:mocks.find}))
vi.mock('@/lib/supabase/server-client',()=>({getServiceRoleClient:mocks.service}))
vi.mock('@/lib/pmf/trial-attribution',()=>({recordTrialAttribution:async()=>{}}))
import {POST} from '@/app/api/setup/progress/route'
const actor='11111111-1111-4111-8111-111111111111',company='22222222-2222-4222-8222-222222222222',cookie='__ops_demo='+'a'.repeat(43)
const user={id:actor,auth_id:'verified',email:'qa@opsapp.co',company_id:null,setup_progress:{steps:{identity:true},signup_attribution:{channel:'organic_search'}}}
function req(step='company',head=cookie){return new NextRequest('https://app.opsapp.co/api/setup/progress',{method:'POST',headers:{cookie:head,'content-type':'application/json'},body:JSON.stringify({token:'verified-token',step,data:{companyName:'Test only'},actorId:'spoofed',companyId:'spoofed',demo:{complete:true}})})}
function fixture(failCreate=false,missingSchema=false,failCheckpoint=false){
 const calls:Array<{name:string,args:Record<string,unknown>}> = [];const updates:unknown[]=[]
 mocks.service.mockReturnValue({rpc:(name:string,args:Record<string,unknown>)=>{
  calls.push({name,args});let data:unknown={status:'absent'},error:unknown=null
  if(name==='create_company_for_owner_by_id'){data={company_id:company};if(failCreate)error={message:'NO_USER_ROW'}}
  if(name==='stage_tryops_demo_signup')data={status:'staged'}
  if(name==='retry_tryops_demo_trial')data={status:'attached'}
  if(missingSchema && name.includes('demo'))error={code:'PGRST202'}
  const result={data,error};return {then:Promise.resolve(result).then.bind(Promise.resolve(result)),abortSignal:async()=>result}
 },from:()=>({update:(v:unknown)=>{updates.push(v);return {eq:async()=>({error:failCheckpoint?{message:'failed'}:null})}}})})
 return {calls,updates}
}
beforeEach(()=>{vi.stubEnv('VERCEL_ENV','production');mocks.verify.mockResolvedValue({uid:'verified',email:user.email});mocks.find.mockResolvedValue(user);vi.spyOn(console,'error').mockImplementation(()=>{})})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs()})
describe('canonical setup and separate demo identity',()=>{
 it('stages verified identity before company creation and attaches only the returned company',async()=>{
  const {calls,updates}=fixture();expect((await POST(req())).status).toBe(200)
  const demo=calls.filter(c=>c.name.includes('demo'))
  expect(demo).toHaveLength(2);expect(demo[0]).toMatchObject({name:'stage_tryops_demo_signup',args:{p_actor_id:actor}})
  expect(demo[1]).toEqual({name:'retry_tryops_demo_trial',args:{p_actor_id:actor,p_company_id:company}})
  expect(calls.findIndex(c=>c.name==='stage_tryops_demo_signup')).toBeLessThan(calls.findIndex(c=>c.name==='create_company_for_owner_by_id'))
  expect(JSON.stringify(updates)).not.toContain('demo');expect(JSON.stringify(updates)).toContain('organic_search')
 })
 it('cannot attach from authentication or a failed company save',async()=>{
  const {calls}=fixture(true);expect((await POST(req())).status).toBe(409);expect(calls.some(c=>c.name==='retry_tryops_demo_trial')).toBe(false)
 })
 it('keeps signup usable when optional migration is missing',async()=>{
  fixture(false,true);const response=await POST(req());expect(response.status).toBe(200);expect((await response.json()).success).toBe(true)
 })
 it('reports a failed checkpoint even if attribution succeeded',async()=>{fixture(false,false,true);expect((await POST(req())).status).toBe(500)})
 it('resumes a company from durable staging after cookies are unavailable',async()=>{
  mocks.find.mockResolvedValue({...user,company_id:company});const {calls}=fixture();expect((await POST(req('starfield',''))).status).toBe(200)
  expect(calls.filter(c=>c.name.includes('demo'))).toEqual([{name:'retry_tryops_demo_trial',args:{p_actor_id:actor,p_company_id:company}}])
  expect(calls.some(c=>c.name==='create_company_for_owner_by_id')).toBe(false)
 })
 it('never binds an email-fallback account whose cryptographic identity differs',async()=>{
  mocks.find.mockResolvedValue({...user,auth_id:'other'});const {calls}=fixture();await POST(req('identity'))
  expect(calls.some(c=>c.name.includes('demo'))).toBe(false)
 })
})
