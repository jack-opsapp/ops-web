// Diagnostic: which transport applies a conversion-action mutate for real?
// One reversible operation (demote the iOS "OPS APP First open" action to
// secondary). validateOnly first, then real, per variant; stop on success.
import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l && !l.startsWith("#") && l.includes("=")).map(l=>{const i=l.indexOf("=");let v=l.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);return [l.slice(0,i).trim(),v];}));
function pem(raw){let k=raw.replace(/^["']|["']$/g,"").replace(/\\n/g,"\n");if(k.includes("-----BEGIN"))return k;const b=k.replace(/\s/g,"");return `-----BEGIN PRIVATE KEY-----\n${(b.match(/.{1,64}/g)||[b]).join("\n")}\n-----END PRIVATE KEY-----\n`;}
const creds = env.FIREBASE_ADMIN_SERVICE_ACCOUNT ? JSON.parse(env.FIREBASE_ADMIN_SERVICE_ACCOUNT) : { client_email: env.FIREBASE_ADMIN_CLIENT_EMAIL ?? `firebase-adminsdk-fbsvc@${env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.iam.gserviceaccount.com`, private_key: pem(env.FIREBASE_ADMIN_PRIVATE_KEY) };
const auth = new GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/adwords"] });
const token = (await (await auth.getClient()).getAccessToken()).token;
const H = { Authorization: `Bearer ${token}`, "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN, "Content-Type": "application/json", "login-customer-id": "5448339076" };
const CID = "4454506598";
const RN = `customers/${CID}/conversionActions/7395116875`;
async function call(url, body) {
  const r = await fetch(url, { method: "POST", headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  const codes = [];
  const walk = (o) => { if (!o || typeof o !== "object") return; if (o.errorCode) codes.push(Object.values(o.errorCode)[0]); for (const v of Object.values(o)) walk(v); };
  walk(j);
  return { status: r.status, requestId: r.headers.get("request-id") ?? j?.partialFailureError?.details?.[0]?.requestId ?? null, codes: [...new Set(codes)], sample: text.slice(0, 300) };
}
const variants = [
  ["bulk googleAds:mutate, no responseContentType", `https://googleads.googleapis.com/v25/customers/${CID}/googleAds:mutate`, (v) => ({ mutateOperations: [{ conversionActionOperation: { update: { resourceName: RN, primaryForGoal: false }, updateMask: "primaryForGoal" } }], partialFailure: true, validateOnly: v })],
  ["bulk googleAds:mutate, partialFailure false", `https://googleads.googleapis.com/v25/customers/${CID}/googleAds:mutate`, (v) => ({ mutateOperations: [{ conversionActionOperation: { update: { resourceName: RN, primaryForGoal: false }, updateMask: "primaryForGoal" } }], partialFailure: false, validateOnly: v })],
  ["dedicated conversionActions:mutate", `https://googleads.googleapis.com/v25/customers/${CID}/conversionActions:mutate`, (v) => ({ operations: [{ update: { resourceName: RN, primaryForGoal: false }, updateMask: "primaryForGoal" }], partialFailure: true, validateOnly: v })],
];
for (const [name, url, body] of variants) {
  const v = await call(url, body(true));
  console.log(`[validateOnly] ${name}: status=${v.status} codes=${JSON.stringify(v.codes)} req=${v.requestId}`);
  if (v.status !== 200 || v.codes.length) continue;
  const r = await call(url, body(false));
  console.log(`[REAL]         ${name}: status=${r.status} codes=${JSON.stringify(r.codes)} req=${r.requestId} body=${r.sample}`);
  if (r.status === 200 && r.codes.length === 0) { console.log("SUCCESS via:", name); break; }
}
