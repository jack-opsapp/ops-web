import json

def lev(a,b):
    if a==b: return 0
    m,n=len(a),len(b)
    prev=list(range(n+1))
    for i in range(1,m+1):
        cur=[i]+[0]*n
        for j in range(1,n+1):
            cur[j]=min(prev[j]+1, cur[j-1]+1, prev[j-1]+(a[i-1]!=b[j-1]))
        prev=cur
    return prev[n]

BF=json.load(open('brand-facts.json'))
banned=[w.lower() for w in BF['bannedWords']]+['contractor','contractors']
allowed_nums={n['token'] for n in BF['numbers']}

cands = {
 0: {
  "ad_group":"customers/4454506598/adGroups/22",
  "hypothesis":"Control leads with the crew knowing where to be. This one leads with the offline promise: the schedule and the changes survive a basement, a backroad and a dead bar of signal. Same offer, different reason to click.",
  "headlines":[
    {"text":"Scheduling that works offline","pinnedField":"HEADLINE_1"},
    {"text":"Changes sync when you're back","pinnedField":"HEADLINE_1"},
    {"text":"Today's jobs, on every phone"},
    {"text":"Dispatch from the truck"},
    {"text":"The whole week in one place"},
    {"text":"No training required"},
    {"text":"Built by trades, for trades"},
    {"text":"Free to start"},
    {"text":"Crews of one to ten"}
  ],
  "descriptions":[
    {"text":"The schedule works offline. Changes sync the moment the phone finds signal again."},
    {"text":"Move a job and the crew sees it. No group text, no calls asking for the address."},
    {"text":"Free to start. No credit card. Built by trades, for trades."}
  ],
  "path1":"scheduling","path2":"offline",
  "final_url":"https://try.opsapp.co/scheduling"
 },
 1: {
  "ad_group":"customers/4454506598/adGroups/23",
  "hypothesis":"Control leads with the workflow, quote it and invoice it. This one leads with price: free to start, then $90 a month, every feature on every tier and the next rung named out loud.",
  "headlines":[
    {"text":"Free, then $90 a month","pinnedField":"HEADLINE_1"},
    {"text":"Quotes and invoices for crews","pinnedField":"HEADLINE_1"},
    {"text":"$140 when the crew grows"},
    {"text":"No credit card to start"},
    {"text":"Send the quote from the truck"},
    {"text":"Invoice before you leave site"},
    {"text":"No training required"},
    {"text":"Built by trades, for trades"},
    {"text":"Works offline"}
  ],
  "descriptions":[
    {"text":"Free to start, no credit card. Then $90 a month, every feature on every tier."},
    {"text":"Quote on site, invoice from the truck. Paperwork done before you drive off."},
    {"text":"$140 when the crew grows past starter. No feature held back to sell you up."}
  ],
  "path1":"quotes","path2":"pricing",
  "final_url":"https://try.opsapp.co/quotes-invoices"
 },
 2: {
  "ad_group":"customers/4454506598/adGroups/31",
  "hypothesis":"Control leads with the switch itself. This one leads with the proof of why a switch sticks: the crew opens it, there is nothing to learn, and the price is said out loud instead of quoted after a demo.",
  "headlines":[
    {"text":"Tired of Jobber?","pinnedField":"HEADLINE_1"},
    {"text":"Your crew opens it and goes","pinnedField":"HEADLINE_1"},
    {"text":"Nobody used the old one"},
    {"text":"No training required"},
    {"text":"Free, then $90 a month"},
    {"text":"No credit card to start"},
    {"text":"Built by trades, for trades"},
    {"text":"Works offline on site"},
    {"text":"Crews of one to ten"}
  ],
  "descriptions":[
    {"text":"Crews quit software they cannot use. OPS opens to today's jobs. No manual."},
    {"text":"Built by trades, for trades, for crews of one to ten. Free to start, no credit card."},
    {"text":"Nothing held back on the cheap tier. $90 a month, $140 when the crew grows."}
  ],
  "path1":"jobber","path2":"compare",
  "final_url":"https://try.opsapp.co/compare/jobber"
 },
}

urls=set(BF['allowedFinalUrls'])
ok=True
for i,c in cands.items():
    print('=== candidate',i,c['ad_group'])
    hs=[h['text'] for h in c['headlines']]
    ds=[d['text'] for d in c['descriptions']]
    pins=[h for h in c['headlines'] if h.get('pinnedField')]
    print(' headlines',len(hs),'descriptions',len(ds),'pins',len(pins))
    for h in c['headlines']:
        t=h['text']; flag='' if len(t)<=30 else '  <<< TOO LONG'
        print(f"   {len(t):>2} {t!r}{' [PIN]' if h.get('pinnedField') else ''}{flag}")
        if len(t)>30: ok=False
    for d in ds:
        flag='' if len(d)<=90 else '  <<< TOO LONG'
        print(f"   D{len(d):>2} {d!r}{flag}")
        if len(d)>90: ok=False
    print('  hypothesis len', len(c['hypothesis']), 'path1', len(c['path1']), 'path2', len(c['path2']))
    if len(c['hypothesis'])>300 or len(c['path1'])>15 or len(c['path2'])>15: ok=False
    if c['final_url'] not in urls: ok=False; print('  URL NOT ALLOWED')
    # near-duplicate distance
    for grp,name in ((hs,'H'),(ds,'D')):
        for a in range(len(grp)):
            for b in range(a+1,len(grp)):
                d=lev(grp[a].lower(),grp[b].lower())
                if d<=2:
                    ok=False; print(f'  NEAR-DUP {name} dist={d}: {grp[a]!r} / {grp[b]!r}')
    # banned words / punctuation / numbers
    for t in hs+ds:
        low=t.lower()
        for w in banned:
            if w in low: ok=False; print('  BANNED WORD', w, 'in', t)
        if '!' in t: ok=False; print('  EXCLAMATION in', t)
        import re
        for tok in re.findall(r'\$?\d[\d,\.]*', t):
            if tok not in allowed_nums: ok=False; print('  NUMBER NOT IN BRAND FACTS:', tok, 'in', t)
    json.dump(c, open(f'candidate-{i}.json','w'), indent=2)
print()
print('ALL LOCAL CHECKS PASS' if ok else 'LOCAL CHECK FAILURES ABOVE')
