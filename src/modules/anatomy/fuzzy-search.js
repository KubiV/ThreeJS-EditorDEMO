/**
 * Normalizes text for typo-tolerant and diacritics-insensitive searching.
 */
export function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Calculates Levenshtein distance between two short strings.
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = [];
  for (let i = 0; i <= b.length; i++) row[i] = i;

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      let val;
      if (a.charAt(i - 1) === b.charAt(j - 1)) {
        val = row[j - 1];
      } else {
        val = Math.min(row[j - 1] + 1, prev + 1, row[j] + 1);
      }
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

/**
 * Checks if token approximately matches target word (with typo tolerance).
 */
function tokenMatchesWord(token, word) {
  if (word.startsWith(token)) return { matches: true, score: 1.0, exact: true };
  if (word.includes(token)) return { matches: true, score: 0.85, exact: false };

  // For typo tolerance, token must be at least 3 characters
  if (token.length >= 3) {
    const maxDistance = token.length > 5 ? 2 : 1;
    // Compare prefix of word with same length as token
    const wordPrefix = word.slice(0, token.length + 1);
    const dist = levenshtein(token, wordPrefix);
    if (dist <= maxDistance) {
      return { matches: true, score: 0.65 - (dist * 0.15), exact: false };
    }
  }
  return { matches: false, score: 0, exact: false };
}

/**
 * Prepares searchable index for term items.
 */
export function createSearchIndex(terms = []) {
  const indexed = terms.map((term) => {
    const normId = normalizeSearchText(term.taCode || term.id);
    const normLatin = normalizeSearchText(term.latin);
    const normEnglish = normalizeSearchText(term.english);
    const normParent = normalizeSearchText(term.parent);
    const normParentEnglish = normalizeSearchText(term.parentEnglish);
    const normPath = normalizeSearchText(term.path);
    const latinWords = normLatin.split(' ').filter(Boolean);
    const englishWords = normEnglish.split(' ').filter(Boolean);
    const contextWords = [...new Set([...normParent.split(' '), ...normParentEnglish.split(' '), ...normPath.split(' ')])].filter(Boolean);

    return {
      term,
      normId,
      normLatin,
      normEnglish,
      normParent,
      latinWords,
      englishWords,
      contextWords
    };
  });

  return {
    search(query, { systemId, limit = 25 } = {}) {
      const cleanQuery = normalizeSearchText(query);
      if (!cleanQuery) {
        // Return first N terms in system or in general
        const filtered = systemId
          ? indexed.filter((item) => item.term.systemId === systemId)
          : indexed;
        return filtered.slice(0, limit).map((item) => ({ ...item.term, score: 1 }));
      }

      const queryTokens = cleanQuery.split(' ').filter(Boolean);
      const candidates = [];

      for (let i = 0; i < indexed.length; i++) {
        const item = indexed[i];
        if (systemId && item.term.systemId !== systemId) continue;

        let score = 0;

        // 1. Exact matches
        if (item.normId === cleanQuery || item.normLatin === cleanQuery) {
          score = 1000;
        } else if (item.normEnglish === cleanQuery) {
          score = 900;
        } else if (item.normId.startsWith(cleanQuery)) {
          score = 850;
        } else if (item.normLatin.startsWith(cleanQuery)) {
          score = 800;
        } else if (item.normEnglish.startsWith(cleanQuery)) {
          score = 750;
        } else {
          // 2. Token based matching
          let totalTokenScore = 0;
          let matchedTokens = 0;

          for (const token of queryTokens) {
            let bestTokenScore = 0;

            // Check TA code / ID
            if (item.normId.includes(token)) {
              bestTokenScore = Math.max(bestTokenScore, 0.9);
            }

            // Check Latin words
            for (const word of item.latinWords) {
              const match = tokenMatchesWord(token, word);
              if (match.matches) {
                bestTokenScore = Math.max(bestTokenScore, match.score * 1.15);
              }
            }

            // Check English words
            for (const word of item.englishWords) {
              const match = tokenMatchesWord(token, word);
              if (match.matches) {
                bestTokenScore = Math.max(bestTokenScore, match.score * 0.95);
              }
            }

            // Check Parent / Context words (e.g. "ulna", "mandibula", "scapula")
            for (const word of item.contextWords) {
              const match = tokenMatchesWord(token, word);
              if (match.matches) {
                bestTokenScore = Math.max(bestTokenScore, match.score * 1.05);
              }
            }

            if (bestTokenScore > 0) {
              matchedTokens++;
              totalTokenScore += bestTokenScore;
            }
          }

          // All query tokens must match something in the term
          if (matchedTokens === queryTokens.length) {
            score = (totalTokenScore / queryTokens.length) * 500;
            // Boost shorter names when matching
            const lengthPenalty = Math.min(item.normLatin.length, 50) * 0.5;
            score -= lengthPenalty;
          }
        }

        if (score > 0) {
          candidates.push({ ...item.term, score });
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      return candidates.slice(0, limit);
    }
  };
}
