'use client'

import { useState } from 'react'
import { AdminPageHeader } from '../../_components/admin-page-header'
import Link from 'next/link'

// ── Section type metadata for the preview catalog ─────────────────────────
interface SectionMeta {
  type: string
  label: string
  description: string
  snapBehavior: 'full-viewport' | 'interstitial'
  props: { name: string; type: string; required: boolean }[]
  usedIn: string[]
  wireframe: React.ReactNode
}

const SECTION_CATALOG: SectionMeta[] = [
  {
    type: 'Hero',
    label: 'Hero',
    description: 'Full-viewport hero with headline, subtext, download/try CTAs, OR divider, inline signup form, trust line, and founder quote (desktop). Wireframe animation on right (desktop) or below title (mobile).',
    snapBehavior: 'full-viewport',
    props: [
      { name: 'headline', type: 'string', required: true },
      { name: 'subtext', type: 'string', required: true },
      { name: 'primaryCtaLabel', type: 'string', required: true },
      { name: 'secondaryCtaLabel', type: 'string', required: true },
    ],
    usedIn: ['hero (embedded)', 'closing (embedded)'],
    wireframe: <HeroWireframe />,
  },
  {
    type: 'DesktopDownload',
    label: 'Desktop Download',
    description: 'Desktop-only section with QR code, SMS text-me-the-link form, and direct App Store link. Hidden on mobile.',
    snapBehavior: 'full-viewport',
    props: [
      { name: 'heading', type: 'string', required: false },
    ],
    usedIn: [],
    wireframe: <DesktopDownloadWireframe />,
  },
  {
    type: 'PainSection',
    label: 'Pain Section',
    description: '3 pain-point cards with titles, bullet lists, and "for" lines. Auto-cycles through cards on mobile; shows all 3 on desktop.',
    snapBehavior: 'full-viewport',
    props: [
      { name: 'heading', type: 'string', required: false },
      { name: 'cards', type: 'Array<{id, title, bullets[], forLine}>', required: true },
    ],
    usedIn: [],
    wireframe: <PainWireframe />,
  },
  {
    type: 'SolutionSection',
    label: 'Solution Section',
    description: '4 feature blocks, each with title, copy, and "why" explanation. Carousel on mobile, 2x2 grid on desktop.',
    snapBehavior: 'full-viewport',
    props: [
      { name: 'heading', type: 'string', required: false },
      { name: 'features', type: 'Array<{title, copy, why}>', required: true },
    ],
    usedIn: [],
    wireframe: <SolutionWireframe />,
  },
  {
    type: 'Starburst',
    label: 'Starburst',
    description: 'Canvas animation interstitial with two large ghost-text words. NOT a snap target — flows between sections.',
    snapBehavior: 'interstitial',
    props: [
      { name: 'leftText', type: 'string', required: false },
      { name: 'rightText', type: 'string', required: false },
    ],
    usedIn: [],
    wireframe: <StarburstWireframe />,
  },
  {
    type: 'TestimonialsSection',
    label: 'Testimonials',
    description: 'Customer quotes with name, trade, and location. Carousel on mobile, 2x2 grid on desktop. Founder quote prepended.',
    snapBehavior: 'full-viewport',
    props: [
      { name: 'heading', type: 'string', required: false },
      { name: 'testimonials', type: 'Array<{quote, name, trade, location}>', required: true },
    ],
    usedIn: [],
    wireframe: <TestimonialsWireframe />,
  },
  {
    type: 'RoadmapSection',
    label: 'Roadmap',
    description: 'Three-tier feature roadmap: Built, In Development, Planned. Accordion on mobile, full grid on desktop.',
    snapBehavior: 'full-viewport',
    props: [
      { name: 'heading', type: 'string', required: false },
      { name: 'builtItems', type: 'string[]', required: true },
      { name: 'inDevItems', type: 'string[]', required: true },
      { name: 'roadmapItems', type: 'string[]', required: true },
    ],
    usedIn: [],
    wireframe: <RoadmapWireframe />,
  },
  {
    type: 'PricingSection',
    label: 'Pricing',
    description: '4 pricing tiers (Free, Starter, Team, Business). Tier data is hardcoded — only heading/subtext are configurable.',
    snapBehavior: 'full-viewport',
    props: [
      { name: 'heading', type: 'string', required: false },
      { name: 'subtext', type: 'string', required: false },
    ],
    usedIn: [],
    wireframe: <PricingWireframe />,
  },
  {
    type: 'InlineSignupForm',
    label: 'Inline Signup Form',
    description: 'Email + password signup form. When standalone (mid-page), renders centered with heading/subtext. When embedded in Hero/ClosingCTA, renders inline. NOT a snap target when standalone.',
    snapBehavior: 'interstitial',
    props: [
      { name: 'location', type: 'string', required: true },
      { name: 'heading', type: 'string', required: false },
      { name: 'subtext', type: 'string', required: false },
    ],
    usedIn: ['hero (embedded)', 'closing (embedded)'],
    wireframe: <InlineSignupWireframe />,
  },
  {
    type: 'FAQSection',
    label: 'FAQ',
    description: 'Accordion-style FAQ. Each item expands/collapses on tap. Fully customizable questions and answers.',
    snapBehavior: 'full-viewport',
    props: [
      { name: 'heading', type: 'string', required: false },
      { name: 'faqs', type: 'Array<{question, answer}>', required: true },
    ],
    usedIn: [],
    wireframe: <FAQWireframe />,
  },
  {
    type: 'ClosingCTA',
    label: 'Closing CTA',
    description: 'Final conversion section with headline, subtext, download/try CTAs, OR divider, and inline signup form. Same layout pattern as Hero but simpler.',
    snapBehavior: 'full-viewport',
    props: [
      { name: 'headline', type: 'string', required: true },
      { name: 'subtext', type: 'string', required: true },
      { name: 'primaryCtaLabel', type: 'string', required: true },
      { name: 'secondaryCtaLabel', type: 'string', required: true },
    ],
    usedIn: [],
    wireframe: <ClosingCTAWireframe />,
  },
]

