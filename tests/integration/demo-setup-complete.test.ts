// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks=vi.hoisted(()=>({verify:vi.fn(),find:vi.fn(),service:vi.fn()}))
vi.mock('@/lib/firebase/admin-verify',()=>({verifyAuthToken:mocks.verify}))
vi.mock('@/lib/supabase/find-user-by-auth',()=>({findUserByAuth:mocks.find}))
vi.mock('@/lib/supabase/server-client',()=>({getServiceRoleClient:mocks.service}))
import {POST} from '@/app/api/setup/complete/route'
const user={id:'11111111-1111-4111-8111-111111111111',auth_id:'verified',company_id:'22222222-2222-4222-8222-222222222222',is_active:true,onboarding_completed:{ios:true}}
const req=()=>new NextRequest('https://app.opsapp.co/api/setup/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'valid'})})
function fixture(fail=false,missingCompany=false){
 const writes:unknown[]=[]
 mocks.service.mockReturnValue({from:(table:string)=>{let write=false;const result=()=>write?{data:fail?null:{id:user.id},error:fail?{message:'write rejected'}:null}:{data:missingCompany?null:{id:user.company_id},error:null};const q={select:()=>q,eq:()=>q,is:()=>q,update:(v:unknown)=>{writes.push(v);write=true;return q},maybeSingle:async()=>result(),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};return q}})
 return writes
}
beforeEach(()=>{mocks.verify.mockResolvedValue({uid:'verified',email:'owner@example.test'});mocks.find.mockResolvedValue(user);vi.spyOn(console,'error').mockImplementation(()=>{})})
afterEach(()=>vi.restoreAllMocks())
describe('truthful final setup save',()=>{
 it('returns recoverable failure for rejected save instead of success',async()=>{fixture(true);const res=await POST(req());expect(res.status).toBe(500);expect(await res.json()).not.toHaveProperty('success',true)})
 it('preserves member and legacy company onboarding without requiring a new trial',async()=>{const writes=fixture();expect((await POST(req())).status).toBe(200);expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({onboarding_completed:{ios:true,web:true}})})
 it('does not mark an account without a real company complete',async()=>{const writes=fixture(false,true);expect((await POST(req())).status).toBe(409);expect(writes).toHaveLength(0)})
 it('refuses a legacy email-only identity match',async()=>{mocks.find.mockResolvedValue({...user,auth_id:'other'});const writes=fixture();expect((await POST(req())).status).toBe(403);expect(writes).toHaveLength(0)})
})
