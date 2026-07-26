# Audience Intelligence Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Claude Design "Audience Intelligence" mockup into a grounded React product workspace at `/peton` that reads Codex's `launch-intelligence/vitality-chew.json`.

**Architecture:** A server page (`app/peton/page.tsx`) statically imports the JSON and passes it as props into a pure client component tree. All non-trivial logic (matrix build, confidence, signal-map, filtering) lives in `lib/launch-intelligence/transforms.ts` as pure functions, unit-tested with `node --test`. Components are thin and scoped-styled via a CSS Module; the shared `globals.css` is never touched.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript (strict) · CSS Modules · `next/font/google` · `node --test`.

**References:**
- Spec: `docs/superpowers/specs/2026-06-25-audience-intelligence-workspace-design.md`
- Visual source of truth (markup + styling): Claude Design `Audience Intelligence.dc.html` (project `728aba11-5eda-4b9c-993a-6c219090d3a0`). Re-fetch via `DesignSync get_file` if not in context.
- Contract: `launch-intelligence/vitality-chew.json` (real, generated).

**Conventions:** Import data via the `@/` alias. TDD applies to `transforms.ts` (pure, testable). React components are verified by `npm run build` + dev-server screenshots (no RTL/jsdom in this repo). Commit after each task.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/launch-intelligence/schema.ts` | TS types mirroring the real JSON contract |
| `lib/launch-intelligence/transforms.ts` | Pure JSON→view-model functions (colors, matrix, confidence, signal map, filters) |
| `lib/launch-intelligence/transforms.test.mjs` | `node --test` coverage for transforms |
| `components/audience-intelligence/workspace.module.css` | Scoped palette/layout (own fonts/colors) |
| `components/audience-intelligence/fonts.ts` | `next/font` loaders (Fredoka, Hanken Grotesk, Space Mono) |
| `components/audience-intelligence/Workspace.tsx` | `'use client'` shell: state, view router |
| `components/audience-intelligence/Sidebar.tsx` | brand, product switcher, nav, footer |
| `components/audience-intelligence/Topbar.tsx` | crumb, title, pipeline pills, mode chips |
| `components/audience-intelligence/views/OverviewView.tsx` | KPIs, pipeline explainer, audience, CTA |
| `components/audience-intelligence/views/MessagingStudio.tsx` | 3×3 board + Signal Map + evidence rail |
| `components/audience-intelligence/views/EvidenceView.tsx` | searchable evidence table |
| `components/audience-intelligence/views/CreativeView.tsx` | image slots + Dogist voice |
| `components/audience-intelligence/ImageSlot.tsx` | drag-drop image → localStorage |
| `app/peton/page.tsx` | MODIFY: import JSON, render `<Workspace>` |
| `app/peton-legacy/page.tsx` | CREATE: render old `<PetonDashboard>` (temp) |

---

## Task 1: Data contract types (`schema.ts`)

**Files:**
- Create: `lib/launch-intelligence/schema.ts`

- [ ] **Step 1: Write the types** (mirror the real file exactly — verified against `launch-intelligence/vitality-chew.json`)

```ts
// lib/launch-intelligence/schema.ts
// Types mirror the generated launch-intelligence/<sku>.json contract.
// If Codex renames a field, this file (and transforms.ts) are the only places to update.

export type SourceType = 'audience_comment' | 'dogist_caption' | 'deck_brand_guardrail' | 'business_interpretation';

export interface EvidenceQuote {
  id: string; source_type: string; text: string; likes: number;
  post_id: string; post_url: string; post_title: string; signal_score: number;
}

export interface LanguageToBorrow { text: string; source: string; source_id?: string; why?: string; }

export interface Ingredient { name: string; role: string; }
export interface ClaimToTest { id: string; label: string; keywords: string[]; }
export interface Guardrail { id: string; text: string; }
export interface Competitor { name: string; deck_positioning: string; deck_gap: string; }

export interface AudienceContext {
  instagram_followers: string; tiktok_followers: string; social_reach: string;
  female_share: string; age_25_34_share: string;
}
export interface DeckContext {
  brand_promise: string; target_insight: string; brand_essence_statement: string;
  audience_context: AudienceContext;
}
export interface Brief {
  sku: string; slug: string; active_question: string; launch_timing: string;
  positioning: string[]; ingredients: Ingredient[]; claims_to_test: ClaimToTest[];
  audience_jobs: string[]; brand_guardrails: Guardrail[]; competitors: Competitor[];
  channels: string[]; trust_constraints: string[]; deck_context: DeckContext;
  external_market_context: { present: boolean; source_type: string; items: unknown[]; use_policy: string };
}

