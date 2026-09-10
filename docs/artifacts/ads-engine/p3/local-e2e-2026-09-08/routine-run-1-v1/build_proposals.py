import json

b = json.load(open('brief.json'))
CID = "customers/4454506598"
st28 = {r['term']: r for r in b['metrics28d']['searchTerms']}

def term_ev(t):
    r = st28[t]
    return {"term": t, "campaign": r['campaignName'], "ad_group": r['adGroupName'],
            "clicks": r['clicks'], "impressions": r['impressions'], "spend": r['spend'],
            "conversions": r['conversions'], "window": "2026-08-10..2026-09-06"}

P = []

# ---------------- HYGIENE: negatives ----------------
P.append({
 "index": 0, "kind": "add_negatives",
 "rationale": ("Two terms in the 28-day report are people looking for work, not people running a crew. "
   "'job management jobs' took 5 clicks and $22.00. 'jobber careers' took 3 clicks and $14.10 out of the "
   "COMPETITOR budget. No trial between them. The Job seekers list already carries 'jobs' broad and both "
   "terms still cleared spend inside this window, so block the exact phrases and stop guessing. "
   "$36.10 in 28 days, on a budget where a trial costs $150."),
 "evidence": [term_ev("job management jobs"), term_ev("jobber careers")],
 "payload": {"list": "NEG · Job seekers", "classification": "job_seeker",
   "terms": [{"text": "job management jobs", "matchType": "PHRASE"},
             {"text": "jobber careers", "matchType": "PHRASE"}]}})

P.append({
 "index": 1, "kind": "add_negatives",
 "rationale": ("'electrician near me' is a homeowner looking for an electrician. We sell to the electrician. "
   "6 clicks, $19.20, no trial, and it is running against the Job management ad group where our only trials "
   "come from. The Homeowner list carries 'near me' broad and this term still spent inside the window, "
   "so block the exact phrase."),
 "evidence": [term_ev("electrician near me")],
 "payload": {"list": "NEG · Homeowner intent", "classification": "homeowner",
   "terms": [{"text": "electrician near me", "matchType": "PHRASE"}]}})

P.append({
 "index": 2, "kind": "add_negatives",
 "rationale": ("'job management course' is somebody studying the subject, not somebody running jobs. "
   "3 clicks, $11.70, no trial. Small money, but it is the same dollar that buys a trial start."),
 "evidence": [term_ev("job management course")],
 "payload": {"list": "NEG · Training", "classification": "student",
   "terms": [{"text": "job management course", "matchType": "PHRASE"}]}})

P.append({
 "index": 3, "kind": "add_negatives",
 "rationale": ("'free job management app' is shopping for free forever. OPS is free to start and then it is "
   "paid, so this click is never going to end anywhere good. 7 clicks, $24.50, no trial, the largest waste "
   "line in the report. 'free' is on the Generic waste hint list and is not in the list yet."),
 "evidence": [term_ev("free job management app")],
 "payload": {"list": "NEG · Generic waste", "classification": "irrelevant",
   "terms": [{"text": "free job management app", "matchType": "PHRASE"}]}})

# ---------------- CREATIVE: challengers ----------------
ag28 = {r['adGroupId']: r for r in b['metrics28d']['adGroups']}
ads28 = {r['adId']: r for r in b['metrics28d']['ads']}
fk = {r['keyword']: r for r in b['funnel']['by_keyword']}

def ag_ev(agid, name, adid):
    a, d = ag28[agid], ads28[adid]
    return [{"row": "ad_group_28d", "ad_group": name, "clicks": a['clicks'], "impressions": a['impressions'],
             "spend": a['spend'], "conversions": a['conversions']},
            {"row": "control_ad_28d", "ad_id": adid, "ctr": round(d['ctr'], 6), "clicks": d['clicks'],
             "spend": d['spend'], "conversions": d['conversions'], "ad_strength": d['adStrength'],
             "first_seen": d['firstSeen'], "age_days": 39}]

def fk_ev(kw):
    r = fk[kw]
    return {"row": "funnel_by_keyword", "keyword": kw, "clicks": r['clicks'], "trials": r['trials'],
            "activated": r['activated'], "paid": r['paid'], "spend": r['spend'],
            "cost_per_trial": r['cost_per_trial'] if r['cost_per_trial'] is not None else 0,
            "target_cost_per_trial": 150}

