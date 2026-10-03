// Derive API URLs from the app mount point, including any Open OnDemand prefix.

function appDirFromPageUrl(pageUrl: string | URL): URL {
  const url = new URL(pageUrl.toString());
  // Job deep links are relative to the mount point.
  const deepLink = url.pathname.match(/^(.*)\/jobs\/[^/]+\/?$/);
  if (deepLink) {
    url.pathname = `${deepLink[1]}/`;
    url.search = '';
    url.hash = '';
  }
  return new URL('.', url);
}

export function appBaseFromPageUrl(pageUrl: string | URL): URL {
  return appDirFromPageUrl(pageUrl);
}

export function apiUrl(path: string): string {
  return new URL(`api/v1/${path}`, appBaseFromPageUrl(document.baseURI)).toString();
}

// Keep router and API mount points aligned. Internal routes omit the
// deployment prefix, which is supplied through basepath.
export function routerBasepathFromPageUrl(pageUrl: string | URL): string {
  const mountPath = appDirFromPageUrl(pageUrl).pathname;
  if (mountPath === '/') {
    return '/';
  }
  return mountPath.replace(/\/$/, '');
}