export interface CorpusSummary {
  generated_at: string; creator_handle: string; posts_analyzed: number;
  comments_analyzed: number; unique_commenters: number; high_signal_comments: number;
  total_comment_likes: number; snapshot_note: string;
}

export interface EvidenceBreadth {
  matched_comments: number; high_signal_comments: number; posts: number; authors: number;
  total_comment_likes: number; top_post_share: number; high_intent_comments: number;
}
export interface SourceClusterLimit { source_cluster_id: string; risk_flags: string[]; top_post_share: number; }
export interface KeyTension { text: string; source_type: string; }
export interface AudienceMode {
  id: string; label: string; role: string; evidence_breadth: EvidenceBreadth;
  evidence_quality_flags: string[]; claim_alignment: string[]; key_tensions: KeyTension[];
  trust_risks: string[]; representative_quotes: EvidenceQuote[];
  top_posts: { post_id: string; comments_in_mode: number; post_url: string; post_title: string }[];
  source_cluster_ids: string[]; source_cluster_limits: SourceClusterLimit[];
}

export interface SupportedClaim { claim_id: string; label: string; score: number; fit: string; }
export interface ModeMatch {
  audience_mode: string; audience_mode_label: string; fit_score: number; fit: string;
  supported_claims: SupportedClaim[]; objections: string[];
  evidence_quality_flags: string[]; source_cluster_ids: string[];
}
export interface SkuSignalMap {
  sku: string; active_question: string;
  external_market_context: Brief['external_market_context'];
  mode_matches: ModeMatch[];
}

export interface Angle {
  audience_mode: string; audience_mode_label: string; dogist_style_angle: string;
  why_it_resonates: string; language_to_borrow: LanguageToBorrow[];
  evidence_quotes: EvidenceQuote[]; claims_to_avoid: string[];
  validation_prompt: string; source_note: string;
}
export interface ValueProp { id: string; value_prop: string; claim_focus: string[]; angles: Angle[]; }
export interface MessageArchitecture {
  active_question: string;
  interpretation_stages: { id: string; description: string }[];
  value_props: ValueProp[];
}

export interface VoiceProfile {
  generated_at: string; source_note: string; post_titles_analyzed: number;
  cadence_patterns: { id: string; label: string; description: string; examples: EvidenceQuote[] }[];
  tone_markers: string[]; deck_guardrails: Guardrail[]; do_rules: string[]; avoid_rules: string[];
}

export interface DogistVoiceExample {
  source: string; post_id: string; post_url: string; text: string;
  reason: string; voice_pattern_id: string; voice_pattern_label: string;
}
export interface EvidenceIndex {
  audience_comments: (EvidenceQuote & { audience_mode: string; audience_mode_label: string })[];
  dogist_voice_examples: DogistVoiceExample[];
  evidence_policy: string[];
}

// Optional, first-class signal map Codex may add later. Until then we derive it.
export interface SignalQuadrant { id: string; label: string; sub: string; count: number; value_prop_id?: string; }
export interface SignalMap { quadrants: SignalQuadrant[]; x_axis: [string, string]; y_axis: [string, string]; }

export interface LaunchIntelligence {
  brief: Brief;
  corpus_summary: CorpusSummary;
  voice_profile: VoiceProfile;
  audience_modes: AudienceMode[];
  sku_signal_map: SkuSignalMap;
  message_architecture: MessageArchitecture;
  trust_guardrails: unknown;   // available, not surfaced in first cut
  validation_plan: unknown;    // available, not surfaced in first cut
  evidence_index: EvidenceIndex;
  signal_map?: SignalMap;      // present only once Codex adds it
}
```

- [ ] **Step 2: Type-check against the real file**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). This confirms the types are valid TS.

- [ ] **Step 3: Commit**

```bash
git add lib/launch-intelligence/schema.ts
git commit -m "feat(peton): add launch-intelligence contract types"
```

---

## Task 2: Mode colors + message matrix transform (TDD)

**Files:**
- Create: `lib/launch-intelligence/transforms.ts`
- Test: `lib/launch-intelligence/transforms.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// lib/launch-intelligence/transforms.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../../launch-intelligence/vitality-chew.json' with { type: 'json' };
import { modeColor, buildMessageMatrix } from './transforms.ts';