asset_ev = [{"row": "asset_label_28d", "text": a['text'], "field": a['fieldType'],
             "label": a['performanceLabel'], "clicks": a['clicks'], "impressions": a['impressions']}
            for a in b['metrics28d']['assets']]

# --- index 4: Crew scheduling (ad group 22) : offline angle
rsa_a = {
 "ad_group": f"{CID}/adGroups/22",
 "hypothesis": ("Control leads with the crew knowing where to be. Lead with the offline promise instead: "
   "the schedule loads in a dead zone. If the field-reality angle beats coordination, the click is warmer "
   "and the trial is cheaper than $231.80."),
 "headlines": [
   {"text": "Crew scheduling, offline", "pinnedField": "HEADLINE_1"},
   {"text": "Schedule loads with no signal", "pinnedField": "HEADLINE_1"},
   {"text": "Send the day from the truck"},
   {"text": "Changes sync when you're back"},
   {"text": "Built for bad signal days"},
   {"text": "No training required"},
   {"text": "Built by trades, for trades"},
   {"text": "Your crew opens it and goes"},
   {"text": "Crews of one to ten"},
   {"text": "Free to start"}],
 "descriptions": [
   {"text": "The schedule loads in the truck with no signal. Changes sync when you get back."},
   {"text": "Send tomorrow's jobs tonight. Every crew sees the address and the notes."},
   {"text": "Free to start. No credit card. Every feature, every tier."}],
 "path1": "scheduling", "path2": "offline",
 "final_url": "https://try.opsapp.co/scheduling"}

P.append({
 "index": 4, "kind": "create_rsa_challenger",
 "rationale": ("Crew scheduling has taken 95 clicks and $311.81 in 28 days for zero trials in Google's column "
   "and one trial in our own funnel at $231.80, against a $150 target. The control ad is 39 days old and it "
   "leads with the crew knowing where to be, the same note as every other ad in the account. This challenger "
   "leads with the offline promise, which is the thing a scheduling app actually has to survive: the truck, "
   "the basement, the rural site. Google marked 'Every feature, every tier' LOW as a headline, so it is out of "
   "the headline set and stays in a description. 'Your crew opens it and goes' is GOOD, so it stays."),
 "evidence": ag_ev("22", "Crew scheduling", "203") + [fk_ev("crew scheduling app")] + asset_ev,
 "payload": rsa_a})

# --- index 5: Quotes & invoices (ad group 23) : get paid angle
rsa_b = {
 "ad_group": f"{CID}/adGroups/23",
 "hypothesis": ("Control leads with the workflow, quote it and invoice it. Lead with the money instead: "
   "the invoice goes out from the driveway. If getting paid sooner is the sharper hook, this ad group "
   "produces its first trial."),
 "headlines": [
   {"text": "Quote on site, invoice today", "pinnedField": "HEADLINE_1"},
   {"text": "Free to start, no credit card", "pinnedField": "HEADLINE_1"},
   {"text": "Get paid without the chase"},
   {"text": "Quotes and invoices in one"},
   {"text": "One app, quote to paid"},
   {"text": "No training required"},
   {"text": "Built by trades, for trades"},
   {"text": "Works offline in the field"},
   {"text": "Crews of one to ten"},
   {"text": "Your crew opens it and goes"}],
 "descriptions": [
   {"text": "Quote it in the driveway. Invoice it when the work is done. Same app."},
   {"text": "No more Sunday paperwork. The invoice goes out from the job."},
   {"text": "Free to start. No credit card. Every feature, every tier."}],
 "path1": "quotes", "path2": "invoices",
 "final_url": "https://try.opsapp.co/quotes-invoices"}

P.append({
 "index": 5, "kind": "create_rsa_challenger",
 "rationale": ("Quotes and invoices has taken 62 clicks and $211.12 in 28 days with no trial and no funnel row "
   "at all, and it is the only ad group whose ad strength is AVERAGE. The control is 39 days old and reads like "
   "the feature list. Money is what a subtrade is searching for when they type 'quote and invoice app', so this "
   "challenger leads with getting paid: quote in the driveway, invoice before the truck moves. Keeps the two "
   "proven brand lines, drops the LOW-labelled 'Every feature, every tier' out of the headlines."),
 "evidence": ag_ev("23", "Quotes & invoices", "205") + asset_ev,
 "payload": rsa_b})

