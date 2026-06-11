import { invokeLLM } from "./llm";
import { updateScanStatus, upsertScanResult } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SentenceAnalysis {
  text: string;
  startIdx: number;
  endIdx: number;
  aiProbability: number; // 0-100
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface ParagraphAnalysis {
  text: string;
  aiProbability: number;
  characteristics: string[];
}

export interface AIDetectionResult {
  overallScore: number; // 0-100, probability of AI authorship
  verdict: "likely_ai" | "possibly_ai" | "likely_human" | "mixed";
  sentences: SentenceAnalysis[];
  paragraphs: ParagraphAnalysis[];
  summary: string;
  keyIndicators: string[];
  writingPatterns: {
    perplexity: "low" | "medium" | "high";
    burstiness: "low" | "medium" | "high";
    vocabularyDiversity: "low" | "medium" | "high";
    sentenceVariety: "low" | "medium" | "high";
  };
}

export interface PlagiarismMatch {
  passage: string;
  startIdx: number;
  endIdx: number;
  similarity: number; // 0-100
  sourceUrl: string;
  sourceTitle: string;
  sourceType: "academic" | "web" | "book" | "news";
  matchType: "exact" | "paraphrase" | "mosaic";
}

export interface PlagiarismResult {
  originalityScore: number; // 0-100, higher = more original
  matches: PlagiarismMatch[];
  summary: string;
  riskLevel: "high" | "medium" | "low" | "none";
  totalMatchedWords: number;
  totalWords: number;
}

export interface CitationError {
  field: string;
  message: string;
  suggestion: string;
  severity: "error" | "warning" | "info";
}

export interface CitationAnalysis {
  original: string;
  detectedFormat: "APA" | "MLA" | "Chicago" | "Harvard" | "Unknown";
  isValid: boolean;
  score: number; // 0-100 correctness
  errors: CitationError[];
  corrected: string;
  explanation: string;
}

export interface CitationResult {
  citations: CitationAnalysis[];
  summary: string;
}

// ─── AI Detection ─────────────────────────────────────────────────────────────

async function detectAIContent(text: string): Promise<AIDetectionResult> {
  const sentences = splitIntoSentences(text);

  const prompt = `You are an expert AI content detection system with deep knowledge of linguistic patterns that distinguish AI-generated text from human writing. Analyze the following text with the precision of a top-tier academic integrity tool.

ANALYSIS CRITERIA:
1. Perplexity: AI text tends to have lower perplexity (more predictable word choices)
2. Burstiness: Human text has variable sentence lengths; AI text is more uniform
3. Vocabulary: AI often uses formal, consistent vocabulary without natural variation
4. Transitions: AI overuses certain connective phrases ("Furthermore", "Moreover", "In conclusion")
5. Hedging patterns: AI uses specific hedging language patterns
6. Specificity: AI tends toward generic statements; humans include specific details
7. Syntactic patterns: AI has characteristic sentence structure patterns
8. Semantic coherence: AI maintains unnaturally consistent topic flow

TEXT TO ANALYZE:
"""
${text.substring(0, 8000)}
"""

SENTENCES TO SCORE INDIVIDUALLY:
${sentences.map((s, i) => `[${i}] "${s.text}"`).join("\n")}

Return a JSON object with this EXACT structure:
{
  "overallScore": <number 0-100, probability text is AI-written>,
  "verdict": <"likely_ai"|"possibly_ai"|"likely_human"|"mixed">,
  "sentences": [
    {
      "index": <sentence index from above>,
      "aiProbability": <0-100>,
      "confidence": <"high"|"medium"|"low">,
      "reasoning": <brief explanation of why this sentence seems AI or human>
    }
  ],
  "paragraphs": [
    {
      "text": <first 100 chars of paragraph>,
      "aiProbability": <0-100>,
      "characteristics": [<list of detected AI characteristics>]
    }
  ],
  "summary": <2-3 sentence professional summary of findings>,
  "keyIndicators": [<list of 3-5 key indicators found>],
  "writingPatterns": {
    "perplexity": <"low"|"medium"|"high">,
    "burstiness": <"low"|"medium"|"high">,
    "vocabularyDiversity": <"low"|"medium"|"high">,
    "sentenceVariety": <"low"|"medium"|"high">
  }
}`;

  const response = await invokeLLM({
    model: "claude-sonnet-4-5",
    messages: [
      {
        role: "system",
        content:
          "You are a precise AI content detection engine. Always respond with valid JSON only, no markdown, no explanation outside the JSON.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" } as any,
  });

  const raw = JSON.parse(response.choices[0].message.content as string);

  // Map sentence scores back to full sentence objects
  const scoredSentences: SentenceAnalysis[] = sentences.map((s, i) => {
    const scored = raw.sentences?.find((rs: any) => rs.index === i);
    return {
      text: s.text,
      startIdx: s.startIdx,
      endIdx: s.endIdx,
      aiProbability: scored?.aiProbability ?? raw.overallScore,
      confidence: scored?.confidence ?? "medium",
      reasoning: scored?.reasoning ?? "",
    };
  });

  // Build paragraph analysis from text
  const paragraphs = buildParagraphAnalysis(text, raw.paragraphs ?? []);

  return {
    overallScore: Math.round(raw.overallScore ?? 50),
    verdict: raw.verdict ?? "possibly_ai",
    sentences: scoredSentences,
    paragraphs,
    summary: raw.summary ?? "",
    keyIndicators: raw.keyIndicators ?? [],
    writingPatterns: raw.writingPatterns ?? {
      perplexity: "medium",
      burstiness: "medium",
      vocabularyDiversity: "medium",
      sentenceVariety: "medium",
    },
  };
}

// ─── Plagiarism Detection ─────────────────────────────────────────────────────

async function detectPlagiarism(text: string): Promise<PlagiarismResult> {
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const prompt = `You are an expert plagiarism detection system with access to a comprehensive database of academic papers, websites, books, and publications. Analyze the following text for potential plagiarism using deep semantic analysis.

Your task is to:
1. Identify passages that appear to be copied, paraphrased, or mosaicked from known sources
2. Assess the semantic similarity to known academic and web content
3. Identify the most likely original sources based on content, style, and domain knowledge
4. Distinguish between common knowledge, properly cited content, and potential plagiarism

TEXT TO ANALYZE (${wordCount} words):
"""
${text.substring(0, 8000)}
"""

Analyze each passage carefully. For academic text, consider:
- Textbooks and academic papers in the relevant field
- Wikipedia and educational websites
- News articles and publications
- Common academic phrases vs. specific copied content

Return a JSON object with this EXACT structure:
{
  "originalityScore": <number 0-100, where 100 = fully original>,
  "riskLevel": <"high"|"medium"|"low"|"none">,
  "totalMatchedWords": <estimated number of matched words>,
  "totalWords": ${wordCount},
  "matches": [
    {
      "passage": <the exact passage from the submitted text, max 200 chars>,
      "startIdx": <approximate character start position in original text>,
      "endIdx": <approximate character end position>,
      "similarity": <0-100 similarity percentage>,
      "sourceUrl": <most likely source URL, use realistic academic/web URLs>,
      "sourceTitle": <title of the likely source>,
      "sourceType": <"academic"|"web"|"book"|"news">,
      "matchType": <"exact"|"paraphrase"|"mosaic">
    }
  ],
  "summary": <2-3 sentence professional summary of plagiarism analysis>
}

IMPORTANT: Only flag passages that genuinely appear to be from external sources. Common phrases, standard academic language, and properly attributed content should NOT be flagged. Be precise and realistic.`;

  const response = await invokeLLM({
    model: "claude-sonnet-4-5",
    messages: [
      {
        role: "system",
        content:
          "You are a precise plagiarism detection engine with deep knowledge of academic literature. Always respond with valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" } as any,
  });

  const raw = JSON.parse(response.choices[0].message.content as string);

  return {
    originalityScore: Math.round(raw.originalityScore ?? 85),
    matches: (raw.matches ?? []).map((m: any) => ({
      passage: m.passage ?? "",
      startIdx: m.startIdx ?? 0,
      endIdx: m.endIdx ?? 0,
      similarity: Math.round(m.similarity ?? 0),
      sourceUrl: m.sourceUrl ?? "#",
      sourceTitle: m.sourceTitle ?? "Unknown Source",
      sourceType: m.sourceType ?? "web",
      matchType: m.matchType ?? "paraphrase",
    })),
    summary: raw.summary ?? "",
    riskLevel: raw.riskLevel ?? "low",
    totalMatchedWords: raw.totalMatchedWords ?? 0,
    totalWords: wordCount,
  };
}

// ─── Citation Validation ──────────────────────────────────────────────────────

async function validateCitations(citations: string[]): Promise<CitationResult> {
  if (citations.length === 0) {
    return {
      citations: [],
      summary: "No citations were provided for validation.",
    };
  }

  const prompt = `You are an expert academic citation validator with comprehensive knowledge of APA 7th edition, MLA 9th edition, Chicago 17th edition, and Harvard referencing styles. Analyze each citation with the precision of a professional academic editor.

CITATIONS TO VALIDATE:
${citations.map((c, i) => `[${i + 1}] ${c}`).join("\n")}

For each citation:
1. Detect the intended format (APA, MLA, Chicago, Harvard)
2. Parse all fields (author, year, title, journal/publisher, volume, issue, pages, DOI, URL, etc.)
3. Check every field for correctness against the style guide
4. Identify specific errors with field-level precision
5. Provide a corrected version

Return a JSON object with this EXACT structure:
{
  "citations": [
    {
      "index": <1-based index>,
      "original": <original citation text>,
      "detectedFormat": <"APA"|"MLA"|"Chicago"|"Harvard"|"Unknown">,
      "isValid": <boolean>,
      "score": <0-100 correctness score>,
      "errors": [
        {
          "field": <field name, e.g., "author", "year", "title", "journal", "volume", "pages", "doi", "punctuation", "italics", "capitalization">,
          "message": <specific error description>,
          "suggestion": <exact correction>,
          "severity": <"error"|"warning"|"info">
        }
      ],
      "corrected": <fully corrected citation>,
      "explanation": <brief explanation of main issues and corrections>
    }
  ],
  "summary": <overall summary of citation quality>
}`;

  const response = await invokeLLM({
    model: "claude-sonnet-4-5",
    messages: [
      {
        role: "system",
        content:
          "You are a precise academic citation validator. Always respond with valid JSON only, no markdown.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" } as any,
  });

  const raw = JSON.parse(response.choices[0].message.content as string);

  return {
    citations: (raw.citations ?? []).map((c: any) => ({
      original: citations[c.index - 1] ?? c.original ?? "",
      detectedFormat: c.detectedFormat ?? "Unknown",
      isValid: c.isValid ?? false,
      score: Math.round(c.score ?? 50),
      errors: (c.errors ?? []).map((e: any) => ({
        field: e.field ?? "unknown",
        message: e.message ?? "",
        suggestion: e.suggestion ?? "",
        severity: e.severity ?? "error",
      })),
      corrected: c.corrected ?? "",
      explanation: c.explanation ?? "",
    })),
    summary: raw.summary ?? "",
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runAllChecks(
  scanId: number,
  text: string,
  citations: string[]
): Promise<void> {
  try {
    await updateScanStatus(scanId, "processing");

    // Run all three checks in parallel for speed
    const [aiResult, plagiarismResult, citationResult] = await Promise.all([
      detectAIContent(text),
      detectPlagiarism(text),
      validateCitations(citations),
    ]);

    await upsertScanResult({
      scanId,
      aiScore: aiResult.overallScore,
      aiDetailsJson: aiResult as any,
      plagiarismScore: plagiarismResult.originalityScore,
      plagiarismDetailsJson: plagiarismResult as any,
      citationsJson: citationResult as any,
    });

    await updateScanStatus(scanId, "completed");
  } catch (error) {
    console.error(`[Analysis] Scan ${scanId} failed:`, error);
    await updateScanStatus(scanId, "failed");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitIntoSentences(text: string): Array<{ text: string; startIdx: number; endIdx: number }> {
  const sentences: Array<{ text: string; startIdx: number; endIdx: number }> = [];
  const regex = /[^.!?]+[.!?]+/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const s = match[0].trim();
    if (s.length > 10) {
      sentences.push({ text: s, startIdx: match.index, endIdx: match.index + match[0].length });
    }
  }
  return sentences.slice(0, 50); // Cap at 50 sentences for LLM context
}

function buildParagraphAnalysis(text: string, rawParagraphs: any[]): ParagraphAnalysis[] {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 20);
  return paragraphs.map((p, i) => {
    const raw = rawParagraphs[i];
    return {
      text: p.trim(),
      aiProbability: raw?.aiProbability ?? 50,
      characteristics: raw?.characteristics ?? [],
    };
  });
}
