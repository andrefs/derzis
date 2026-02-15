<script lang="ts">
  export let data;
  import {
    Row,
    Col,
    Card,
    CardBody,
    CardText,
    Badge,
    Alert,
    FormGroup,
    Label,
    Input,
    Button,
    ButtonGroup
  } from '@sveltestrap/sveltestrap';

  type SortField =
    | 'origin'
    | 'status'
    | 'lastAccessed'
    | 'nextAllowed'
    | 'totalWarnings'
    | 'crawlDelay';
  type SortDirection = 'asc' | 'desc';

  let sortField: SortField = 'origin';
  let sortDirection: SortDirection = 'asc';
  let searchTerm: string = '';

  $: filteredDomains = (data.domains || []).filter((domain) =>
    domain.origin.toLowerCase().includes(searchTerm.toLowerCase())
  );

  $: sortedDomains = [...filteredDomains].sort((a, b) => {
    let aVal: any, bVal: any;

    switch (sortField) {
      case 'origin':
        aVal = a.origin.toLowerCase();
        bVal = b.origin.toLowerCase();
        break;
      case 'status':
        aVal = a.status;
        bVal = b.status;
        break;
      case 'lastAccessed':
        aVal = a.lastAccessed ? new Date(a.lastAccessed).getTime() : 0;
        bVal = b.lastAccessed ? new Date(b.lastAccessed).getTime() : 0;
        break;
      case 'nextAllowed':
        aVal = new Date(a.crawl.nextAllowed).getTime();
        bVal = new Date(b.crawl.nextAllowed).getTime();
        break;
      case 'totalWarnings':
        aVal = Object.values(a.warnings).reduce((sum, count) => sum + count, 0);
        bVal = Object.values(b.warnings).reduce((sum, count) => sum + count, 0);
        break;
      case 'crawlDelay':
        aVal = a.crawl.delay;
        bVal = b.crawl.delay;
        break;
      default:
        return 0;
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  function toggleSortDirection() {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  }
</script>

<header style="padding-bottom: 1rem">
  <div class="d-flex justify-content-between align-items-center">
    <h2>Domains</h2>
    <div class="d-flex gap-3 align-items-center">
      <FormGroup class="mb-0">
        <Label for="searchInput" class="form-label mb-0 me-2">Search:</Label>
        <Input
          type="text"
          id="searchInput"
          placeholder="Filter domains..."
          bind:value={searchTerm}
          style="width: 200px;"
        />
        {#if searchTerm}
          <small class="text-muted ms-2">
            {filteredDomains.length} of {(data.domains || []).length} domains
          </small>
        {/if}
      </FormGroup>
      <FormGroup class="mb-0">
        <Label for="sortField" class="form-label mb-0 me-2">Sort by:</Label>
        <Input type="select" id="sortField" bind:value={sortField} style="width: auto;">
          <option value="origin">Domain Name</option>
          <option value="status">Status</option>
          <option value="lastAccessed">Last Accessed</option>
          <option value="nextAllowed">Next Allowed</option>
          <option value="totalWarnings">Total Warnings</option>
          <option value="crawlDelay">Crawl Delay</option>
        </Input>
      </FormGroup>
      <ButtonGroup>
        <Button
          color={sortDirection === 'asc' ? 'secondary' : 'outline-secondary'}
          size="sm"
          on:click={() => (sortDirection = 'asc')}
        >
          ↑ Asc
        </Button>
        <Button
          color={sortDirection === 'desc' ? 'secondary' : 'outline-secondary'}
          size="sm"
          on:click={() => (sortDirection = 'desc')}
        >
          ↓ Desc
        </Button>
      </ButtonGroup>
    </div>
  </div>
</header>

<main>
  <Row>
    {#if !data || !data.domains || data.domains.length === 0}
      <Col>
        <Alert color="info" class="text-center">
          No domains found. Domains will appear here once crawling processes have been started.
        </Alert>
      </Col>
    {:else}
      {#each sortedDomains as domain}
        <Col xs={12} md={6} lg={4} class="mb-4">
          <Card>
            <CardBody>
              <h5 class="card-title">{domain.origin}</h5>

              <div class="mb-3">
                <strong>Status:</strong>
                <Badge
                  color={domain.status === 'ready'
                    ? 'success'
                    : domain.status === 'crawling'
                      ? 'warning'
                      : domain.status === 'error'
                        ? 'danger'
                        : 'secondary'}
                  class="ms-2"
                >
                  {domain.status}
                </Badge>
              </div>

              {#if domain.robots}
                <div class="mb-3">
                  <strong>Robots:</strong>
                  <Badge
                    color={domain.robots.status === 'done'
                      ? 'success'
                      : domain.robots.status === 'error'
                        ? 'danger'
                        : 'secondary'}
                    class="ms-2"
                  >
                    {domain.robots.status}
                  </Badge>
                  {#if domain.robots.checked}
                    <small class="text-muted ms-2"
                      >({new Date(domain.robots.checked).toLocaleDateString()})</small
                    >
                  {/if}
                </div>
              {/if}

              <div class="mb-3">
                <strong>Warnings:</strong>
                <div class="d-flex flex-wrap gap-1 mt-1">
                  {#if domain.warnings.E_ROBOTS_TIMEOUT > 0}
                    <Badge color="warning">Robots Timeout: {domain.warnings.E_ROBOTS_TIMEOUT}</Badge
                    >
                  {/if}
                  {#if domain.warnings.E_RESOURCE_TIMEOUT > 0}
                    <Badge color="danger"
                      >Resource Timeout: {domain.warnings.E_RESOURCE_TIMEOUT}</Badge
                    >
                  {/if}
                  {#if domain.warnings.E_DOMAIN_NOT_FOUND > 0}
                    <Badge color="dark"
                      >Domain Not Found: {domain.warnings.E_DOMAIN_NOT_FOUND}</Badge
                    >
                  {/if}
                  {#if domain.warnings.E_UNKNOWN > 0}
                    <Badge color="info">Unknown: {domain.warnings.E_UNKNOWN}</Badge>
                  {/if}
                  {#if domain.warnings.E_ROBOTS_TIMEOUT === 0 && domain.warnings.E_RESOURCE_TIMEOUT === 0 && domain.warnings.E_DOMAIN_NOT_FOUND === 0 && domain.warnings.E_UNKNOWN === 0}
                    <small class="text-muted">No warnings</small>
                  {/if}
                </div>
              </div>

              <div class="mb-3">
                <strong>Crawl Stats:</strong>
                <div class="row g-2 mt-1">
                  <div class="col-6">
                    <small class="text-muted">Queued: {domain.crawl.queued}</small>
                  </div>
                  <div class="col-6">
                    <small class="text-muted">Success: {domain.crawl.success}</small>
                  </div>
                  <div class="col-6">
                    <small class="text-muted">Ongoing: {domain.crawl.ongoing}</small>
                  </div>
                  <div class="col-6">
                    <small class="text-muted">Failed: {domain.crawl.failed}</small>
                  </div>
                  <div class="col-6">
                    <small class="text-muted">Path Heads: {domain.crawl.pathHeads}</small>
                  </div>
                  <div class="col-6">
                    <small class="text-muted">Delay: {domain.crawl.delay}s</small>
                  </div>
                </div>
              </div>

              <div class="mb-2">
                <strong>Last Accessed:</strong>
                <CardText>
                  {domain.lastAccessed ? new Date(domain.lastAccessed).toLocaleString() : 'Never'}
                </CardText>
              </div>

              <div class="mb-2">
                <strong>Next Allowed:</strong>
                <CardText>
                  {new Date(domain.crawl.nextAllowed).toLocaleString()}
                </CardText>
              </div>

              {#if domain.lastWarnings && domain.lastWarnings.length > 0}
                <div>
                  <strong>Recent Warnings:</strong>
                  <div class="d-flex flex-wrap gap-1 mt-1">
                    {#each domain.lastWarnings.slice(-3) as warning}
                      <Badge color="danger" class="small">{warning.errType}</Badge>
                    {/each}
                  </div>
                </div>
              {/if}
            </CardBody>
          </Card>
        </Col>
      {/each}
    {/if}
  </Row>
</main>