# --- index 6: Jobber alternative (ad group 31) : price and tier honesty
rsa_c = {
 "ad_group": f"{CID}/adGroups/31",
 "hypothesis": ("Control leads with the crew and the switch. Lead with the price and the tier honesty instead: "
   "every tier has every feature, and the number is on the ad. If the switcher's real question is what it costs "
   "and what is locked, this ad answers it before the click."),
 "headlines": [
   {"text": "Tired of Jobber?", "pinnedField": "HEADLINE_1"},
   {"text": "Starter is $90 a month", "pinnedField": "HEADLINE_1"},
   {"text": "Jobber alternative"},
   {"text": "Team is $140, business $190"},
   {"text": "Nothing locked behind a tier"},
   {"text": "No training required"},
   {"text": "Built by trades, for trades"},
   {"text": "Works offline in the field"},
   {"text": "Crews of one to ten"},
   {"text": "Free to start"}],
 "descriptions": [
   {"text": "The crew opens it and knows what to do. No manual, no training."},
   {"text": "Starter $90, Team $140, Business $190 a month. Every feature, every tier."},
   {"text": "Free to start. No credit card. Works offline when the site has no signal."}],
 "path1": "compare", "path2": "pricing",
 "final_url": "https://try.opsapp.co/compare/jobber"}

P.append({
 "index": 6, "kind": "create_rsa_challenger",
 "rationale": ("This ad group is the most expensive thing we own: 95 clicks and $451.47 in 28 days, zero "
   "conversions in Google's column. Our own funnel says otherwise, one trial that activated and paid at "
   "$340.20, so the traffic is real and the ad is the weak link. The control is 39 days old and leads with the "
   "switch. A switcher already knows they want out. What they do not know is the price and what is locked "
   "behind a bigger plan, so this challenger puts the tiers on the ad. Jobber appears only as the allowed "
   "forms. Nothing else names a competitor."),
 "evidence": ag_ev("31", "Jobber alternative", "204") + [fk_ev("jobber alternative")] + asset_ev,
 "payload": rsa_c})

# ---------------- OBSERVATIONS ----------------
P.append({
 "index": 7, "kind": "observation",
 "rationale": ("The one paying customer in this account came out of the campaign Google says produced nothing. "
   "That gap decides whether we keep spending there, so it goes in front of you rather than into a pause."),
 "evidence": [
   {"row": "campaign_28d", "campaign": "COMPETITOR · CA", "clicks": 95, "spend": 451.47, "google_conversions": 0},
   fk_ev("jobber alternative"),
   {"row": "keyword_28d", "keyword": "jobber alternative", "match_type": "EXACT", "clicks": 62,
    "spend": 305.31, "google_conversions": 0, "quality_score": 8}],
 "payload": {"text": ("COMPETITOR · CA spent $451.47 over the last 28 days and Google reports zero conversions "
   "on it. Our warehouse funnel says the opposite: 'jobber alternative' produced 1 trial, 1 activation and the "
   "only paying customer in the whole account, at $340.20. Two things follow. First, do not judge that campaign "
   "on the Google conversion column, and do not let anyone pause the keyword on it: by the 28-day click rule it "
   "looks like a dead keyword and it is the only line that has ever produced revenue. Second, the conversion "
   "import for that campaign is worth an hour of somebody's time, because every automated decision downstream "
   "of it, bidding included, is being made on a number that is wrong. Cost per paid customer of $340.20 against "
   "a $150 target cost per trial is expensive but it is not zero, and zero is what Google is telling us.")}})

