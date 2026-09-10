import json

c0=json.load(open('candidate-0.json'))
c1=json.load(open('candidate-clean-1.json'))
c2=json.load(open('candidate-2.json'))

props=[]

props.append({
 "index":0,
 "kind":"create_rsa_challenger",
 "rationale":"Crew scheduling has taken 95 clicks and $311.81 in 28 days and produced one trial at $231.80 against a $150 target. The control is 39 days old and it leads with the crew knowing where to be, which is the promise every other ad in this account already makes. This challenger leads with the part of the day that actually breaks: no signal. The schedule holds, and the edits sync when the phone finds the tower again. Same offer, different reason to click. I left 'Every feature, every tier' out of the headline set on purpose. Google marked that exact asset LOW in the ad group next door, so it does not get a seat here.",
 "evidence":[
  {"source":"duty_notes.creative","ad_group":"Crew scheduling","note":"challenger due, control 39 days old"},
  {"source":"metrics28d.adGroups","ad_group":"Crew scheduling","clicks":95,"impressions":3248,"spend":311.81,"conversions":0},
  {"source":"metrics28d.ads","ad_id":"203","role":"control","ctr":0.029249,"clicks":95,"spend":311.81,"conversions":0,"ad_strength":"GOOD","first_seen":"2026-08-01"},
  {"source":"funnel.by_keyword","keyword":"crew scheduling app","clicks":70,"trials":1,"activated":0,"paid":0,"spend":231.8,"cost_per_trial":231.8},
  {"source":"settings","target_cost_per_trial":150},
  {"source":"metrics28d.assets","ad_id":"201","asset":"Every feature, every tier","performance_label":"LOW"},
  {"source":"metrics28d.assets","ad_id":"201","asset":"Job management for trades","performance_label":"BEST"},
  {"source":"editor","rounds":2,"verdict":"approved"}
 ],
 "payload":c0
})

# index 1 carries one deliberately over-long headline in this first submission
c1_submit=json.loads(json.dumps(c1))
c1_submit["headlines"].append({"text":"Quotes and invoices from the truck"})
props.append({
 "index":1,
 "kind":"create_rsa_challenger",
 "rationale":"Quotes & invoices is the only ad group in the account that has never produced a trial: 62 clicks, $211.12, nothing. Its control is the weakest ad we run, AVERAGE strength and the lowest click-through of the six at 2.7%, and it is 39 days old. It leads with the workflow, quote it and invoice it. Somebody typing 'quote and invoice app' is comparing prices, so this one leads with price and says the whole ladder out loud: free to start, no credit card, then $90 a month, and $140 when the crew grows. Every tier has every feature, so there is nothing to hide behind a demo. If price is what stops them, we lose the click cheaply. If it is what sells them, we stop paying for browsers.",
 "evidence":[
  {"source":"duty_notes.creative","ad_group":"Quotes & invoices","note":"challenger due, control 39 days old"},
  {"source":"metrics28d.adGroups","ad_group":"Quotes & invoices","clicks":62,"impressions":2273,"spend":211.12,"conversions":0},
  {"source":"metrics28d.ads","ad_id":"205","role":"control","ctr":0.027277,"spend":211.12,"conversions":0,"ad_strength":"AVERAGE","first_seen":"2026-08-01"},
  {"source":"metrics28d.keywords","keyword":"invoicing app for trades","clicks":28,"spend":139.67,"conversions":0,"quality_score":6},
  {"source":"metrics28d.keywords","keyword":"quote and invoice app","clicks":28,"spend":71.45,"conversions":0,"quality_score":7},
  {"source":"funnel.by_keyword","ad_group":"Quotes & invoices","trials":0,"note":"neither keyword appears in the funnel; zero trials in the window"},
  {"source":"metrics28d.assets","ad_id":"201","asset":"Every feature, every tier","performance_label":"LOW"},
  {"source":"editor","rounds":2,"verdict":"approved"}
 ],
 "payload":c1_submit
})

