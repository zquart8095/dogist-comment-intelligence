import type { Metadata } from 'next';
import AudienceIntelligenceReport from '@/components/AudienceIntelligenceReport';
import { fontVars } from '@/components/fonts';
import type { PainPointAnglesFile, AngleMessagesFile } from '@/components/types';
import painPointAngles from '@/data/opportunity-analysis/pain-point-angles.json';
import angleMessages from '@/data/opportunity-analysis/angle-messages.json';
import vitalityChew from '@/product/launch-intelligence.json';

export const metadata: Metadata = {
  title: 'Audience Intelligence Report — The Dogist',
  description: 'Scrollytelling audience-research report for the Vitality Chew launch, grounded in the @thedogist comment corpus.',
  robots: { index: false, follow: false },
};

const painPoints = painPointAngles as unknown as PainPointAnglesFile;
const angleData = angleMessages as unknown as AngleMessagesFile;

export default function HomePage() {
  return (
    <div className={fontVars}>
      <AudienceIntelligenceReport
        themes={painPoints.themes}
        angleThemes={angleData.themes}
        angleTypes={angleData.angle_types}
        totalComments={vitalityChew.corpus_summary.comments_analyzed}
        totalPosts={vitalityChew.corpus_summary.posts_analyzed}
        dietCommentsTotal={painPoints.diet_comments_total}
        signalsExtracted={painPoints.signals_extracted}
      />
    </div>
  );
}
