type FilterableScope = {
  id: string;
  description: string;
};

export function filterScopes<T extends FilterableScope>(
  scopes: T[],
  query: string
): T[] {
  return scopes
    .filter((scope) => fuzzyMatchesScope(scope, query))
    .slice()
    .sort((left, right) =>
      left.id === right.id ? 0 : left.id < right.id ? -1 : 1
    );
}

export function fuzzyMatchesScope(
  scope: FilterableScope,
  query: string
): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const candidates = [scope.id, scope.description].map((value) =>
    value.toLowerCase()
  );
  return terms.every((term) =>
    candidates.some((candidate) => isSubsequence(term, candidate))
  );
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}
