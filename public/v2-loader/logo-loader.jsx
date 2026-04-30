/* OPS · Logo Loader — pure-X split.
 *
 * Two chevrons from the mark. Upper chevron translates RIGHT, lower chevron
 * translates LEFT. Text types in between, clipped to the opening gap so the
 * collapse happens at the same pace as the chevrons return.
 *
 * Two modes:
 *   • "OPS"                — canonical mark wordmark (SVG paths)
 *   • "OPS JOB MANAGEMENT" — longer line typed in Cake Mono at a natural
 *                            keystroke cadence (not linear)
 *
 * Rules for every mode:
 *   - NO rotation
 *   - NO Y translation
 *   - Only X translation on the chevrons
 *   - No opacity / colour fades on the text — the chevrons clip it
 */

// ── Canonical paths from the OPS lockup ────────────────────────────────────
const CHEV_UPPER = "M826.84,778.71v-350.91l-233.86-116.97-175.42,87.71.1.05,292.23,146.15v292.4l116.92-58.46Z";
const CHEV_LOWER = "M707.58,1119.3v-.06l-292.32-146.2-.08-292.37-116.75,58.48-.2,350.79.09.05,233.89,116.97,175.37-87.66Z";
const OPS_O = "M1129.61,931.61v-344.67c0-69.09,41-97.18,110.84-97.18h74.4c69.84,0,110.84,28.09,110.84,97.18v344.67c0,69.09-41,97.18-110.84,97.18h-74.4c-69.84,0-110.84-28.09-110.84-97.18ZM1308.78,974.13c44.03,0,55.42-13.67,55.42-56.18v-317.34c0-42.51-11.39-56.18-55.42-56.18h-62.25c-44.03,0-55.42,13.67-55.42,56.18v317.34c0,42.51,11.39,56.18,55.42,56.18h62.25Z";
const OPS_P = "M1503.12,494.32h164.74c70.6,0,110.84,28.09,110.84,97.18v129.06c0,69.09-40.24,97.18-110.84,97.18h-103.25v208.02h-61.49V494.32ZM1663.31,763.83c40.24,0,54.66-15.18,54.66-53.9v-107.8c0-38.72-14.42-53.9-54.66-53.9h-98.69v215.61h98.69Z";
const OPS_S = "M1820.46,931.61v-70.6h61.49v56.94c0,42.51,11.39,56.18,55.42,56.18h53.14c44.03,0,55.42-13.67,55.42-56.18v-33.4c0-27.33-9.11-41.75-27.33-55.42l-139.69-94.9c-33.4-22.02-50.87-48.59-50.87-95.66v-51.62c0-69.09,40.24-97.18,110.84-97.18h51.62c69.85,0,110.84,28.09,110.84,97.18v70.6h-61.49v-56.94c0-42.51-11.39-56.18-55.42-56.18h-39.48c-44.03,0-56.18,13.67-56.18,56.18v31.13c0,27.33,9.11,41.76,28.09,54.66l138.93,94.9c33.4,22.78,51.62,49.35,51.62,96.42v53.9c0,69.09-41,97.18-110.84,97.18h-65.29c-69.85,0-110.84-28.09-110.84-97.18Z";

// ── Natural-cadence keystroke timing ───────────────────────────────────────
// Per-char delays in seconds. Humans type in bursts: common letter pairs fast,
// boundaries slower, occasional micro-pauses. Returns an array of cumulative
// timestamps (when each char appears) given a `baseSpeed` (seconds per char).
function naturalKeystrokes(text, baseSpeed) {
  const ts = [];
  let t = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = text[i - 1];
    // Per-char delay factor (multiplier on baseSpeed).
    let f = 1.0;
    if (ch === ' ') {
      // Space itself is quick, but the NEXT letter gets a thinking-pause.
      f = 0.55;
    } else if (prev === ' ') {
      // First letter of a new word — small lead-in delay.
      f = 1.45;
    } else if (/[AEIOU]/i.test(ch)) {
      f = 0.85;  // vowels tend to be quicker
    } else if (ch === prev) {
      f = 0.70;  // double letters are fast
    }
    // Deterministic pseudo-jitter so it doesn't feel mechanical.
    const jitter = 0.85 + 0.3 * ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
    t += baseSpeed * f * jitter;
    ts.push(t);
  }
  return ts;
}

// ── Tweakable defaults ─────────────────────────────────────────────────────

const LOADER_DEFAULTS = /*EDITMODE-BEGIN*/{
  "mode": "OPS",
  "duration": 4.2,
  "holdIn": 0.35,
  "sepEnd": 1.10,
  "typeStart": 0.85,
  "opsTypeSpeed": 0.09,
  "longTypeSpeed": 0.085,
  "holdOut": 3.20,
  "colEnd": 3.95,
  "openGap": 820,
  "longOpenGap": 1500,
  "chevronColor": "#EDEDED",
  "markScale": 1.0,
  "showCaret": true
}/*EDITMODE-END*/;

// ── Scene ──────────────────────────────────────────────────────────────────

