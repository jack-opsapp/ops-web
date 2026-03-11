/* ── scripts/seed-app-events.ts ── */
/* Run: npx tsx scripts/seed-app-events.ts */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PAGES = [
  { name: 'dashboard', weight: 0.40, features: ['stat-widget', 'task-list', 'map-widget', 'calendar-widget', 'weather-widget'] },
  { name: 'pipeline',  weight: 0.20, features: ['board', 'deal-card', 'filters', 'stage-column'] },
  { name: 'calendar',  weight: 0.18, features: ['month-view', 'week-view', 'task-bar', 'event-create'] },
  { name: 'projects',  weight: 0.12, features: ['project-list', 'project-detail', 'photo-gallery', 'task-tab'] },
  { name: 'settings',  weight: 0.07, features: ['profile', 'team', 'billing', 'integrations'] },
  { name: 'accounting',weight: 0.03, features: ['expense-list', 'expense-form', 'approval-queue'] },
];

const PATHS = [
  { pages: ['dashboard', 'pipeline', 'projects'], weight: 0.25 },
  { pages: ['dashboard', 'calendar'], weight: 0.20 },
  { pages: ['dashboard', 'settings'], weight: 0.08 },
  { pages: ['dashboard', 'pipeline', 'calendar'], weight: 0.12 },
  { pages: ['dashboard', 'accounting'], weight: 0.05 },
  { pages: ['dashboard'], weight: 0.15 },
  { pages: ['pipeline', 'projects'], weight: 0.08 },
  { pages: ['calendar', 'projects'], weight: 0.07 },
];

const DEVICES = [
  { type: 'mobile', weight: 0.55 },
  { type: 'desktop', weight: 0.35 },
  { type: 'tablet', weight: 0.10 },
];

function weightedRandom<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function seed() {
  console.log('Seeding 500 app sessions...');

  const events: Record<string, unknown>[] = [];
  const now = Date.now();
  const thirtyDaysMs = 30 * 86_400_000;

  for (let s = 0; s < 500; s++) {
    const sessionId = `seed-${s.toString().padStart(4, '0')}`;
    const device = weightedRandom(DEVICES).type;
    const path = weightedRandom(PATHS);
    const sessionStart = now - Math.random() * thirtyDaysMs;
    const completed = Math.random() < 0.35;
    let ts = sessionStart;

    for (const pageName of path.pages) {
      const pageInfo = PAGES.find(p => p.name === pageName)!;
      const dwellMs = randomInt(3000, 60000);

      // page_view event
      events.push({
        session_id: sessionId,
        event_type: 'page_view',
        page_name: pageName,
        dwell_ms: dwellMs,
        device_type: device,
        timestamp: new Date(ts).toISOString(),
      });
      ts += 500;

      // 1-3 element clicks per page
      const clickCount = randomInt(1, 3);
      for (let c = 0; c < clickCount; c++) {
        const feature = pageInfo.features[randomInt(0, pageInfo.features.length - 1)];
        events.push({
          session_id: sessionId,
          event_type: 'element_click',
          page_name: pageName,
          element_id: feature,
          device_type: device,
          timestamp: new Date(ts).toISOString(),
        });
        ts += randomInt(1000, 5000);
      }

      ts += dwellMs;
    }

    // action_complete for completed sessions
    if (completed) {
      const lastPage = path.pages[path.pages.length - 1];
      events.push({
        session_id: sessionId,
        event_type: 'action_complete',
        page_name: lastPage,
        device_type: device,
        timestamp: new Date(ts).toISOString(),
      });
    }
  }

  // Insert in batches of 200
  for (let i = 0; i < events.length; i += 200) {
    const batch = events.slice(i, i + 200);
    const { error } = await supabase.from('app_events').insert(batch);
    if (error) {
      console.error(`Batch ${i} failed:`, error.message);
      return;
    }
    console.log(`  Inserted ${Math.min(i + 200, events.length)} / ${events.length} events`);
  }

  console.log(`Done. ${events.length} events inserted across 500 sessions.`);
}

seed().catch(console.error);
