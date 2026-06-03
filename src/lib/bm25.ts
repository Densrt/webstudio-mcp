// BM25 ranking helper for meta.get_more_tools (chantier #3 v1.1).
//
// Replaces the naive keyword-overlap counter with the canonical Okapi BM25 formula:
//
//   score(D, Q) = sum_{t in Q} IDF(t) * TF(t,D)*(k1+1) / (TF(t,D) + k1*(1 - b + b*|D|/avgDl))
//
// Constants: k1=1.5 (term saturation), b=0.75 (length normalization). These are the
// values empirically best on TREC and used by Elasticsearch's default scorer.

const K1 = 1.5;
const B = 0.75;

const STOPWORDS = new Set([
  // English
  "the", "and", "for", "with", "this", "that", "from", "have", "has", "had",
  "is", "are", "was", "were", "be", "been", "being", "of", "in", "on", "at",
  "to", "a", "an", "by", "as", "or", "but", "if", "then", "else", "when",
  "while", "i", "we", "you", "they", "it", "he", "she", "my", "our", "your",
  "their", "his", "her", "its", "want", "need", "use", "used", "uses", "do",
  // French
  "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "à", "au",
  "aux", "ce", "ces", "cet", "cette", "qui", "que", "quoi", "dont", "où",
  "je", "tu", "il", "elle", "nous", "vous", "ils", "elles", "mon", "ma",
  "mes", "ton", "ta", "tes", "son", "sa", "ses", "leur", "leurs", "pour",
  "par", "sur", "avec", "sans", "dans", "en", "est", "sont",
]);

/**
 * Tokenize text: lowercase, split on non-word chars, drop stopwords + tokens < 3 chars.
 */
export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase();
  const tokens = lowered.split(/[^a-z0-9]+/i).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return tokens;
}

export type IndexedDoc<T> = {
  /** Original opaque payload (e.g. {tool, action, description}) returned with the score. */
  payload: T;
  /** Pre-tokenized terms for this doc. */
  terms: string[];
};

export type BM25Index<T> = {
  docs: IndexedDoc<T>[];
  avgDocLen: number;
  /** doc-frequency per term (count of docs containing the term). */
  df: Map<string, number>;
  totalDocs: number;
};

/**
 * Build a reusable BM25 index over N documents. Each doc carries an arbitrary payload
 * and a pre-tokenized terms array. Use `tokenize()` to produce the terms.
 */
export function buildIndex<T>(docs: Array<{ payload: T; text: string }>): BM25Index<T> {
  const indexed: IndexedDoc<T>[] = docs.map((d) => ({ payload: d.payload, terms: tokenize(d.text) }));
  const df = new Map<string, number>();
  for (const doc of indexed) {
    const uniqueTerms = new Set(doc.terms);
    for (const t of uniqueTerms) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const totalDocs = indexed.length;
  const avgDocLen = totalDocs === 0 ? 0 : indexed.reduce((acc, d) => acc + d.terms.length, 0) / totalDocs;
  return { docs: indexed, avgDocLen, df, totalDocs };
}

function idf(df: number, totalDocs: number): number {
  // Lucene-style smoothed IDF: log(1 + (N - df + 0.5) / (df + 0.5))
  return Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
}

function tfFor(term: string, doc: IndexedDoc<unknown>): number {
  let count = 0;
  for (const t of doc.terms) if (t === term) count += 1;
  return count;
}

/**
 * Score a single doc against the query terms (already tokenized).
 */
export function scoreDoc<T>(index: BM25Index<T>, doc: IndexedDoc<T>, queryTerms: string[]): number {
  if (queryTerms.length === 0 || doc.terms.length === 0) return 0;
  let score = 0;
  for (const qTerm of queryTerms) {
    const df = index.df.get(qTerm) ?? 0;
    if (df === 0) continue;
    const tf = tfFor(qTerm, doc);
    if (tf === 0) continue;
    const termIdf = idf(df, index.totalDocs);
    const numerator = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * doc.terms.length / (index.avgDocLen || 1));
    score += termIdf * (numerator / denominator);
  }
  return score;
}

/**
 * Search the index against a free-text query. Returns top-N docs by BM25 score (descending).
 */
export function search<T>(index: BM25Index<T>, query: string, topN = 5): Array<{ payload: T; score: number }> {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];
  const scored = index.docs
    .map((doc) => ({ payload: doc.payload, score: scoreDoc(index, doc, queryTerms) }))
    .filter((r) => r.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
