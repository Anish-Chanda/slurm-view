// Expands Slurm hostlist bracket expressions into concrete node names.
function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth = Math.max(0, depth - 1);
    } else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function expandRangeToken(token: string): string[] {
  const rangeMatch = token.match(/^(\d+)-(\d+)$/);
  if (!rangeMatch) {
    return [token];
  }
  const start = Number.parseInt(rangeMatch[1] ?? '', 10);
  const end = Number.parseInt(rangeMatch[2] ?? '', 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    return [token];
  }
  const width = Math.max((rangeMatch[1] ?? '').length, (rangeMatch[2] ?? '').length);
  const values: string[] = [];
  for (let current = start; current <= end; current += 1) {
    values.push(String(current).padStart(width, '0'));
  }
  return values;
}

function expandHostlistExpression(expression: string): string[] {
  const openIndex = expression.indexOf('[');
  if (openIndex === -1) {
    return [expression];
  }
  let depth = 0;
  let closeIndex = -1;
  for (let i = openIndex; i < expression.length; i += 1) {
    if (expression[i] === '[') {
      depth += 1;
    }
    if (expression[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        closeIndex = i;
        break;
      }
    }
  }
  if (closeIndex === -1) {
    return [expression];
  }
  const prefix = expression.slice(0, openIndex);
  const body = expression.slice(openIndex + 1, closeIndex);
  const suffix = expression.slice(closeIndex + 1);
  const expandedBody = splitTopLevelCommas(body).flatMap(expandRangeToken);
  const expandedSuffix = expandHostlistExpression(suffix);
  const results: string[] = [];
  for (const bodyPart of expandedBody) {
    for (const suffixPart of expandedSuffix) {
      results.push(`${prefix}${bodyPart}${suffixPart}`);
    }
  }
  return results;
}

function expandSlurmHostlist(hostlist: string | null | undefined): string[] {
  if (!hostlist || typeof hostlist !== 'string') {
    return [];
  }
  return splitTopLevelCommas(hostlist)
    .flatMap(expandHostlistExpression)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

export { expandSlurmHostlist };