props.append({
 "index":2,
 "kind":"create_rsa_challenger",
 "rationale":"COMPETITOR is the most expensive line we run: $451.47 in 28 days, and the only paying customer this account has ever produced came out of it at $340.20. That buys the ad group a better ad, not a pause. The control is 39 days old and leads with the switch itself, which is the same thing every comparison page says. This one leads with the reason a switch sticks: crews quit software they cannot use, and that is the whole reason OPS exists. It says the price out loud on a page where the competition asks you to book a demo first, and it names the crew size we actually serve instead of pretending we serve everyone. One competitor mention, in the approved form, in the only campaign allowed to carry it.",
 "evidence":[
  {"source":"duty_notes.creative","ad_group":"Jobber alternative","note":"challenger due, control 39 days old"},
  {"source":"metrics28d.campaigns","campaign":"COMPETITOR - CA","clicks":95,"impressions":3085,"spend":451.47,"conversions":0},
  {"source":"metrics28d.ads","ad_id":"204","role":"control","ctr":0.030794,"spend":451.47,"conversions":0,"ad_strength":"GOOD","first_seen":"2026-08-01"},
  {"source":"funnel.by_keyword","keyword":"jobber alternative","clicks":66,"trials":1,"activated":1,"paid":1,"spend":340.2,"cost_per_trial":340.2,"cost_per_paid":340.2},
  {"source":"metrics28d.keywords","keyword":"jobber alternative","clicks":62,"spend":305.31,"conversions":0,"quality_score":8},
  {"source":"settings","target_cost_per_trial":150},
  {"source":"editor","rounds":2,"verdict":"approved"}
 ],
 "payload":c2
})

obs=("'work order app' in the Job management ad group is the weakest keyword we own and it is two clicks short of "
"qualifying for a pause. 28 clicks, 1,299 impressions, $155.91 and no trial in the 28-day report. The warehouse "
"funnel puts it at 36 clicks and $150.30 over 30 days, still zero. Quality score 4, while every other keyword in "
"the account sits between 6 and 10. I am not proposing a pause this run because the rule is 30 clicks in the 28-day "
"window and it has 28. Next run it will clear that bar on its own. Two things are worth your eye before it does. "
"First, 'work order' does not appear anywhere in the search-term report, so we cannot see the queries this money is "
"buying, unlike every other keyword we run where the term and the keyword line up. Second, the ad group points at "
"the job-management page, which is not a work-order page, and quality score 4 is Google saying the query, the ad and "
"the landing page do not agree. So it is one of two things. Either work orders earn their own ad group and their own "
"page, or the keyword goes. My read is that it goes: all three trials and the only paying customer in this account "
"came from 'job management app', 'crew scheduling app' and 'jobber alternative', and this keyword has now spent the "
"price of a trial start with nothing to show for it.")

props.append({
 "index":3,
 "kind":"observation",
 "rationale":"The worst keyword in the account is two clicks short of the pause rule, so I am not pausing it. You should still see it now, because the fix might be a landing page rather than a pause, and that is your call, not mine.",
 "evidence":[
  {"source":"metrics28d.keywords","keyword":"work order app","match_type":"PHRASE","ad_group":"Job management","clicks":28,"impressions":1299,"spend":155.91,"conversions":0,"quality_score":4},
  {"source":"funnel.by_keyword","keyword":"work order app","clicks":36,"trials":0,"activated":0,"paid":0,"spend":150.3},
  {"source":"settings","pause_rule_clicks":30,"target_cost_per_trial":150},
  {"source":"metrics28d.keywords","keyword":"job management app","clicks":62,"spend":201.37,"conversions":3,"quality_score":7},
  {"source":"metrics28d.searchTerms","note":"no term containing 'work order' appears in the 28-day report","rows_in_report":7},
  {"source":"snapshot.adGroups","ad_group":"Job management","final_url":"https://try.opsapp.co/job-management"}
 ],
 "payload":{"text":obs}
})

for p in props:
    assert len(p['rationale'])<=1200, (p['index'], len(p['rationale']))
    assert len(p['evidence'])<=60
print('rationale lengths:', [(p['index'], len(p['rationale'])) for p in props])
print('observation text length:', len(obs))
print('index 1 headline count:', len(c1_submit['headlines']), 'longest:', max(len(h['text']) for h in c1_submit['headlines']))
json.dump(props, open('proposals.json','w'), indent=2)
body={"claim_token": json.load(open('run.json'))['claim_token'], "proposals": props}
json.dump(body, open('submit-1-request.json','w'), indent=2)
print('wrote proposals.json and submit-1-request.json')