P.append({
 "index": 8, "kind": "observation",
 "rationale": ("Cheapest trials in the account are running into a $3 a day ceiling. Bidding is not a duty this "
   "run so I am not proposing the change, I am putting the number in front of you for the run that is."),
 "evidence": [
   {"row": "campaign_28d", "campaign": "BRAND · CA", "daily_budget": 3, "clicks": 95, "impressions": 907,
    "spend": 77.95, "google_conversions": 1},
   fk_ev("opsapp"),
   {"row": "ad_28d", "ad_id": "206", "ctr": 0.104741, "ad_strength": "EXCELLENT"},
   {"row": "month_to_date", "spend": 389.5, "monthly_cap": 1500, "days_left": 23, "daily_cap": 60,
    "sum_of_daily_budgets": 50}],
 "payload": {"text": ("BRAND · CA is capped at $3 a day and it is the best money in the account. 2 trials at "
   "$25.70 each against a $150 target, a 10.5% click-through rate, and the only ad rated EXCELLENT. It spent "
   "$77.95 in 28 days, which is the budget line, not demand running out. Meanwhile month-to-date spend is "
   "$389.50 against a $1,500 monthly cap with 23 days left, and the three live campaigns add up to $50 a day "
   "against a $60 daily ceiling. There is room. I am not filing a budget change this run because the bidding "
   "ladder is not one of today's duties and the ledger has no prior change to measure a cooldown against. When "
   "bidding is named, brand is the first rung, and it is a small one: brand traffic is finite and the ceiling "
   "should move by a few dollars, not double.")}})

json.dump(P, open('proposals.json', 'w'), indent=2)

# -------- hard checks --------
lim = b['copy_rules']['limits']
allowed = set(b['copy_rules']['allowed_final_urls'])
bad = []
for p in P:
    if len(p['rationale']) > 1200: bad.append((p['index'], 'rationale', len(p['rationale'])))
    if len(p['evidence']) > 60: bad.append((p['index'], 'evidence rows', len(p['evidence'])))
    if p['kind'] == 'create_rsa_challenger':
        pl = p['payload']
        hs = pl['headlines']; ds = pl['descriptions']
        if not (lim['headlines']['min'] <= len(hs) <= lim['headlines']['max']): bad.append((p['index'], 'headline count', len(hs)))
        if not (lim['descriptions']['min'] <= len(ds) <= lim['descriptions']['max']): bad.append((p['index'], 'desc count', len(ds)))
        pins = [h for h in hs if h.get('pinnedField')]
        if not (2 <= len(pins) <= 3): bad.append((p['index'], 'pins', len(pins)))
        if any(h.get('pinnedField') not in (None, 'HEADLINE_1') for h in hs): bad.append((p['index'], 'bad pin field', ''))
        for h in hs:
            if len(h['text']) > lim['headline']: bad.append((p['index'], 'HL too long', h['text'] + ' = ' + str(len(h['text']))))
        for d in ds:
            if len(d['text']) > lim['description']: bad.append((p['index'], 'DESC too long', d['text'] + ' = ' + str(len(d['text']))))
        if len(pl['path1']) > lim['path'] or len(pl['path2']) > lim['path']: bad.append((p['index'], 'path', ''))
        if pl['final_url'] not in allowed: bad.append((p['index'], 'url', pl['final_url']))
        if len(pl['hypothesis']) > 300: bad.append((p['index'], 'hypothesis', len(pl['hypothesis'])))
        texts = [h['text'].lower() for h in hs] + [d['text'].lower() for d in ds]
        if len(set(texts)) != len(texts): bad.append((p['index'], 'dupe asset', ''))
    if p['kind'] == 'observation' and len(p['payload']['text']) > 2000:
        bad.append((p['index'], 'obs text', len(p['payload']['text'])))

banned = b['copy_rules']['brand_facts']['bannedWords'] + b['copy_rules']['brand_facts']['audienceWords']['banned']
import re
for p in P:
    if p['kind'] != 'create_rsa_challenger': continue
    for t in [h['text'] for h in p['payload']['headlines']] + [d['text'] for d in p['payload']['descriptions']]:
        low = t.lower()
        for w in banned:
            if re.search(r'\b' + re.escape(w) + r'\b', low): bad.append((p['index'], 'BANNED ' + w, t))
        if '!' in t: bad.append((p['index'], 'bang', t))
        for n in re.findall(r'\d+', t):
            if n not in ('90', '140', '190', '1', '10', '30'): bad.append((p['index'], 'number', t))

print('PROPOSALS', len(P), 'structural', sum(1 for p in P if p['kind'] in b['structural_kinds']))
for p in P:
    if p['kind'] == 'create_rsa_challenger':
        print(' idx', p['index'], p['payload']['ad_group'].split('/')[-1],
              'HL', len(p['payload']['headlines']), 'max', max(len(h['text']) for h in p['payload']['headlines']),
              'DESC', len(p['payload']['descriptions']), 'max', max(len(d['text']) for d in p['payload']['descriptions']))
print('CHECK FAILURES:', bad if bad else 'none')
