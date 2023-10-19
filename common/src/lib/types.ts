export interface OngoingJobs {
  domainCrawl: {
    [domain: string]: boolean;
  };
  robotsCheck: {
    [domain: string]: boolean;
  };
}
