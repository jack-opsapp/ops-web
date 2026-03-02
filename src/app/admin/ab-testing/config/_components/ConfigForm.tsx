'use client'
import { useState } from 'react'
import type { ABConfig } from '@/lib/ab/ab-queries'

export function ConfigForm({ initial }: { initial: ABConfig }) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/admin/ab-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <label className="block text-xs uppercase tracking-wider text-white/40 mb-2">
          Brand Context <span className="normal-case">(fed directly to AI on each rotation)</span>
        </label>
        <textarea
          value={form.brand_context}
          onChange={e => setForm(f => ({ ...f, brand_context: e.target.value }))}
          rows={10}
          className="w-full bg-white/5 border border-white/10 rounded-lg p-4 text-sm text-white/80 font-mono resize-y focus:outline-none focus:border-white/30"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-white/40 mb-2">
            Min Visitors (per variant)
          </label>
          <input
            type="number"
            value={form.min_visitors}
            onChange={e => setForm(f => ({ ...f, min_visitors: Number(e.target.value) }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white/80 focus:outline-none focus:border-white/30"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-white/40 mb-2">
            Min Days
          </label>
          <input
            type="number"
            value={form.min_days}
            onChange={e => setForm(f => ({ ...f, min_days: Number(e.target.value) }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white/80 focus:outline-none focus:border-white/30"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 text-sm font-mono uppercase tracking-wider bg-white text-black rounded disabled:opacity-50 hover:bg-white/90 transition-colors"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {saved && <span className="text-xs text-green-400">Saved</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  )
}
