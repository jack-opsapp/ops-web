import json, re
b = json.load(open('brief.json'))
P = json.load(open('proposals.json'))
by = {p['index']: p for p in P}

# ---- index 4 : cut "no credit card", break the three-way offline pile-up, unpin one
by[4]['payload']['headlines'] = [
 {"text": "Crew scheduling, offline", "pinnedField": "HEADLINE_1"},
 {"text": "Send the day from the truck", "pinnedField": "HEADLINE_1"},
 {"text": "Schedule loads with no signal"},
 {"text": "Changes sync when you're back"},
 {"text": "Nobody texts for the address"},
 {"text": "No training required"},
 {"text": "Built by trades, for trades"},
 {"text": "Your crew opens it and goes"},
 {"text": "Crews of one to ten"},
 {"text": "Free to start"}]
by[4]['payload']['descriptions'] = [
 {"text": "Underground, out of town, no bars. Tomorrow's jobs are already on the phone."},
 {"text": "Send the day once. Every crew sees the address, the time and the notes."},
 {"text": "Free to start. Every feature, every tier."}]

# ---- index 5 : cut "no credit card", drop the near-duplicate, repin on the gut problem
by[5]['payload']['headlines'] = [
 {"text": "Quote on site, invoice today", "pinnedField": "HEADLINE_1"},
 {"text": "Get paid without the chase", "pinnedField": "HEADLINE_1"},
 {"text": "Quotes and invoices in one"},
 {"text": "Invoice before you drive off"},
 {"text": "No training required"},
 {"text": "Built by trades, for trades"},
 {"text": "Works offline in the field"},
 {"text": "Your crew opens it and goes"},
 {"text": "Crews of one to ten"},
 {"text": "Free to start"}]
by[5]['payload']['descriptions'] = [
 {"text": "Quote it in the driveway. Invoice it when the work is done. Same app."},
 {"text": "No more Sunday paperwork. The invoice goes out from the job."},
 {"text": "Free to start. Every feature, every tier. Nothing to unlock later."}]

# ---- index 6 : prices out, rebuild the pinned slot on what the voice brief supports
by[6]['payload']['headlines'] = [
 {"text": "Tired of Jobber?", "pinnedField": "HEADLINE_1"},
 {"text": "Nothing locked behind a tier", "pinnedField": "HEADLINE_1"},
 {"text": "Jobber alternative"},
 {"text": "Priced by crew size"},
 {"text": "Free to start"},
 {"text": "No training required"},
 {"text": "Built by trades, for trades"},
 {"text": "Works offline in the field"},
 {"text": "Crews of one to ten"},
 {"text": "Your crew opens it and goes"}]
by[6]['payload']['descriptions'] = [
 {"text": "The crew opens it and knows what to do. No manual, no training."},
 {"text": "Free to start, then priced by crew size. Every feature, every tier."},
 {"text": "Works offline when the site has no bars. Changes sync when you are back."}]
by[6]['payload']['hypothesis'] = ("Control leads with the crew and the switch. Lead with tier honesty instead: "
 "nothing is locked behind a bigger plan. If the switcher's real question is what they lose by moving, "
 "this ad answers it before the click.")
by[6]['rationale'] = ("This ad group is the most expensive thing we own: 95 clicks and $451.47 in 28 days, zero "
 "conversions in Google's column. Our own funnel says otherwise, one trial that activated and paid at $340.20, "
 "so the traffic is real and the ad is the weak link. The control is 39 days old and leads with the switch. A "
 "switcher already knows they want out. What they do not know is what gets locked behind a bigger plan, so this "
 "challenger leads with tier honesty. Jobber appears only as the allowed forms. The editor cut the tier prices "
 "off the ad: the copywriter brief supports free to start and priced by crew size, not a price sheet, so the "
 "numbers stay on the landing page where they belong.")

json.dump(P, open('proposals.json', 'w'), indent=2)
for i in (4, 5, 6):
    json.dump(by[i]['payload'], open('candidate-%d.json' % i, 'w'), indent=2)

lim = b['copy_rules']['limits']
banned = b['copy_rules']['brand_facts']['bannedWords'] + b['copy_rules']['brand_facts']['audienceWords']['banned']
bad = []
for i in (4, 5, 6):
    pl = by[i]['payload']
    hs, ds = pl['headlines'], pl['descriptions']
    if not 8 <= len(hs) <= 12: bad.append((i, 'hl count', len(hs)))
    if not 3 <= len(ds) <= 4: bad.append((i, 'desc count', len(ds)))
    if not 2 <= len([h for h in hs if h.get('pinnedField')]) <= 3: bad.append((i, 'pins', ''))
    for h in hs:
        if len(h['text']) > 30: bad.append((i, 'HL', h['text'], len(h['text'])))
    for d in ds:
        if len(d['text']) > 90: bad.append((i, 'DESC', d['text'], len(d['text'])))
    texts = [h['text'].lower() for h in hs] + [d['text'].lower() for d in ds]
    if len(set(texts)) != len(texts): bad.append((i, 'dupe', ''))
    for t in [h['text'] for h in hs] + [d['text'] for d in ds]:
        for w in banned:
            if re.search(r'\b' + re.escape(w) + r'\b', t.lower()): bad.append((i, 'BANNED', w, t))
        if '!' in t: bad.append((i, 'bang', t))
        for n in re.findall(r'\d+', t):
            if n not in ('90', '140', '190', '1', '10', '30'): bad.append((i, 'number', t))
    if len(by[i]['rationale']) > 1200: bad.append((i, 'rationale', len(by[i]['rationale'])))
    if len(pl['hypothesis']) > 300: bad.append((i, 'hypothesis', len(pl['hypothesis'])))
    print('idx', i, 'HL', len(hs), 'maxHL', max(len(h['text']) for h in hs),
          'DESC', len(ds), 'maxDESC', max(len(d['text']) for d in ds))
print('CHECKS:', bad if bad else 'none')