function LogoLoaderScene({ cfg }) {
  const t = useTime();

  const isLong = cfg.mode === 'LONG';
  const longText = 'OPS JOB MANAGEMENT';

  // Type timestamps (cumulative, seconds from typeStart)
  const longTs = React.useMemo(
    () => naturalKeystrokes(longText, cfg.longTypeSpeed),
    [cfg.longTypeSpeed]
  );
  const opsTs = React.useMemo(() => {
    // Short wordmark: three quick, slightly varied keystrokes.
    const speed = cfg.opsTypeSpeed;
    return [speed * 1.0, speed * 1.0 + speed * 0.75, speed * 1.0 + speed * 0.75 + speed * 0.85];
  }, [cfg.opsTypeSpeed]);

  const typeTs = isLong ? longTs : opsTs;
  const typeEnd = cfg.typeStart + typeTs[typeTs.length - 1];

  // Separation progress
  const openGap = isLong ? cfg.longOpenGap : cfg.openGap;
  const sep = (() => {
    if (t <= cfg.holdIn) return 0;
    if (t < cfg.sepEnd) {
      return Easing.easeInOutCubic((t - cfg.holdIn) / (cfg.sepEnd - cfg.holdIn));
    }
    if (t < cfg.holdOut) return 1;
    if (t < cfg.colEnd) {
      return 1 - Easing.easeInOutCubic((t - cfg.holdOut) / (cfg.colEnd - cfg.holdOut));
    }
    return 0;
  })();
  const dx = openGap * sep;

  // How many chars are visible
  const visibleCount = (() => {
    if (t < cfg.typeStart) return 0;
    const elapsed = t - cfg.typeStart;
    let n = 0;
    for (let i = 0; i < typeTs.length; i++) {
      if (elapsed >= typeTs[i]) n = i + 1; else break;
    }
    return n;
  })();

  const textColor = cfg.chevronColor;

  // ── Layout ──────────────────────────────────────────────────────────────
  const CHEV_CX = 562.20;
  const CHEV_CY = 802.00;
  const OPS_CX = 1612.95;
  const OPS_CY = 761.55;
  const opsShiftX = CHEV_CX - OPS_CX;   // ≈ -1050.75
  const opsShiftY = CHEV_CY - OPS_CY;   // ≈  40.45

  const vbPad = isLong ? 1800 : 1100;
  const vbX = CHEV_CX - (2405.66 / 2) - vbPad;
  const vbW = 2405.66 + vbPad * 2;
  const vbH = 1511.21;

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#000',
    }}>
      <svg
        viewBox={`${vbX} 0 ${vbW} ${vbH}`}
        style={{
          width: `${cfg.markScale * (isLong ? 88 : 72)}%`,
          maxWidth: isLong ? 1500 : 1200,
          height: 'auto',
          overflow: 'visible',
        }}
      >
        {/* Clip the text layer to the opening gap between the chevrons. */}
        <defs>
          <clipPath id="ops-gap-clip">
            <rect
              x={CHEV_CX - dx}
              y={-200}
              width={2 * dx}
              height={vbH + 400}
            />
          </clipPath>
        </defs>

        <g clipPath="url(#ops-gap-clip)">
          {isLong ? (
            <LongText
              text={longText}
              visibleCount={visibleCount}
              totalCount={typeTs.length}
              color={textColor}
              centerX={CHEV_CX}
              centerY={CHEV_CY}
              showCaret={cfg.showCaret}
              t={t}
              typingDone={t >= typeEnd}
              afterHold={t >= cfg.holdOut}
            />
          ) : (
            <OpsMarkText
              visibleCount={visibleCount}
              color={textColor}
              opsShiftX={opsShiftX}
              opsShiftY={opsShiftY}
              showCaret={cfg.showCaret}
              t={t}
              typingDone={t >= typeEnd}
              afterHold={t >= cfg.holdOut}
            />
          )}
        </g>

        {/* UPPER chevron — slides RIGHT. Pure X. */}
        <path d={CHEV_UPPER} fill={cfg.chevronColor} transform={`translate(${dx}, 0)`} />
        {/* LOWER chevron — slides LEFT. Pure X. */}
        <path d={CHEV_LOWER} fill={cfg.chevronColor} transform={`translate(${-dx}, 0)`} />
      </svg>
    </div>
  );
}

// ── OPS mark wordmark (SVG paths) ─────────────────────────────────────────
function OpsMarkText({ visibleCount, color, opsShiftX, opsShiftY, showCaret, t, typingDone, afterHold }) {
  const caretXs = [1129.61, 1503.12, 1820.46];
  const caretActive = showCaret && !afterHold && visibleCount < 3;
  return (
    <g fill={color} transform={`translate(${opsShiftX}, ${opsShiftY})`}>
      {visibleCount >= 1 && <path d={OPS_O} />}
      {visibleCount >= 2 && <path d={OPS_P} />}
      {visibleCount >= 3 && <path d={OPS_S} />}
      {caretActive && (() => {
        const caretX = caretXs[visibleCount];
        const blink = (Math.floor(t * 3) % 2 === 0) ? 1 : 0.25;
        return (
          <rect x={caretX} y={1040} width={250} height={40}
            fill={color} opacity={blink * 0.85} />
        );
      })()}
    </g>
  );
}

