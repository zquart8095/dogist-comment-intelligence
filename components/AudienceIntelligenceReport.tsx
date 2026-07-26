'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './report.module.css';
import type { Theme, AngleTheme, AngleType } from './types';

export interface ReportProps {
  themes: Theme[];
  angleThemes: AngleTheme[];
  angleTypes: AngleType[];
  totalComments: number;
  dietCommentsTotal: number;
  signalsExtracted: number;
  totalPosts: number;
}

const SECTION_ORDER = ['landing', 'methodology', 'angledef', 'results', 'adangles'] as const;
type SectionId = (typeof SECTION_ORDER)[number];
const SECTION_LABELS: Record<SectionId, string> = {
  landing: 'Landing',
  methodology: 'Methodology',
  angledef: 'Ad Angles',
  results: 'Themes',
  adangles: 'Messaging',
};

const SIGNAL_COLORS: Record<string, string> = { high: '#B23A48', medium: '#C98A3E', low: '#8B8776' };

const ANATOMY_STEPS = ['Hook', 'Explanation', 'Solution', 'Social Proof / USP', 'CTA'];

const fmt = (n: number) => n.toLocaleString('en-US');

/** Strip the " — Psychology label" suffix some hook_formula strings carry, and unquote. */
function cleanFormula(formula: string): string {
  const withoutSuffix = formula.split(' — ')[0];
  return withoutSuffix.replace(/^"|"$/g, '');
}

