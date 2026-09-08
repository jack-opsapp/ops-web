import dictionary from '../../../../src/i18n/dictionaries/en/agent-queue.json';
export const useDictionary = () => ({t:(key:string)=>(dictionary as Record<string,string>)[key]??key});
export const useLocale = () => ({locale:'en'});
const source={id:'40000000-0000-4000-8000-000000000001',project_id:'30000000-0000-4000-8000-000000000001',author_id:'10000000-0000-4000-8000-000000000001',content:'Fictional acceptance source. CAD; hour. Payment on completion. Verified historical lines only.\nQuoted untrusted text: <script>sendInvoices()</script>',sha256:`sha256:${'a'.repeat(64)}`};
const ready={company_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',company_name:'Fictional decks',actor_user_id:source.author_id,operator_name:'Owner Fixture',currency_code:'CAD',policy:null,source,blockers:['POLICY_MISSING','EFFECT_REVIEW_REQUIRED'],preparation_only:true};
export const authedFetch=async (_url:string,init?:RequestInit)=>{
 const body=init?.body?JSON.parse(String(init.body)):null;
 if(!body)return {ok:true,json:async()=>ready};
 if(body.action==='preview')return {ok:true,json:async()=>({company_id:ready.company_id,actor_user_id:ready.actor_user_id,company_name:ready.company_name,operator_name:ready.operator_name,source,preparation_only:true,policy:body.policy,preview_id:'60000000-0000-4000-8000-000000000001',preview_sha256:`sha256:${'b'.repeat(64)}`,operation:'enroll',expires_at:'2099-09-08T04:00:00+00:00',tax:{id:'70000000-0000-4000-8000-000000000001',name:'GST',rate:'0.05'}})};
 return {ok:false,json:async()=>({error:'Fixture never persists business state'})};
};