// ── "OPS JOB MANAGEMENT" — typed in Cake Mono ─────────────────────────────
function LongText({ text, visibleCount, totalCount, color, centerX, centerY, showCaret, t, typingDone, afterHold }) {
  // Pick a size that fits comfortably within the gap's vertical extent.
  // Chevron pair spans y ≈ [427, 1177] → 750u tall. Use ~400u letters.
  const fontSize = 400;
  // Monospace → estimate advance. Cake Mono ~0.60em. We'll let the browser
  // do real layout and just show N chars of the string.
  const shown = text.slice(0, visibleCount);
  const caretChar = '_';
  const caretActive = showCaret && !afterHold && visibleCount < totalCount;
  const blink = (Math.floor(t * 3) % 2 === 0) ? 1 : 0.35;

  return (
    <g>
      <text
        x={centerX}
        y={centerY}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        style={{
          fontFamily: '"Cake Mono", "JetBrains Mono", ui-monospace, monospace',
          fontWeight: 400,
          fontSize: `${fontSize}px`,
          letterSpacing: '0.02em',
          whiteSpace: 'pre',
        }}
      >
        {shown}
        {caretActive && (
          <tspan style={{ opacity: blink }}>{caretChar}</tspan>
        )}
      </text>
    </g>
  );
}

function App() {
  const [cfg, setCfg] = useTweaks(LOADER_DEFAULTS);

  return (
    <>
      <Stage
        width={1280}
        height={720}
        duration={cfg.duration}
        background="#000000"
        loop
        autoplay
      >
        <LogoLoaderScene cfg={cfg} />
      </Stage>

      <TweaksPanel title="Tweaks">
        <TweakSection title="Variant">
          <TweakRadio
            label="Wordmark"
            value={cfg.mode}
            options={[
              { value: 'OPS', label: 'OPS (mark)' },
              { value: 'LONG', label: 'OPS JOB MANAGEMENT' },
            ]}
            onChange={(v) => setCfg({ mode: v })}
          />
        </TweakSection>

        <TweakSection title="Timing">
          <TweakSlider label="Total duration" value={cfg.duration} min={2} max={8} step={0.1}
            onChange={(v) => setCfg({ duration: v })} format={(v) => `${v.toFixed(1)}s`} />
          <TweakSlider label="Hold in (rest)" value={cfg.holdIn} min={0} max={1.5} step={0.05}
            onChange={(v) => setCfg({ holdIn: v })} format={(v) => `${v.toFixed(2)}s`} />
          <TweakSlider label="Separation end" value={cfg.sepEnd} min={0.2} max={2.5} step={0.05}
            onChange={(v) => setCfg({ sepEnd: v })} format={(v) => `${v.toFixed(2)}s`} />
          <TweakSlider label="Type start" value={cfg.typeStart} min={0.2} max={3} step={0.05}
            onChange={(v) => setCfg({ typeStart: v })} format={(v) => `${v.toFixed(2)}s`} />
          <TweakSlider label="OPS keystroke speed" value={cfg.opsTypeSpeed} min={0.04} max={0.3} step={0.01}
            onChange={(v) => setCfg({ opsTypeSpeed: v })} format={(v) => `${v.toFixed(2)}s/ch`} />
          <TweakSlider label="Long keystroke speed" value={cfg.longTypeSpeed} min={0.04} max={0.2} step={0.005}
            onChange={(v) => setCfg({ longTypeSpeed: v })} format={(v) => `${v.toFixed(3)}s/ch`} />
          <TweakSlider label="Hold out (steady)" value={cfg.holdOut} min={1} max={7} step={0.05}
            onChange={(v) => setCfg({ holdOut: v })} format={(v) => `${v.toFixed(2)}s`} />
          <TweakSlider label="Collapse end" value={cfg.colEnd} min={1.5} max={8} step={0.05}
            onChange={(v) => setCfg({ colEnd: v })} format={(v) => `${v.toFixed(2)}s`} />
        </TweakSection>

        <TweakSection title="Layout">
          <TweakSlider label="OPS chevron travel" value={cfg.openGap} min={0} max={1600} step={10}
            onChange={(v) => setCfg({ openGap: v })} format={(v) => `${v}u`} />
          <TweakSlider label="Long chevron travel" value={cfg.longOpenGap} min={400} max={2400} step={10}
            onChange={(v) => setCfg({ longOpenGap: v })} format={(v) => `${v}u`} />
          <TweakSlider label="Mark scale" value={cfg.markScale} min={0.4} max={1.4} step={0.05}
            onChange={(v) => setCfg({ markScale: v })} format={(v) => `${(v*100).toFixed(0)}%`} />
          <TweakToggle label="Typewriter caret" value={cfg.showCaret}
            onChange={(v) => setCfg({ showCaret: v })} />
        </TweakSection>

        <TweakSection title="Colour">
          <TweakColor label="Chevrons & text" value={cfg.chevronColor}
            onChange={(v) => setCfg({ chevronColor: v })} />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

Object.assign(window, { App, LogoLoaderScene });