// ── Static elements (not in registry, always present) ─────────────────────
const STATIC_ELEMENTS = [
  { name: 'HamburgerMenu', description: 'Top-left hamburger menu. Contains Download and Try links. Always visible.' },
  { name: 'StickyCTA', description: 'Sticky bottom bar with Download and Try buttons. Appears after scrolling past Hero.' },
  { name: 'Footer', description: 'Page footer with copyright and links. Always at bottom.' },
  { name: 'SectionTracker', description: 'Invisible wrapper around each section. Measures viewport intersection and dwell time for A/B analytics.' },
]

export default function ComponentPreviewPage() {
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const selected = SECTION_CATALOG.find(s => s.type === selectedType)

  return (
    <div>
      <AdminPageHeader title="COMPONENT CATALOG" caption="All section types available for A/B testing" />

      <div className="px-8 py-6">
        <Link href="/admin/ab-testing" className="text-xs text-white/40 hover:text-white/60 transition-colors">
          &larr; Back to A/B Testing
        </Link>
      </div>

      {/* Section grid */}
      <div className="px-8 pb-8">
        <h2 className="font-mohave text-sm uppercase tracking-wider text-white/40 mb-4">
          Configurable Sections ({SECTION_CATALOG.length})
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-12">
          {SECTION_CATALOG.map((section) => (
            <button
              key={section.type}
              onClick={() => setSelectedType(selectedType === section.type ? null : section.type)}
              className={`text-left rounded-lg border p-4 transition-all ${
                selectedType === section.type
                  ? 'border-[#597794] bg-[#597794]/10'
                  : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mohave text-sm uppercase tracking-wider text-[#E5E5E5]">
                  {section.label}
                </span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                  section.snapBehavior === 'full-viewport'
                    ? 'text-blue-400 bg-blue-400/10'
                    : 'text-amber-400 bg-amber-400/10'
                }`}>
                  {section.snapBehavior === 'full-viewport' ? 'SNAP' : 'INTERSTITIAL'}
                </span>
              </div>
              <p className="text-[11px] text-white/40 leading-relaxed line-clamp-2">
                {section.description}
              </p>
            </button>
          ))}
        </div>

        {/* Selected section detail */}
        {selected && (
          <div className="border border-[#597794]/40 rounded-lg p-6 mb-12 bg-[#597794]/5">
            <div className="flex items-start gap-8">
              {/* Wireframe preview */}
              <div className="flex-shrink-0 w-[280px] h-[400px] bg-black/60 rounded-lg border border-white/10 overflow-hidden relative">
                <div className="absolute top-2 left-2 text-[9px] font-mono text-white/30 uppercase">
                  {selected.type} preview
                </div>
                <div className="w-full h-full flex items-center justify-center p-4">
                  {selected.wireframe}
                </div>
              </div>

              {/* Detail panel */}
              <div className="flex-1 min-w-0">
                <h3 className="font-mohave text-xl uppercase tracking-wider text-[#E5E5E5] mb-2">
                  {selected.label}
                </h3>
                <p className="text-xs text-white/50 leading-relaxed mb-6">
                  {selected.description}
                </p>

                {/* Props table */}
                <h4 className="font-mohave text-xs uppercase tracking-wider text-white/30 mb-2">
                  Configurable Props
                </h4>
                <div className="bg-black/40 rounded p-3 mb-6">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-white/30">
                        <th className="text-left pb-2">Prop</th>
                        <th className="text-left pb-2">Type</th>
                        <th className="text-left pb-2">Required</th>
                      </tr>
                    </thead>
                    <tbody className="text-white/60">
                      {selected.props.map((p) => (
                        <tr key={p.name} className="border-t border-white/5">
                          <td className="py-1.5 text-blue-400">{p.name}</td>
                          <td className="py-1.5">{p.type}</td>
                          <td className="py-1.5">{p.required ? 'yes' : 'no'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Snap behavior */}
                <h4 className="font-mohave text-xs uppercase tracking-wider text-white/30 mb-2">
                  Scroll Behavior
                </h4>
                <p className="text-xs text-white/50 mb-6">
                  {selected.snapBehavior === 'full-viewport'
                    ? 'Full viewport height. Acts as a scroll snap target — the page will snap to this section.'
                    : 'Interstitial — no minimum height, not a snap target. Flows between adjacent sections without forcing a snap stop.'}
                </p>

                {/* Embedded usage */}
                {selected.usedIn.length > 0 && (
                  <>
                    <h4 className="font-mohave text-xs uppercase tracking-wider text-white/30 mb-2">
                      Also Embedded In
                    </h4>
                    <div className="flex gap-2">
                      {selected.usedIn.map((u) => (
                        <span key={u} className="text-[10px] font-mono text-white/40 bg-white/5 px-2 py-1 rounded">
                          {u}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Static elements */}
        <h2 className="font-mohave text-sm uppercase tracking-wider text-white/40 mb-4">
          Static Elements (always present, not configurable)
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {STATIC_ELEMENTS.map((el) => (
            <div key={el.name} className="border border-white/5 rounded-lg p-4 bg-white/[0.02]">
              <span className="font-mohave text-sm uppercase tracking-wider text-white/30">
                {el.name}
              </span>
              <p className="text-[11px] text-white/30 mt-1 leading-relaxed">
                {el.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Wireframe components ──────────────────────────────────────────────────
// Schematic representations of each section layout

function WireRect({ x, y, w, h, label, accent }: { x: number; y: number; w: number; h: number; label?: string; accent?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={2} fill="none" stroke={accent ? '#597794' : '#ffffff'} strokeWidth={0.5} opacity={accent ? 0.6 : 0.2} />
      {label && (
        <text x={x + w / 2} y={y + h / 2 + 3} textAnchor="middle" fontSize={6} fill="#ffffff" opacity={0.3} fontFamily="monospace">
          {label}
        </text>
      )}
    </g>
  )
}

function WireLine({ x, y, w }: { x: number; y: number; w: number }) {
  return <line x1={x} y1={y} x2={x + w} y2={y} stroke="#ffffff" strokeWidth={0.5} opacity={0.15} />
}

function HeroWireframe() {
  return (
    <svg viewBox="0 0 200 300" className="w-full h-full" fill="none">
      {/* Title */}
      <WireLine x={20} y={40} w={90} />
      <WireLine x={20} y={50} w={70} />
      {/* Subtext */}
      <WireLine x={20} y={70} w={80} />
      <WireLine x={20} y={78} w={60} />
      {/* Buttons */}
      <WireRect x={20} y={95} w={60} h={16} label="DOWNLOAD" accent />
      <WireRect x={85} y={95} w={50} h={16} label="TRY IT" />
      {/* Trust line */}
      <text x={20} y={125} fontSize={5} fill="#ffffff" opacity={0.2} fontFamily="monospace">Free · No CC · 5.0★</text>
      {/* OR divider */}
      <line x1={20} y1={140} x2={60} y2={140} stroke="#ffffff" strokeWidth={0.3} opacity={0.15} />
      <text x={72} y={142} fontSize={5} fill="#ffffff" opacity={0.2} fontFamily="monospace" textAnchor="middle">OR</text>
      <line x1={84} y1={140} x2={120} y2={140} stroke="#ffffff" strokeWidth={0.3} opacity={0.15} />
      {/* Signup form */}
      <WireRect x={20} y={150} w={100} h={14} label="email" />
      <WireRect x={20} y={168} w={100} h={14} label="password" />
      <WireRect x={20} y={186} w={100} h={14} label="CREATE ACCOUNT" accent />
      {/* Founder quote */}
      <line x1={20} y1={212} x2={20} y2={240} stroke="#ffffff" strokeWidth={1} opacity={0.15} />
      <WireLine x={25} y={216} w={80} />
      <WireLine x={25} y={224} w={70} />
      <WireLine x={25} y={232} w={50} />
      {/* Animation (right side) */}
      <WireRect x={140} y={40} w={50} h={180} label="ANIM" />
    </svg>
  )
}

function DesktopDownloadWireframe() {
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" fill="none">
      <WireLine x={30} y={30} w={80} />
      {/* QR */}
      <WireRect x={30} y={50} w={50} h={50} label="QR" />
      {/* OR */}
      <line x1={100} y1={55} x2={100} y2={95} stroke="#ffffff" strokeWidth={0.3} opacity={0.15} />
      <text x={100} y={78} fontSize={5} fill="#ffffff" opacity={0.2} fontFamily="monospace" textAnchor="middle">OR</text>
      {/* SMS form */}
      <WireRect x={115} y={55} w={60} h={14} label="phone" />
      <WireRect x={115} y={73} w={40} h={12} label="SEND" accent />
      {/* Direct link */}
      <WireRect x={115} y={95} w={55} h={12} label="APP STORE →" accent />
    </svg>
  )
}

function PainWireframe() {
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" fill="none">
      <WireLine x={20} y={20} w={60} />
      {/* 3 cards */}
      <WireRect x={15} y={40} w={50} h={120} />
      <WireLine x={20} y={52} w={30} />
      <WireLine x={20} y={62} w={35} />
      <WireLine x={20} y={70} w={28} />
      <WireLine x={20} y={78} w={32} />

      <WireRect x={75} y={40} w={50} h={120} />
      <WireLine x={80} y={52} w={30} />
      <WireLine x={80} y={62} w={35} />
      <WireLine x={80} y={70} w={28} />

      <WireRect x={135} y={40} w={50} h={120} />
      <WireLine x={140} y={52} w={30} />
      <WireLine x={140} y={62} w={35} />
      <WireLine x={140} y={70} w={28} />
    </svg>
  )
}

function SolutionWireframe() {
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" fill="none">
      <WireLine x={20} y={20} w={80} />
      {/* 2x2 grid */}
      <WireRect x={15} y={40} w={80} h={60} />
      <WireLine x={20} y={52} w={50} />
      <WireLine x={20} y={62} w={65} />
      <WireLine x={20} y={70} w={55} />

      <WireRect x={105} y={40} w={80} h={60} />
      <WireLine x={110} y={52} w={50} />
      <WireLine x={110} y={62} w={65} />

      <WireRect x={15} y={110} w={80} h={60} />
      <WireLine x={20} y={122} w={50} />
      <WireLine x={20} y={132} w={65} />

      <WireRect x={105} y={110} w={80} h={60} />
      <WireLine x={110} y={122} w={50} />
      <WireLine x={110} y={132} w={65} />
    </svg>
  )
}

function StarburstWireframe() {
  return (
    <svg viewBox="0 0 200 150" className="w-full h-full" fill="none">
      {/* Radial lines */}
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i * 30 * Math.PI) / 180
        return (
          <line
            key={i}
            x1={100}
            y1={75}
            x2={100 + Math.cos(angle) * 70}
            y2={75 + Math.sin(angle) * 50}
            stroke="#597794"
            strokeWidth={0.5}
            opacity={0.2}
          />
        )
      })}
      <text x={25} y={45} fontSize={12} fill="#ffffff" opacity={0.1} fontFamily="monospace" fontWeight="bold">COMMAND</text>
      <text x={110} y={115} fontSize={12} fill="#ffffff" opacity={0.1} fontFamily="monospace" fontWeight="bold">CHAOS</text>
    </svg>
  )
}

function TestimonialsWireframe() {
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" fill="none">
      <WireLine x={20} y={20} w={60} />
      {/* 2x2 quote cards */}
      <WireRect x={15} y={40} w={80} h={55} />
      <text x={22} y={52} fontSize={10} fill="#ffffff" opacity={0.15} fontFamily="serif">&ldquo;</text>
      <WireLine x={30} y={55} w={55} />
      <WireLine x={30} y={63} w={40} />
      <WireLine x={20} y={80} w={30} />

      <WireRect x={105} y={40} w={80} h={55} />
      <text x={112} y={52} fontSize={10} fill="#ffffff" opacity={0.15} fontFamily="serif">&ldquo;</text>
      <WireLine x={120} y={55} w={55} />
      <WireLine x={120} y={63} w={40} />

      <WireRect x={15} y={105} w={80} h={55} />
      <text x={22} y={117} fontSize={10} fill="#ffffff" opacity={0.15} fontFamily="serif">&ldquo;</text>
      <WireLine x={30} y={120} w={55} />
      <WireLine x={30} y={128} w={40} />

      <WireRect x={105} y={105} w={80} h={55} />
      <text x={112} y={117} fontSize={10} fill="#ffffff" opacity={0.15} fontFamily="serif">&ldquo;</text>
      <WireLine x={120} y={120} w={55} />
      <WireLine x={120} y={128} w={40} />
    </svg>
  )
}

function RoadmapWireframe() {
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" fill="none">
      <WireLine x={20} y={20} w={60} />
      {/* Built */}
      <circle cx={25} cy={45} r={4} fill="#597794" opacity={0.4} />
      <text x={33} y={47} fontSize={5} fill="#ffffff" opacity={0.3} fontFamily="monospace">BUILT</text>
      <WireLine x={33} y={55} w={40} />
      {/* In Dev */}
      <circle cx={25} cy={80} r={4} fill="#C4A868" opacity={0.4} />
      <text x={33} y={82} fontSize={5} fill="#ffffff" opacity={0.3} fontFamily="monospace">IN DEV</text>
      <WireLine x={33} y={90} w={50} />
      <WireLine x={33} y={98} w={45} />
      <WireLine x={33} y={106} w={55} />
      <WireLine x={33} y={114} w={40} />
      {/* Planned */}
      <circle cx={25} cy={135} r={4} stroke="#ffffff" strokeWidth={0.5} fill="none" opacity={0.3} />
      <text x={33} y={137} fontSize={5} fill="#ffffff" opacity={0.3} fontFamily="monospace">PLANNED</text>
      <WireLine x={33} y={147} w={50} />
      <WireLine x={33} y={155} w={45} />
    </svg>
  )
}

function PricingWireframe() {
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" fill="none">
      <WireLine x={20} y={20} w={60} />
      {/* 4 tier cards */}
      {[0, 1, 2, 3].map((i) => {
        const x = 12 + i * 46
        return (
          <g key={i}>
            <WireRect x={x} y={40} w={40} h={130} accent={i === 1} />
            <WireLine x={x + 5} y={55} w={20} />
            <text x={x + 20} y={72} fontSize={8} fill="#ffffff" opacity={0.2} fontFamily="monospace" textAnchor="middle">
              {['FREE', '$29', '$79', '$149'][i]}
            </text>
            <WireLine x={x + 5} y={85} w={30} />
            <WireLine x={x + 5} y={93} w={25} />
            <WireLine x={x + 5} y={101} w={30} />
            <WireRect x={x + 5} y={145} w={30} h={12} label="CTA" accent={i === 1} />
          </g>
        )
      })}
    </svg>
  )
}

function InlineSignupWireframe() {
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" fill="none">
      {/* Centered standalone layout */}
      <text x={100} y={50} fontSize={7} fill="#ffffff" opacity={0.3} fontFamily="monospace" textAnchor="middle">READY TO TRY IT?</text>
      <text x={100} y={62} fontSize={5} fill="#ffffff" opacity={0.2} fontFamily="monospace" textAnchor="middle">Create your account in seconds.</text>
      <WireRect x={50} y={80} w={100} h={14} label="email" />
      <WireRect x={50} y={100} w={100} h={14} label="password" />
      <WireRect x={50} y={120} w={100} h={14} label="CREATE ACCOUNT" accent />
      <text x={100} y={150} fontSize={4} fill="#ffffff" opacity={0.15} fontFamily="monospace" textAnchor="middle">Already have an account? Log in</text>
    </svg>
  )
}

function FAQWireframe() {
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" fill="none">
      <WireLine x={20} y={20} w={40} />
      {/* Accordion items */}
      {[0, 1, 2].map((i) => {
        const y = 45 + i * 45
        return (
          <g key={i}>
            <WireRect x={20} y={y} w={160} h={35} />
            <WireLine x={28} y={y + 14} w={100} />
            {i === 0 && (
              <>
                <WireLine x={28} y={y + 24} w={130} />
                <text x={170} y={y + 14} fontSize={8} fill="#ffffff" opacity={0.2} fontFamily="monospace">-</text>
              </>
            )}
            {i !== 0 && (
              <text x={170} y={y + 14} fontSize={8} fill="#ffffff" opacity={0.2} fontFamily="monospace">+</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function ClosingCTAWireframe() {
  return (
    <svg viewBox="0 0 200 260" className="w-full h-full" fill="none">
      {/* Headline */}
      <WireLine x={20} y={40} w={120} />
      <WireLine x={20} y={50} w={90} />
      {/* Subtext */}
      <WireLine x={20} y={70} w={100} />
      {/* Buttons */}
      <WireRect x={20} y={90} w={70} h={16} label="DOWNLOAD" accent />
      <WireRect x={95} y={90} w={55} h={16} label="TRY IT" />
      {/* Trust line */}
      <text x={20} y={122} fontSize={5} fill="#ffffff" opacity={0.2} fontFamily="monospace">Free · No CC · No training</text>
      {/* OR divider */}
      <line x1={20} y1={136} x2={60} y2={136} stroke="#ffffff" strokeWidth={0.3} opacity={0.15} />
      <text x={72} y={138} fontSize={5} fill="#ffffff" opacity={0.2} fontFamily="monospace" textAnchor="middle">OR</text>
      <line x1={84} y1={136} x2={120} y2={136} stroke="#ffffff" strokeWidth={0.3} opacity={0.15} />
      {/* Signup form */}
      <WireRect x={20} y={148} w={100} h={14} label="email" />
      <WireRect x={20} y={166} w={100} h={14} label="password" />
      <WireRect x={20} y={184} w={100} h={14} label="CREATE ACCOUNT" accent />
    </svg>
  )
}
