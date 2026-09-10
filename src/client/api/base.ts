// Single place where the client derives API URLs. The page may be mounted
// at the app root (dev, future cutover) or under the temporary /react/
// staging route, with or without an Open OnDemand base path in front.

export function appBaseFromPageUrl(pageUrl: string | URL): URL {
  const pageBase = new URL('.', pageUrl);
  if (pageBase.pathname.endsWith('/react/')) {
    return new URL('../', pageBase);
  }
  return pageBase;
}

export function apiUrl(path: string): string {
  return new URL(`api/v1/${path}`, appBaseFromPageUrl(document.baseURI)).toString();
}
