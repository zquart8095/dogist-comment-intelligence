export interface Quote {
  text: string;
  likes: number;
  post_url: string;
  post_title: string;
  comment_id?: string;
  post_id?: string;
}

export interface Theme {
  id: string;
  label: string;
  problem_statement: string;
  want_statement: string;
  emotional_triggers: string[];
  count_estimate: number;
  signal_strength: 'high' | 'medium' | 'low';
  representative_quotes: Quote[];
}

export interface LanguageItem {
  text: string;
  why: string;
  source_post_url: string | null;
  source_likes: number | null;
}

export interface Angle {
  angle_type: string; // e.g. "pain_based" — look up the pretty label via AngleType
  hook_formula_used: string;
  hook: string;
  explanation: string;
  solution: string;
  social_proof_usp: string;
  cta: string;
  language_to_borrow: LanguageItem[];
  claims_to_avoid: string[];
  validation_prompt: string;
}

export interface AngleTheme extends Theme {
  angles: Angle[];
}

export interface AngleType {
  id: string;
  label: string;
  description: string;
  hook_formula: string;
  hook_pattern: string;
  hook_worked_example: string;
  hook_why_it_works: string;
}

export interface PainPointAnglesFile {
  diet_comments_total: number;
  signals_extracted: number;
  themes: Theme[];
}

export interface AngleMessagesFile {
  angle_types: AngleType[];
  top_n: number;
  themes: AngleTheme[];
}
