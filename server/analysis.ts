import { invokeLLM } from "./_core/llm";
import { updateScanStatus, upsertScanResult } from "./db";

export interface SentenceAnalysis {
  text: string;
  startIdx: number;
  endIdx: number;
  aiProbability: number;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface ParagraphAnalysis {
  text: string;
  aiProbability: number;
  characteristics: string[];
}

export interface AIDetectionResult {
  overallScore: number;
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
  similarity: number;
  sourceUrl: string;
  sourceTitle: string;
  sourceType: "academic" | "web" | "book" | "news";
  matchType: "exact" | "paraphrase" | "mosaic";
}

export interface PlagiarismResult {
  originalityScore: number;
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
  score: number;
  errors: CitationError[];
  corrected: string;
  explanation: string;
}

export interface CitationResult {
  citations: CitationAnalysis[];
  summary: string;
}

async function detectAIContent(text: string): Promise<AIDetectionResult> {
  const sentences = splitIntoSentences(text);
  const prompt = `Analyze this text for AI-generated content patterns. Return JSON with overallScore (0-100), verdict, per-sentence analysis, and writing patterns.`;

  const response = await invokeLLM({
    model: "claude-sonnet-4-5",
    messages: [
      {
        role: "system",
        content: "You are a precise AI content detection engine. Always respond with valid JSON only.",
      },
      { role: "user", content: prompt + "\n\nText: " + text.substring(0, 8000) },
    ],
    response_format: { type: "json_object" } as any,
  });

  const raw = JSON.parse(response.choices[0].message.content as string);
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

async function detectPlagiarism(text: string): Promise<PlagiarismResult> {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const prompt = `Analyze this text for plagiarism. Return JSON with originalityScore, matches with sources, and risk level.`;

  const response = await invokeLLM({
    model: "claude-sonnet-4-5",
    messages: [
      {
        role: "system",
        content: "You are a precise plagiarism detection engine. Always respond with valid JSON only.",
      },
      { role: "user", content: prompt + "\n\nText (" + wordCount + " words): " + text.substring(0, 8000) },
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

async function validateCitations(citations: string[]): Promise<CitationResult> {
  if (citations.length === 0) {
    return {
      citations: [],
      summary: "No citations were provided for validation.",
    };
  }

  const prompt = `Validate these citations for APA, MLA, Chicago, and Harvard formats. Return JSON with per-citation analysis, errors, and corrections.`;

  const response = await invokeLLM({
    model: "claude-sonnet-4-5",
    messages: [
      {
        role: "system",
        content: "You are a precise academic citation validator. Always respond with valid JSON only.",
      },
      { role: "user", content: prompt + "\n\nCitations:\n" + citations.map((c, i) => `[${i + 1}] ${c}`).join("\n") },
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

export async function runAllChecks(
  scanId: number,
  text: string,
  citations: string[]
): Promise<void> {
  try {
    await updateScanStatus(scanId, "processing");

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
  return sentences.slice(0, 50);
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