test('modeColor is stable and defined for every mode', () => {
  for (const m of data.audience_modes) {
    assert.match(modeColor(m.id), /^#[0-9A-Fa-f]{6}$/);
  }
  assert.equal(modeColor('wellness_routine_builders'), modeColor('wellness_routine_builders'));
});

test('buildMessageMatrix returns 3 rows x 3 cells = 9 angles', () => {
  const rows = buildMessageMatrix(data);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.cells.length, 3);
    assert.ok(row.valueProp.length > 0);
  }
  const cells = rows.flatMap((r) => r.cells);
  assert.equal(cells.length, 9);
  // each cell carries its own mode (columns are not a shared axis)
  for (const c of cells) {
    assert.ok(c.modeId && c.modeLabel && c.line);
    assert.match(c.color, /^#[0-9A-Fa-f]{6}$/);
    assert.ok(c.key.match(/^\d+_\d+$/));
  }
});
```

> Note: `node --test` runs `.ts` via Node 20's type-stripping. If the runner rejects the `.ts` import, change the test import to `./transforms.mjs` and author transforms as `.mjs` with JSDoc types instead — confirm which works in Step 2 before proceeding.

- [ ] **Step 2: Run the test (expect fail)**

Run: `node --test lib/launch-intelligence/transforms.test.mjs`
Expected: FAIL ("Cannot find module './transforms.ts'").

- [ ] **Step 3: Implement colors + matrix**

```ts
// lib/launch-intelligence/transforms.ts
import type { LaunchIntelligence, ValueProp, Angle } from './schema';

