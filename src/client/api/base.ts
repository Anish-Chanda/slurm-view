// Single place where the client derives API URLs. The page is mounted at
// the application root, with or without an Open OnDemand base path in front.

function appDirFromPageUrl(pageUrl: string | URL): URL {
  const url = new URL(pageUrl.toString());
  // Job deep links (e.g. /jobs/123) live below the mount point.
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

// Router basepath sharing the API layer's mount understanding. Internal
// routes stay "/" and "/jobs/$jobId"; the basepath carries the deployment
// prefix (e.g. "/pun/sys/slurm-view" under Open OnDemand).
export function routerBasepathFromPageUrl(pageUrl: string | URL): string {
  const mountPath = appDirFromPageUrl(pageUrl).pathname;
  if (mountPath === '/') {
    return '/';
  }
  return mountPath.replace(/\/$/, '');
}