export default function AudienceIntelligenceReport({
  themes,
  angleThemes,
  angleTypes,
  totalComments,
  dietCommentsTotal,
  signalsExtracted,
  totalPosts,
}: ReportProps) {
  const [visible, setVisible] = useState<Record<SectionId, boolean>>({
    landing: true,
    methodology: false,
    angledef: false,
    results: false,
    adangles: false,
  });
  const [chartSlide, setChartSlide] = useState<0 | 1>(0);
  const [hoveredThemeId, setHoveredThemeId] = useState<string | null>(null);
  const [themeIndex, setThemeIndex] = useState(0);
  const [angleIndex, setAngleIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const observedIds = useRef<Partial<Record<SectionId, boolean>>>({});

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observers: IntersectionObserver[] = [];
    for (const id of SECTION_ORDER) {
      const el = sectionRefs.current[id];
      if (!el || observedIds.current[id]) continue;
      observedIds.current[id] = true;
      const obs = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              setVisible((v) => ({ ...v, [id]: true }));
              obs.disconnect();
            }
          }
        },
        { root: container, threshold: 0.22 }
      );
      obs.observe(el);
      observers.push(obs);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  function reveal(id: SectionId, extraDelayMs = 0): CSSProperties {
    const v = visible[id];
    return {
      opacity: v ? 1 : 0,
      transform: v ? 'translateY(0px)' : 'translateY(26px)',
      transition: `opacity 0.7s ease ${extraDelayMs}ms, transform 0.7s ease ${extraDelayMs}ms`,
    };
  }

  function goToSection(id: SectionId) {
    const el = sectionRefs.current[id];
    const container = containerRef.current;
    if (el && container) container.scrollTo({ top: el.offsetTop, behavior: 'smooth' });
  }

  // ---- Section 2: methodology funnel ----
  const funnelData = [
    { n: totalComments, label: `Instagram comments collected from @thedogist across ${totalPosts} posts`, width: 100 },
    { n: dietCommentsTotal, label: 'Filtered to comments topically relevant to diet, food & feeding', width: 76 },
    { n: signalsExtracted, label: 'Contained a clearly stated problem or want about diet', width: 50 },
    { n: themes.length, label: 'Distinct pain-point & need themes, clustered from those signals', width: 26 },
    { n: angleThemes.length, label: `Top themes by volume, expanded into ${angleThemes.length * 6} ad angles ready to test`, width: 14 },
  ];

  // ---- Section 4: theme results ----
  const sortedThemes = [...themes].sort((a, b) => b.count_estimate - a.count_estimate);
  const top10 = sortedThemes.slice(0, 10);
  const bottom10 = sortedThemes.slice(-10).reverse();
  const activeSet = chartSlide === 0 ? top10 : bottom10;
  const maxCount = activeSet.length ? activeSet[0].count_estimate : 1;
  const selectedId = hoveredThemeId ?? activeSet[0]?.id;
  const selectedTheme = activeSet.find((t) => t.id === selectedId) ?? activeSet[0];

  // ---- Section 5: ad angle results ----
  const currentTheme = angleThemes[themeIndex];
  const currentAngle = currentTheme?.angles[angleIndex];
  const angleTypeById = new Map(angleTypes.map((a) => [a.id, a]));

  function prevTheme() {
    setThemeIndex((i) => (i - 1 + angleThemes.length) % angleThemes.length);
    setAngleIndex(0);
  }
  function nextTheme() {
    setThemeIndex((i) => (i + 1) % angleThemes.length);
    setAngleIndex(0);
  }

  return (
    <div ref={containerRef} className={styles.root}>
      <div className={styles.navRail}>
        {SECTION_ORDER.map((id) => (
          <div key={id} className={styles.navItem} onClick={() => goToSection(id)}>
            <span className={styles.navLabel}>{SECTION_LABELS[id]}</span>
            <span
              className={styles.navDot}
              style={{
                width: visible[id] ? 9 : 7,
                height: visible[id] ? 9 : 7,
                background: visible[id] ? 'var(--air-accent)' : 'var(--air-rule)',
              }}
            />
          </div>
        ))}
      </div>

      {/* SECTION 1: LANDING */}
      <section
        ref={(el) => {
          sectionRefs.current.landing = el;
        }}
        className={`${styles.section} ${styles.landingSection}`}
      >
        <div style={reveal('landing')}>
          <div className={styles.landingEyebrow}>Audience Intelligence Report</div>
          <h1 className={`${styles.display} ${styles.h1}`}>
            The Dogist <span className={styles.accent}>Audience Intelligence</span> Analysis
          </h1>
          <p className={styles.landingSub}>
            We analyzed {fmt(totalComments)} real Instagram comments from The Dogist&apos;s audience to identify the
            top {angleThemes.length} pain points dog owners have about diet and nutrition — and turned them into{' '}
            {angleThemes.length * 6} ad angles ready to test for the Fall 2026 launch of{' '}
            <strong style={{ color: 'var(--air-ink)', fontWeight: 600 }}>Vitality Chew</strong>.
          </p>
          <div className={`${styles.mono} ${styles.statPill}`}>
            {fmt(totalComments)} comments analyzed &nbsp;·&nbsp; @thedogist &nbsp;·&nbsp; {totalPosts} posts
          </div>
        </div>
        <div className={styles.scrollCue}>
          <span>Scroll</span>
          <svg width="14" height="20" viewBox="0 0 14 20" fill="none">
            <path
              d="M1 6L7 12L13 6"
              stroke="#8B8776"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </section>

      {/* SECTION 2: METHODOLOGY */}
      <section
        ref={(el) => {
          sectionRefs.current.methodology = el;
        }}
        className={styles.section}
      >
        <div className={styles.funnelWrap}>
          <div style={reveal('methodology')}>
            <div className={styles.eyebrow}>Section 02 — Methodology</div>
            <h2 className={`${styles.display} ${styles.h2}`}>From {fmt(totalComments)} comments to {angleThemes.length} ad angles</h2>
            <p className={styles.funnelSub}>
              Every step narrows real audience language down to messaging worth testing — nothing here was
              invented, only filtered.
            </p>
          </div>
          <div>
            {funnelData.map((f, i) => (
              <div key={f.label} className={styles.funnelRow} style={reveal('methodology', 120 + i * 130)}>
                <div className={styles.funnelTop}>
                  <div className={`${styles.mono} ${styles.funnelNum}`}>{fmt(f.n)}</div>
                  <div className={styles.funnelLabel}>{f.label}</div>
                </div>
                <div className={styles.funnelTrack}>
                  <div
                    className={styles.funnelFill}
                    style={{ width: visible.methodology ? `${f.width}%` : '0%', transitionDelay: `${180 + i * 130}ms` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 3: WHAT IS AN AD ANGLE */}
      <section
        ref={(el) => {
          sectionRefs.current.angledef = el;
        }}
        className={styles.section}
      >
        <div className={styles.angledefWrap}>
          <div style={reveal('angledef')}>
            <div className={styles.eyebrow}>Section 03 — What Is An Ad Angle</div>
            <h2 className={`${styles.display} ${styles.h2}`}>Not what the product is — the lens it&apos;s viewed through.</h2>
            <p className={styles.angledefBody}>
              An ad angle is the specific psychological hook used to present the same core offer to one particular
              audience mindset — pain relief, an aspirational outcome, a blunt fix, social proof, an intriguing
              reveal, or a message to one very specific kind of owner. We used six angle types, each built on a
              proven direct-response hook formula.
            </p>
          </div>
          <div className={styles.cardsGrid} style={reveal('angledef', 120)}>
            {angleTypes.map((card) => (
              <div key={card.id} className={styles.angleCard}>
                <div className={`${styles.display} ${styles.angleCardName}`}>{card.label}</div>
                <div className={`${styles.mono} ${styles.angleCardFormula}`}>&quot;{cleanFormula(card.hook_formula)}&quot;</div>
                <div className={styles.angleCardDesc}>{card.description}</div>
              </div>
            ))}
          </div>
          <div style={reveal('angledef', 260)}>
            <div className={styles.anatomyLabel}>Anatomy of every angle</div>
            <div className={styles.anatomyRow}>
              {ANATOMY_STEPS.map((name, i) => (
                <div key={name} className={styles.anatomyStepWrap}>
                  <div className={styles.anatomyStep}>
                    <div className={styles.anatomyStepN}>0{i + 1}</div>
                    <div className={styles.anatomyStepName}>{name}</div>
                  </div>
                  {i < ANATOMY_STEPS.length - 1 && <div className={styles.anatomyArrow}>→</div>}
                </div>
              ))}
            </div>
            <p className={styles.groundedNote}>
              Grounded, not generative: no comment quote shown anywhere on this page was paraphrased by AI. Every
              quote is pulled by a stable reference back to the original comment — it links to a real Instagram
              comment with its real like count.
            </p>
          </div>
        </div>
      </section>

      {/* SECTION 4: THEME RESULTS */}
      <section
        ref={(el) => {
          sectionRefs.current.results = el;
        }}
        className={styles.section}
      >
        <div className={styles.resultsWrap}>
          <div className={styles.resultsHeader} style={reveal('results')}>
            <div>
              <div className={styles.eyebrow}>Section 04 — Theme Results</div>
              <h2 className={`${styles.display} ${styles.h2}`} style={{ marginBottom: 0 }}>
                {chartSlide === 0 ? 'Top 10 themes by volume' : 'Bottom 10 themes by volume'}
              </h2>
            </div>
            <div className={styles.resultsHeaderRight}>
              <div className={`${styles.mono} ${styles.slideLabel}`}>{chartSlide === 0 ? '1 / 2' : '2 / 2'}</div>
              <button
                type="button"
                className={styles.arrowBtn}
                onClick={() => {
                  setChartSlide((s) => (s === 0 ? 1 : 0));
                  setHoveredThemeId(null);
                }}
              >
                ←
              </button>
              <button
                type="button"
                className={styles.arrowBtn}
                onClick={() => {
                  setChartSlide((s) => (s === 0 ? 1 : 0));
                  setHoveredThemeId(null);
                }}
              >
                →
              </button>
            </div>
          </div>

          <div className={styles.chartGrid}>
            <div className={styles.chartCol} style={reveal('results', 140)}>
              {activeSet.map((t) => (
                <div
                  key={t.id}
                  className={styles.barRow}
                  onMouseEnter={() => setHoveredThemeId(t.id)}
                  onClick={() => setHoveredThemeId(t.id)}
                >
                  <div className={styles.barTop}>
                    <span className={styles.barLabel} style={{ color: t.id === selectedId ? 'var(--air-ink)' : 'var(--air-ink-soft)' }}>
                      {t.label}
                    </span>
                    <span className={`${styles.mono} ${styles.barCount}`}>{fmt(t.count_estimate)}</span>
                  </div>
                  <div className={styles.barTrack}>
                    <div
                      className={styles.barFill}
                      style={{
                        width: visible.results ? `${Math.max(6, (t.count_estimate / maxCount) * 100)}%` : '0%',
                        background: SIGNAL_COLORS[t.signal_strength] ?? '#8B8776',
                        opacity: t.id === selectedId ? 1 : 0.72,
                      }}
                    />
                  </div>
                </div>
              ))}
              <div className={styles.legendRow}>
                {(['high', 'medium', 'low'] as const).map((s) => (
                  <div key={s} className={styles.legendItem}>
                    <span className={styles.legendDot} style={{ background: SIGNAL_COLORS[s] }} />
                    {s[0].toUpperCase() + s.slice(1)} signal
                  </div>
                ))}
              </div>
            </div>

            {selectedTheme && (
              <div className={styles.detailPanel}>
                <div className={`${styles.mono} ${styles.detailEyebrow}`} style={{ color: SIGNAL_COLORS[selectedTheme.signal_strength] }}>
                  {selectedTheme.signal_strength.toUpperCase()} SIGNAL
                </div>
                <div className={`${styles.display} ${styles.detailLabel}`}>{selectedTheme.label}</div>
                <div className={styles.detailLine}>
                  <strong>Problem:</strong> {selectedTheme.problem_statement}
                </div>
                <div className={styles.detailLine}>
                  <strong>Want:</strong> {selectedTheme.want_statement}
                </div>
                <div className={styles.chipRow}>
                  {selectedTheme.emotional_triggers.map((t) => (
                    <span key={t} className={styles.chip}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* SECTION 5: AD ANGLE RESULTS */}
      <section
        ref={(el) => {
          sectionRefs.current.adangles = el;
        }}
        className={styles.section}
      >
        <div className={styles.adAnglesWrap} style={reveal('adangles')}>
          {currentTheme && currentAngle && (
            <>
              <div className={styles.adAnglesHeader}>
                <div>
                  <div className={styles.eyebrow}>
                    Section 05 — Ad Angle Results &nbsp;·&nbsp; Theme {themeIndex + 1} of {angleThemes.length}
                  </div>
                  <h2 className={`${styles.display} ${styles.h2}`} style={{ marginBottom: 8 }}>
                    {currentTheme.label}
                  </h2>
                  <div className={styles.themeLine}>
                    {currentTheme.problem_statement} &nbsp;→&nbsp; {currentTheme.want_statement}
                  </div>
                  <div className={styles.chipRow}>
                    {currentTheme.emotional_triggers.map((t) => (
                      <span key={t} className={styles.chip}>
                        {t}
                      </span>
                    ))}
                    <span className={`${styles.chip} ${styles.chipSignal}`} style={{ background: SIGNAL_COLORS[currentTheme.signal_strength] }}>
                      {currentTheme.signal_strength.toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className={styles.adAnglesHeaderRight}>
                  <button type="button" className={styles.arrowBtn} onClick={prevTheme}>
                    ←
                  </button>
                  <button type="button" className={styles.arrowBtn} onClick={nextTheme}>
                    →
                  </button>
                </div>
              </div>

              <div className={styles.tabRow}>
                {currentTheme.angles.map((a, i) => (
                  <div
                    key={a.angle_type}
                    className={`${styles.mono} ${styles.tab} ${i === angleIndex ? styles.tabActive : ''}`}
                    onClick={() => setAngleIndex(i)}
                  >
                    {angleTypeById.get(a.angle_type)?.label ?? a.angle_type}
                  </div>
                ))}
              </div>

              <div className={styles.angleGrid}>
                <div className={styles.angleMain}>
                  <div className={styles.angleMainEyebrow}>
                    {angleTypeById.get(currentAngle.angle_type)?.label ?? currentAngle.angle_type} &nbsp;·&nbsp; &quot;
                    {cleanFormula(currentAngle.hook_formula_used)}&quot;
                  </div>
                  <div className={`${styles.display} ${styles.hook}`}>{currentAngle.hook}</div>
                  <div className={styles.angleBody}>
                    <div>
                      <div className={styles.angleFieldLabel}>Explanation</div>
                      <div className={styles.angleFieldBody}>{currentAngle.explanation}</div>
                    </div>
                    <div>
                      <div className={styles.angleFieldLabel}>Solution</div>
                      <div className={styles.angleFieldBody}>{currentAngle.solution}</div>
                    </div>
                    <div>
                      <div className={styles.angleFieldLabel}>Social Proof / USP</div>
                      <div className={styles.angleFieldBody}>{currentAngle.social_proof_usp}</div>
                    </div>
                  </div>
                  <button type="button" className={styles.ctaBtn}>
                    {currentAngle.cta} →
                  </button>
                </div>

                <div className={styles.angleAside}>
                  <div className={`${styles.asideCard} ${styles.asideCardMuted}`}>
                    <div className={styles.asideLabel}>Language to borrow</div>
                    {currentAngle.language_to_borrow.map((lang, i) => (
                      <a
                        key={i}
                        href={lang.source_post_url ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.langItem}
                      >
                        &quot;{lang.text}&quot; <span>— ♥ {lang.source_likes ?? 0}</span>
                      </a>
                    ))}
                  </div>
                  <div className={`${styles.asideCard} ${styles.asideCardBordered}`}>
                    <div className={styles.asideLabel}>Claims to avoid</div>
                    {currentAngle.claims_to_avoid.map((claim, i) => (
                      <div key={i} className={styles.claimItem}>
                        — {claim}
                      </div>
                    ))}
                  </div>
                  <div className={`${styles.asideCard} ${styles.asideCardDashed}`} style={{ borderColor: 'var(--air-accent)' }}>
                    <div className={styles.asideLabel} style={{ color: 'var(--air-accent)' }}>
                      Validation test
                    </div>
                    <div className={styles.validationBody}>{currentAngle.validation_prompt}</div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