export const MODE_COLORS: Record<string, string> = {
  ingredient_scrutinists: '#2E9FDD',
  senior_care_caregivers: '#F2683C',
  picky_dog_pragmatists: '#EDA426',
  wellness_routine_builders: '#2FA98C',
  homemade_diet_optimizers: '#8C6BD8',
};
const FALLBACK_COLORS = ['#2E9FDD', '#F2683C', '#EDA426', '#2FA98C', '#8C6BD8'];
export function modeColor(modeId: string): string {
  if (MODE_COLORS[modeId]) return MODE_COLORS[modeId];
  let h = 0;
  for (const ch of modeId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

export interface MatrixCell {
  key: string;            // "<vpIndex>_<angleIndex>"
  vpIndex: number; angleIndex: number;
  modeId: string; modeLabel: string; color: string;
  line: string;           // dogist_style_angle
  barW: string;           // e.g. "63%"
  confidence: string;     // HIGH CONFIDENCE | MEDIUM | EARLY SIGNAL
  tag: 'STRONG' | 'TEST';
}
export interface MatrixRow { valueProp: string; essence: string; claimFocus: string[]; cells: MatrixCell[]; }

function maxHighSignal(data: LaunchIntelligence): number {
  return Math.max(...data.audience_modes.map((m) => m.evidence_breadth.high_signal_comments), 1);
}
function modeHighSignal(data: LaunchIntelligence, modeId: string): number {
  return data.audience_modes.find((m) => m.id === modeId)?.evidence_breadth.high_signal_comments ?? 0;
}

export function buildMessageMatrix(data: LaunchIntelligence): MatrixRow[] {
  const max = maxHighSignal(data);
  return data.message_architecture.value_props.map((vp: ValueProp, vi: number) => ({
    valueProp: vp.value_prop,
    essence: vp.claim_focus.join(' · '),
    claimFocus: vp.claim_focus,
    cells: vp.angles.map((angle: Angle, ai: number) => {
      const { confidence, tag } = deriveConfidence(data, vp, angle); // Task 3
      const hs = modeHighSignal(data, angle.audience_mode);
      return {
        key: `${vi}_${ai}`, vpIndex: vi, angleIndex: ai,
        modeId: angle.audience_mode, modeLabel: angle.audience_mode_label,
        color: modeColor(angle.audience_mode), line: angle.dogist_style_angle,
        barW: `${Math.round((hs / max) * 100)}%`, confidence, tag,
      };
    }),
  }));
}
```

> `deriveConfidence` is defined in Task 3. Add a temporary stub returning `{confidence:'MEDIUM', tag:'TEST'}` now so Task 2 compiles, and replace it in Task 3. (Stub:)
> ```ts
> export function deriveConfidence(_d: LaunchIntelligence, _vp: ValueProp, _a: Angle) { return { confidence: 'MEDIUM', tag: 'TEST' as const }; }
> ```

- [ ] **Step 4: Run the test (expect pass)**

Run: `node --test lib/launch-intelligence/transforms.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/launch-intelligence/transforms.ts lib/launch-intelligence/transforms.test.mjs
git commit -m "feat(peton): mode colors + 3x3 message matrix transform"
```

---

## Task 3: Confidence derivation (TDD)

**Files:**
- Modify: `lib/launch-intelligence/transforms.ts` (replace the stub)
- Modify: `lib/launch-intelligence/transforms.test.mjs`

- [ ] **Step 1: Add failing tests**

```js
import { deriveConfidence, cellScore } from './transforms.ts';

test('cellScore uses the best of mode fit and relevant claim scores', () => {
  const vp = data.message_architecture.value_props[0]; // claim_focus: healthy_aging, brain_health, joint_support
  const angle = vp.angles.find((a) => a.audience_mode === 'wellness_routine_builders');
  const { score } = cellScore(data, vp, angle);
  // wellness has joint_support=88 within this vp's claim focus → high
  assert.ok(score >= 75, `expected >=75, got ${score}`);
});

test('deriveConfidence thresholds', () => {
  assert.deepEqual(deriveConfidence2(80), { confidence: 'HIGH CONFIDENCE', tag: 'STRONG' });
  assert.deepEqual(deriveConfidence2(60), { confidence: 'MEDIUM', tag: 'TEST' });
  assert.deepEqual(deriveConfidence2(40), { confidence: 'EARLY SIGNAL', tag: 'TEST' });
});
```

> Export a pure score→label helper named `deriveConfidence2(score)` for threshold testing, and keep `deriveConfidence(data, vp, angle)` as the data-driven wrapper.

- [ ] **Step 2: Run (expect fail)**

Run: `node --test lib/launch-intelligence/transforms.test.mjs`
Expected: FAIL ("cellScore is not a function").

- [ ] **Step 3: Implement (replace the stub from Task 2)**

```ts
export function cellScore(data: LaunchIntelligence, vp: ValueProp, angle: Angle): { score: number; flags: string[] } {
  const mm = data.sku_signal_map.mode_matches.find((m) => m.audience_mode === angle.audience_mode);
  if (!mm) return { score: 0, flags: [] };
  const claimScores = vp.claim_focus.map(
    (cid) => mm.supported_claims.find((c) => c.claim_id === cid)?.score ?? 0
  );
  let base = Math.max(mm.fit_score, ...claimScores);
  const mode = data.audience_modes.find((m) => m.id === angle.audience_mode);
  const heavy = mode?.source_cluster_limits?.some((l) => l.risk_flags?.includes('single_post_thread_heavy'));
  if (heavy) base -= 15;
  return { score: Math.max(0, base), flags: mm.evidence_quality_flags };
}

export function deriveConfidence2(score: number): { confidence: string; tag: 'STRONG' | 'TEST' } {
  if (score >= 75) return { confidence: 'HIGH CONFIDENCE', tag: 'STRONG' };
  if (score >= 55) return { confidence: 'MEDIUM', tag: 'TEST' };
  return { confidence: 'EARLY SIGNAL', tag: 'TEST' };
}

export function deriveConfidence(data: LaunchIntelligence, vp: ValueProp, angle: Angle) {
  return deriveConfidence2(cellScore(data, vp, angle).score);
}
```

- [ ] **Step 4: Run (expect pass)**

Run: `node --test lib/launch-intelligence/transforms.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/launch-intelligence/transforms.ts lib/launch-intelligence/transforms.test.mjs
git commit -m "feat(peton): honest confidence from sku_signal_map fit + flags"
```

---

## Task 4: Signal Map (derived placeholder) + filters/top-voices (TDD)

**Files:**
- Modify: `lib/launch-intelligence/transforms.ts`
- Modify: `lib/launch-intelligence/transforms.test.mjs`

- [ ] **Step 1: Add failing tests**

```js
import { deriveSignalMap, topVoices, filterEvidence } from './transforms.ts';

test('deriveSignalMap yields 4 counted quadrants', () => {
  const sm = deriveSignalMap(data);
  assert.equal(sm.quadrants.length, 4);
  for (const q of sm.quadrants) { assert.ok(q.label); assert.equal(typeof q.count, 'number'); }
});
test('topVoices sorts by likes desc', () => {
  const top = topVoices(data, 3);
  assert.equal(top.length, 3);
  assert.ok(top[0].likes >= top[1].likes && top[1].likes >= top[2].likes);
});
test('filterEvidence filters by mode and query', () => {
  const mode = data.audience_modes[0].id;
  const byMode = filterEvidence(data, { seg: mode, q: '' });
  assert.ok(byMode.every((c) => c.audience_mode === mode));
  const byQ = filterEvidence(data, { seg: null, q: 'blueberr' });
  assert.ok(byQ.every((c) => c.text.toLowerCase().includes('blueberr')));
});
```

- [ ] **Step 2: Run (expect fail)** — `node --test lib/launch-intelligence/transforms.test.mjs` → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { EvidenceIndex, SignalMap } from './schema';

// DERIVED PLACEHOLDER — replace with data.signal_map once Codex ships a first-class field.
// Axes are corpus-meaningful (functional↔emotional × pain↔aspiration); counts use mode evidence breadth.
export function deriveSignalMap(data: LaunchIntelligence): SignalMap {
  if (data.signal_map) return data.signal_map;
  const byId = (id: string) => data.audience_modes.find((m) => m.id === id)?.evidence_breadth.high_signal_comments ?? 0;
  return {
    x_axis: ['FUNCTIONAL', 'EMOTIONAL'],
    y_axis: ['ASPIRATION', 'PAIN'],
    quadrants: [
      { id: 'thrive', label: 'Thrive signals', sub: 'functional · aspiration', count: byId('wellness_routine_builders') },
      { id: 'pride', label: 'Pride & bonding', sub: 'emotional · aspiration', count: byId('senior_care_caregivers') },
      { id: 'scrutiny', label: 'Ingredient scrutiny', sub: 'functional · pain', count: byId('ingredient_scrutinists') },
      { id: 'pickiness', label: 'Picky & practical', sub: 'emotional · pain', count: byId('picky_dog_pragmatists') },
    ],
  };
}

export function topVoices(data: LaunchIntelligence, n: number): EvidenceIndex['audience_comments'] {
  return [...data.evidence_index.audience_comments].sort((a, b) => b.likes - a.likes).slice(0, n);
}

export function filterEvidence(data: LaunchIntelligence, { seg, q }: { seg: string | null; q: string }) {
  const ql = q.trim().toLowerCase();
  return data.evidence_index.audience_comments
    .filter((c) => (!seg || c.audience_mode === seg) && (!ql || c.text.toLowerCase().includes(ql)))
    .sort((a, b) => b.likes - a.likes);
}
```

- [ ] **Step 4: Run (expect pass)** — `node --test lib/launch-intelligence/transforms.test.mjs` → PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/launch-intelligence/transforms.ts lib/launch-intelligence/transforms.test.mjs
git commit -m "feat(peton): derived signal map + evidence filters/top-voices"
```

---

## Task 5: Fonts + scoped stylesheet

**Files:**
- Create: `components/audience-intelligence/fonts.ts`
- Create: `components/audience-intelligence/workspace.module.css`

- [ ] **Step 1: Font loaders**

```ts
// components/audience-intelligence/fonts.ts
import { Fredoka, Hanken_Grotesk, Space_Mono } from 'next/font/google';
export const fredoka = Fredoka({ subsets: ['latin'], weight: ['400','500','600','700'], variable: '--ai-font-display' });
export const hanken = Hanken_Grotesk({ subsets: ['latin'], weight: ['400','500','600','700','800'], variable: '--ai-font-body' });
export const spaceMono = Space_Mono({ subsets: ['latin'], weight: ['400','700'], variable: '--ai-font-mono' });
```

- [ ] **Step 2: Scoped CSS Module** — define `.root` with the palette CSS vars from the spec (`--ai-bg:#F6F5F0; --ai-panel:#fff; --ai-border:#E7E5DD; --ai-ink:#16150F; --ai-muted:#9A968C; --ai-accent:#2E9FDD; --ai-green:#3DA85E`) and the `@keyframes pulseDot`. Add layout classes used by components (`.shell`, `.sidebar`, `.main`, `.topbar`, `.card`, `.kpi`, `.matrix`, `.cell`, `.rail`, `.quad`, `.chip`, `.table`, `.slot`). Mirror the mockup's inline styles, converted to classes. Keep all selectors under `.root` so nothing leaks.

```css
/* components/audience-intelligence/workspace.module.css (excerpt — fill remaining classes from the mockup) */
.root { --ai-bg:#F6F5F0; --ai-panel:#fff; --ai-border:#E7E5DD; --ai-ink:#16150F; --ai-muted:#9A968C; --ai-accent:#2E9FDD; --ai-green:#3DA85E;
  display:flex; min-height:100vh; width:100%; background:var(--ai-bg); color:var(--ai-ink);
  font-family:var(--ai-font-body),system-ui,sans-serif; }
.root :global(*){ box-sizing:border-box; }
@keyframes pulseDot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.3;transform:scale(.6)} }
.sidebar { flex:0 0 244px; background:#F1F0EA; border-right:1px solid var(--ai-border); position:sticky; top:0; height:100vh; display:flex; flex-direction:column; }
.main { flex:1; min-width:0; display:flex; flex-direction:column; }
/* …port the rest of the mockup's panels/cards/matrix/rail/table/slot styles here… */
```

- [ ] **Step 3: Verify build compiles** — Run: `npm run build` Expected: PASS (fonts + CSS module compile; no usage yet is fine).

- [ ] **Step 4: Commit**

```bash
git add components/audience-intelligence/fonts.ts components/audience-intelligence/workspace.module.css
git commit -m "feat(peton): scoped fonts + stylesheet for workspace"
```

---

## Task 6: Workspace shell + state + routing

**Files:**
- Create: `components/audience-intelligence/Workspace.tsx`
- Modify: `app/peton/page.tsx`
- Create: `app/peton-legacy/page.tsx`

- [ ] **Step 1: Park the legacy dashboard**

```tsx
// app/peton-legacy/page.tsx
import type { Metadata } from 'next';
import PetonDashboard from '../../components/PetonDashboard';
export const metadata: Metadata = { title: 'Peton (legacy)', robots: { index: false, follow: false } };
export default function PetonLegacyPage() { return <PetonDashboard />; }
```

- [ ] **Step 2: Workspace shell** (state mirrors the mockup's `DCLogic.state`)

```tsx
// components/audience-intelligence/Workspace.tsx
'use client';
import { useMemo, useState } from 'react';
import type { LaunchIntelligence } from '@/lib/launch-intelligence/schema';
import { buildMessageMatrix, deriveSignalMap } from '@/lib/launch-intelligence/transforms';
import { fredoka, hanken, spaceMono } from './fonts';
import styles from './workspace.module.css';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import OverviewView from './views/OverviewView';
import MessagingStudio from './views/MessagingStudio';
import EvidenceView from './views/EvidenceView';
import CreativeView from './views/CreativeView';

export type View = 'overview' | 'messaging' | 'evidence' | 'creative';
export interface WorkspaceState { view: View; seg: string | null; cell: string | null; quad: string | null; q: string; copied: boolean; }

export default function Workspace({ data }: { data: LaunchIntelligence }) {
  const [s, setS] = useState<WorkspaceState>({ view: 'messaging', seg: null, cell: null, quad: null, q: '', copied: false });
  const set = (p: Partial<WorkspaceState>) => setS((prev) => ({ ...prev, ...p }));
  const matrix = useMemo(() => buildMessageMatrix(data), [data]);
  const signalMap = useMemo(() => deriveSignalMap(data), [data]);
  const fontVars = `${fredoka.variable} ${hanken.variable} ${spaceMono.variable}`;
  return (
    <div className={`${styles.root} ${fontVars}`}>
      <Sidebar data={data} state={s} set={set} />
      <main className={styles.main}>
        <Topbar data={data} state={s} set={set} />
        <div className={styles.content}>
          {s.view === 'overview' && <OverviewView data={data} set={set} />}
          {s.view === 'messaging' && <MessagingStudio data={data} state={s} set={set} matrix={matrix} signalMap={signalMap} />}
          {s.view === 'evidence' && <EvidenceView data={data} state={s} set={set} />}
          {s.view === 'creative' && <CreativeView data={data} />}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Repoint `/peton`**

```tsx
// app/peton/page.tsx
import type { Metadata } from 'next';
import Workspace from '../../components/audience-intelligence/Workspace';
import data from '@/launch-intelligence/vitality-chew.json';
import type { LaunchIntelligence } from '@/lib/launch-intelligence/schema';
export const metadata: Metadata = {
  title: 'Audience Intelligence — The Dogist',
  description: 'Launch intelligence workspace for the Vitality Chew, grounded in the @thedogist comment corpus.',
  robots: { index: false, follow: false },
};
export default function PetonPage() { return <Workspace data={data as unknown as LaunchIntelligence} />; }
```

> Create minimal stub components for `Sidebar`, `Topbar`, and the four views (each `export default function X() { return null; }`) so this task builds; they are implemented in Tasks 7-11.

- [ ] **Step 4: Build** — Run: `npm run build` Expected: PASS. Both `/peton` and `/peton-legacy` compile.

- [ ] **Step 5: Commit**

```bash
git add app/peton/page.tsx app/peton-legacy/page.tsx components/audience-intelligence/
git commit -m "feat(peton): workspace shell, state, route repoint + legacy park"
```

---

## Task 7: Sidebar + Topbar

**Files:** Create `components/audience-intelligence/Sidebar.tsx`, `Topbar.tsx`. Port the mockup's `<aside>` and `<header>` markup to JSX using `styles.*` classes.

- [ ] **Step 1: Sidebar** — brand block (logo "D" + "The Dogist" / "AUDIENCE INTELLIGENCE"); product switcher reading `data.brief.sku` + ingredient roles (e.g. "ANTIOXIDANT · SALMON" from `data.brief.ingredients`); nav list (Overview / Messaging Studio / Evidence / Creative) with counts (`data.audience_modes.length` modes, `9` angles, `data.evidence_index.audience_comments.length`); active item from `state.view`, onClick `set({view})`; footer "Corpus synced · {comments_analyzed} comments · @{creator_handle}" + brand line. Use `data.corpus_summary` for numbers.
- [ ] **Step 2: Topbar** — crumb `WORKSPACE / {sku}`, `viewTitle` map ({overview:'Overview', messaging:'Messaging Studio', evidence:'Evidence Review', creative:'Creative Library'}), pipeline pills from `data.message_architecture.interpretation_stages` (+ a "LIVE" pulse dot), and — when `state.view==='messaging'` — the 5 mode chips (`data.audience_modes`) using `modeColor`, active from `state.seg`, onClick toggles `set({seg})`, plus a "Clear ✕" when any filter set.
- [ ] **Step 3: Build** — `npm run build` → PASS.
- [ ] **Step 4: Commit** — `git commit -am "feat(peton): sidebar + topbar"`

---

## Task 8: Overview view

**Files:** Create `components/audience-intelligence/views/OverviewView.tsx`. Port the mockup's OVERVIEW `<sc-if>` block.

- [ ] **Step 1: Implement** — KPI grid (4 cards): `corpus_summary.comments_analyzed` "comments analyzed", `audience_modes.length` "audience modes found", `9` "message angles mapped", `corpus_summary.total_comment_likes` "comment likes weighted" (format with `toLocaleString()`). "How the pipeline works" card = 4 steps (Collect / Cluster / Read signal / Translate) with the `interpretation_stages` descriptions woven in. "Who's in the audience" card = demographics from `data.brief.deck_context.audience_context` (female_share, age_25_34_share, social_reach) labeled "The Dogist deck", followed by an **audience-mode breakdown** (each `audience_modes[].label` + a bar scaled by `evidence_breadth.high_signal_comments`, colored via `modeColor`). CTA card = `data.brief.active_question` → `set({view:'messaging'})`.
- [ ] **Step 2: Build** — `npm run build` → PASS.
- [ ] **Step 3: Commit** — `git commit -am "feat(peton): overview view"`

---

## Task 9: Messaging Studio (board + signal map + evidence rail)

**Files:** Create `components/audience-intelligence/views/MessagingStudio.tsx`. Props: `{ data, state, set, matrix, signalMap }`. Port the MESSAGING `<sc-if>` block, adapted to the 3×3 mode-tagged design.

- [ ] **Step 1: Board** — for each `matrix` row: a left VP card (`row.valueProp` + `row.essence`); then `row.cells` rendered as 3 cards. Each cell shows: a **mode badge** (`cell.modeLabel` + dot in `cell.color`), `cell.line`, a bar (`width: cell.barW`, bg `cell.color`), `cell.tag` (STRONG filled / TEST muted) + `cell.confidence`. Selected when `state.cell === cell.key`; onClick `set({cell: selected ? null : cell.key, copied:false})`. Dim cells when `state.seg && state.seg !== cell.modeId` (opacity .4). Dim whole row when a `state.quad` filter excludes it (map quadrant→modeId set; see Step 2).
- [ ] **Step 2: Signal Map (right rail, 2×2)** — render `signalMap.quadrants` positioned TL/TR/BL/BR with `count` + `label` + `sub`; axis labels from `signalMap.x_axis`/`y_axis`. onClick a quadrant: `set({quad: active?null:q.id, cell:null})`. Map quadrant id→modeId for board dimming: `{thrive:'wellness_routine_builders', pride:'senior_care_caregivers', scrutiny:'ingredient_scrutinists', pickiness:'picky_dog_pragmatists'}`. Keep the `// DERIVED PLACEHOLDER` comment.
- [ ] **Step 3: Evidence rail** — if `state.cell` set: resolve `[vi,ai]=state.cell.split('_')`, `angle = data.message_architecture.value_props[vi].angles[ai]`; show mode header (color from `modeColor(angle.audience_mode)`), `angle.dogist_style_angle`, "{N} comments support this angle" (N = mode `high_signal_comments`), `angle.evidence_quotes` cards (text + `@handle` derived from post + `♥ likes`), and a "Copy this angle" button (`navigator.clipboard.writeText(angle.dogist_style_angle)` → `set({copied:true})`, label flips to "✓ Copied"). Else (empty): "Top voices" = `topVoices(data,3)` cards.
- [ ] **Step 4: Build + sanity** — `npm run build` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(peton): messaging studio — board, signal map, evidence rail"`

---

## Task 10: Evidence view

**Files:** Create `components/audience-intelligence/views/EvidenceView.tsx`. Port the EVIDENCE block.

- [ ] **Step 1: Implement** — search input bound to `state.q` (`set({q})`); 5 mode chips (reuse Topbar chip styling) bound to `state.seg`. Table over `filterEvidence(data, {seg:state.seg, q:state.q})` with columns Comment (`text` + `post_title` secondary) · Mode (`audience_mode_label` + color dot) · Signal (`signal_score`) · Likes (`likes.toLocaleString()`); each row links via `post_url` (`target="_blank" rel="noopener"`). Footer: "Showing {rows.length} of {corpus_summary.comments_analyzed.toLocaleString()} — representative high-signal sample."
- [ ] **Step 2: Build** — `npm run build` → PASS.
- [ ] **Step 3: Commit** — `git commit -am "feat(peton): evidence view"`

---

## Task 11: ImageSlot + Creative view (with Dogist voice)

**Files:** Create `components/audience-intelligence/ImageSlot.tsx`, `views/CreativeView.tsx`.

- [ ] **Step 1: ImageSlot** — `'use client'`. Props `{ id, label, ratio }`. State `src` initialized from `localStorage.getItem('ai-slot-'+id)` in a `useEffect` (guard `typeof window`). `onDrop`/`onDragOver` handlers: read the dropped image file via `FileReader.readAsDataURL`, set state, persist to localStorage. Render the image if set, else a dashed placeholder with `label`. A small "✕" clears it (removes from localStorage).
- [ ] **Step 2: Creative view** — hero `ImageSlot` (16:9) + a 3-col grid of 9 `ImageSlot`s, one per matrix cell (iterate `buildMessageMatrix(data)` cells; label `"{modeLabel} · {valueProp}"`, top-border in `cell.color`). Below: a "Dogist voice" panel rendering `data.voice_profile.do_rules` (✓) and `avoid_rules` (✕), plus 3-4 `data.evidence_index.dogist_voice_examples` (caption `text` + `voice_pattern_label`).
- [ ] **Step 3: Build** — `npm run build` → PASS.
- [ ] **Step 4: Commit** — `git commit -am "feat(peton): creative view + image slots + dogist voice"`

---

## Task 12: Full test run + visual verification

**Files:** none (verification).

- [ ] **Step 1: Unit tests** — Run: `node --test lib/launch-intelligence/transforms.test.mjs` Expected: PASS (7 tests).
- [ ] **Step 2: Lint + build** — Run: `npm run lint && npm run build` Expected: PASS.
- [ ] **Step 3: Dev server** — Per user rules: free port 3000 (`lsof -ti:3000 | xargs kill -9` if needed), then `npm run dev`. Confirm server is up before testing.
- [ ] **Step 4: Screenshot each view** — Visit `/peton`, exercise: switch all 4 views; select a message cell (evidence rail populates); toggle a mode chip (cells dim/highlight); click a signal quadrant; search in Evidence; drop an image in Creative (reload → persists). Compare against the mockup and `/peton-legacy`. Capture screenshots.
- [ ] **Step 5: Commit any fixes** — `git commit -am "fix(peton): visual verification adjustments"` (if needed).

---

## Self-Review (completed during planning)

- **Spec coverage:** placement/park (Task 6) · 4 views (Tasks 8-11) · scoped styling+fonts (Task 5) · 3×3 mode-tagged board (Task 9) · derived confidence (Task 3) · derived Signal Map (Task 4/9) · demographics from deck_context + mode breakdown (Task 8) · Dogist voice in Creative (Task 11) · contract types + transforms (Tasks 1-4) · tests + visual verify (Task 12). All spec sections map to a task.
- **Placeholder scan:** Foundation tasks (1-4) contain complete code + tests. View tasks (7-11) reference the mockup as the visual source of truth with exact field mappings (not vague "build the UI") — acceptable because the mockup markup already exists and is in scope as a reference.
- **Type consistency:** `MatrixCell`/`MatrixRow`, `deriveConfidence`/`deriveConfidence2`/`cellScore`, `deriveSignalMap`, `filterEvidence`, `topVoices` names are consistent across tasks and match `schema.ts`. Cell key format `"<vp>_<angle>"` is consistent between Task 2 (build), Task 9 (select), and Task 11 (creative labels).

## Risks / coordination
- **node --test + `.ts` imports:** Step in Task 2 verifies the runner strips types; fallback to `.mjs` + JSDoc if not (existing tests are `.mjs`).
- **Schema drift with Codex:** only `schema.ts`/`transforms.ts` change if fields are renamed; components consume view models.
- **Signal Map:** swap `deriveSignalMap` for `data.signal_map` when Codex adds it (already gated).
- **Contract file must be committed eventually** for deploy (Codex owns `launch-intelligence/vitality-chew.json`); local dev works now since it exists in the tree.
