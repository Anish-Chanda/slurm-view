// Single place where the client derives API URLs. The page may be mounted
// at the app root (dev, future cutover) or under the temporary /react/
// staging route, with or without an Open OnDemand base path in front.

function appDirFromPageUrl(pageUrl: string | URL): URL {
  const url = new URL(pageUrl.toString());
  // Job deep links (e.g. /react/jobs/123) live below the mount point.
  const deepLink = url.pathname.match(/^(.*)\/jobs\/[^/]+\/?$/);
  if (deepLink) {
    url.pathname = `${deepLink[1]}/`;
    url.search = '';
    url.hash = '';
  }
  return new URL('.', url);
}

export function appBaseFromPageUrl(pageUrl: string | URL): URL {
  const pageBase = appDirFromPageUrl(pageUrl);
  if (pageBase.pathname.endsWith('/react/')) {
    return new URL('../', pageBase);
  }
  return pageBase;
}

export function apiUrl(path: string): string {
  return new URL(`api/v1/${path}`, appBaseFromPageUrl(document.baseURI)).toString();
}

// Router basepath sharing the API layer's mount understanding. Internal
// routes stay "/" and "/jobs/$jobId"; the basepath carries the deployment
// prefix ("/react" while staged, plain base after cutover).
export function routerBasepathFromPageUrl(pageUrl: string | URL): string {
  const mountPath = appDirFromPageUrl(pageUrl).pathname;
  if (mountPath === '/') {
    return '/';
  }
  return mountPath.replace(/\/$/, '');
}
