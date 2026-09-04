import { chromium } from "@playwright/test";
const base="http://127.0.0.1:3691", H="maverick-projects-ltd";
const SLOTS=["2027-09-07T15:00:00.000Z","2027-09-07T16:00:00.000Z","2027-09-07T17:00:00.000Z","2027-09-07T19:00:00.000Z","2027-09-07T20:00:00.000Z","2027-09-08T15:00:00.000Z","2027-09-09T16:00:00.000Z","2027-09-10T15:00:00.000Z","2027-09-13T15:00:00.000Z","2027-09-14T17:00:00.000Z"];
const json=(r,s,b)=>r.fulfill({status:s,contentType:"application/json",body:JSON.stringify(b)});

function lum(rgb){const [r,g,b]=rgb.match(/\d+(\.\d+)?/g).slice(0,3).map(Number).map(v=>{const c=v/255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)});return 0.2126*r+0.7152*g+0.0722*b;}
function ratio(fg,bg){const a=lum(fg),b=lum(bg);return ((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toFixed(2);}

const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
const page=await ctx.newPage();
await page.route("**/api/customer/booking/availability**",(r)=>json(r,200,{slots:SLOTS.map((startAt,i)=>({slot:`sl_${i}`,startAt})),timezone:"America/Denver",durationMinutes:60}));
await page.route("**/api/customer/booking/hold",(r)=>json(r,200,{intentRef:"in_x",holdExpiresAt:new Date(Date.now()+300000).toISOString()}));
await page.route("**/api/customer/booking/contact",(r)=>json(r,200,{challengeId:"ch_x",retryAfterSeconds:60}));
await page.route("**/api/customer/booking/verify",(r)=>json(r,200,{outcome:"confirmed",bookingRef:"bk_7Q2M"}));
await page.goto(`${base}/c/${H}/book`,{waitUntil:"domcontentloaded",timeout:180000});
await page.locator("[data-booking-step='time']").waitFor({timeout:120000});

const layout=async (label)=>{
  const rows=await page.evaluate(()=>{
    const out=[];
    const walk=(el,depth)=>{
      const r=el.getBoundingClientRect();
      const s=getComputedStyle(el);
      const own=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(" ").trim();
      if (r.width>0&&r.height>0) out.push({
        d:depth, tag:el.tagName.toLowerCase(),
        cls:(el.className||"").toString().split(" ").filter(c=>c.startsWith("cs-")||c.startsWith("text-")||c.startsWith("font-")||c.startsWith("grid")||c.startsWith("h-")).join(" "),
        x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
        fs:s.fontSize, color:s.color, bg:s.backgroundColor,
        t: own.slice(0,42),
      });
      for (const c of el.children) walk(c,depth+1);
    };
    walk(document.querySelector("main"),0);
    return out;
  });
  console.log(`\n===== ${label} =====`);
  for (const r of rows) console.log(`${" ".repeat(r.d)}${r.tag.padEnd(6)} y=${String(r.y).padStart(4)} h=${String(r.h).padStart(3)} x=${String(r.x).padStart(3)} w=${String(r.w).padStart(3)} ${r.fs.padStart(5)} ${r.t?JSON.stringify(r.t):""} ${r.cls}`);
};

const contrast=async (label)=>{
  const pairs=await page.evaluate(()=>{
    const bg=getComputedStyle(document.querySelector(".customer-shell")).backgroundColor;
    const seen=new Map();
    for (const el of document.querySelectorAll("main *")) {
      if (el.children.length===0 && el.textContent.trim()) {
        const s=getComputedStyle(el);
        const key=`${s.color}|${s.fontSize}`;
        if (!seen.has(key)) seen.set(key,{color:s.color,size:s.fontSize,sample:el.textContent.trim().slice(0,24)});
      }
    }
    return {bg, items:[...seen.values()]};
  });
  console.log(`\n--- contrast on ${pairs.bg} (${label}) ---`);
  for (const i of pairs.items) console.log(`  ${ratio(i.color,pairs.bg).padStart(6)}:1  ${i.size.padStart(5)}  ${i.color.padEnd(20)} ${JSON.stringify(i.sample)}`);
};

await layout("STEP 1 — pick a time");
await contrast("step 1");
await page.locator("[data-slot-time]").first().click();
await page.getByRole("button",{name:/^continue$/i}).click();
await page.locator("[data-booking-step='details']").waitFor();
await layout("STEP 2 — your details");
await page.getByLabel(/^name$/i).fill("Jordan Lee");
await page.getByLabel(/^email$/i).fill("jordan@example.com");
await page.getByRole("button",{name:/send code/i}).click();
await page.locator("[data-booking-step='code']").waitFor();
await layout("STEP 3 — confirm by code");
for (let i=0;i<6;i++) await page.getByLabel(`Digit ${i+1} of 6`).fill("123456"[i]);
await page.locator("[data-booking-outcome]").waitFor();
await page.waitForTimeout(500);
await layout("TERMINAL — booked");
await contrast("terminal");
await browser.close();
