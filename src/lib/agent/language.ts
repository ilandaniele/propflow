/**
 * Pure stopword-scoring language detector for es/en/pt. No dependencies —
 * safe to call on every inbound message without touching the DB.
 *
 * Returns null when the signal is too weak to trust: fewer than 2 tokens, or
 * the leading language's score isn't at least 2 and clearly ahead of the
 * runner-up.
 */

import type { AgentLanguage } from './types';

const STOPWORDS: Record<AgentLanguage, Set<string>> = {
  es: new Set([
    'que', 'de', 'la', 'el', 'en', 'y', 'a', 'los', 'se', 'del', 'las', 'un', 'por', 'con', 'no',
    'una', 'su', 'para', 'es', 'al', 'lo', 'como', 'más', 'pero', 'sus', 'le', 'ya', 'o', 'este',
    'sí', 'porque', 'esta', 'entre', 'cuando', 'muy', 'sin', 'sobre', 'también', 'me', 'hasta',
    'hay', 'donde', 'quien', 'desde', 'todo', 'nos', 'yo', 'tú', 'usted', 'ustedes', 'mí', 'tu',
    'tus', 'mi', 'mis', 'está', 'estás', 'estoy', 'están', 'quiero', 'busco', 'necesito', 'gracias',
    'hola', 'cuánto', 'dónde', 'cómo', 'qué', 'cuál', 'buenas', 'buenos', 'días', 'tardes', 'noches',
    'casa', 'departamento', 'alquiler', 'alquilar', 'comprar', 'gustaría',
  ]),
  en: new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with',
    'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
    'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up',
    'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time',
    'just', 'him', 'know', 'take', 'into', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
    'than', 'then', 'now', 'want', 'need', 'looking', 'price', 'where', 'hello', 'thanks', 'thank',
    'much', 'house', 'apartment', 'rent', 'buy', 'please',
  ]),
  pt: new Set([
    'que', 'de', 'não', 'o', 'a', 'e', 'é', 'do', 'da', 'em', 'um', 'para', 'com', 'uma', 'os', 'no',
    'se', 'na', 'por', 'mais', 'as', 'dos', 'como', 'mas', 'ao', 'ele', 'das', 'seu', 'sua', 'ou',
    'quando', 'muito', 'nos', 'já', 'eu', 'também', 'só', 'pelo', 'pela', 'até', 'isso', 'ela',
    'entre', 'depois', 'sem', 'mesmo', 'você', 'vocês', 'obrigado', 'obrigada', 'olá', 'quero',
    'procuro', 'preciso', 'quanto', 'onde', 'está', 'estou', 'estão', 'casa', 'apartamento',
    'aluguel', 'alugar', 'comprar', 'bom', 'boa', 'dia', 'tarde', 'noite',
  ]),
};

const LANGUAGES: AgentLanguage[] = ['es', 'en', 'pt'];

/** Pure. Returns null when the signal is too weak to trust. */
export function detectLanguage(text: string): AgentLanguage | null {
  const tokens = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  if (tokens.length < 2) return null;

  const scores: Record<AgentLanguage, number> = { es: 0, en: 0, pt: 0 };
  for (const token of tokens) {
    for (const lang of LANGUAGES) {
      if (STOPWORDS[lang].has(token)) scores[lang]++;
    }
  }

  const ranked = [...LANGUAGES].sort((a, b) => scores[b] - scores[a]);
  const [top, runnerUp] = ranked;
  const topScore = scores[top];
  const runnerUpScore = scores[runnerUp];

  if (topScore < 2 || topScore <= runnerUpScore) return null;
  return top;
}
