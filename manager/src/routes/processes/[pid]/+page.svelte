<script lang="ts">
  export let data;
  import { Col, Row, Table, Badge, Alert } from '@sveltestrap/sveltestrap';
  import { Icon } from 'svelte-icons-pack';
  import { BsPencilSquare } from 'svelte-icons-pack/bs';
  import { BiDownload, BiNetworkChart } from 'svelte-icons-pack/bi';
  import { HiSolidMagnifyingGlass } from 'svelte-icons-pack/hi';
  import { onMount, onDestroy } from 'svelte';

  let progress: { step: number; paths: { done: number; remaining: number }; rate: number } | null = null;
  let error: string | null = null;
  let eventSource: EventSource | null = null;

  $: isRunning = data.proc.status === 'running' || data.proc.status === 'extending';

  onMount(() => {
    if (!isRunning) return;

    const ssePath = `/api/processes/${data.proc.pid}/events`;
    eventSource = new EventSource(ssePath);

    eventSource.onmessage = (event) => {
      try {
        progress = JSON.parse(event.data);
      } catch (e) {
        console.error('Failed to parse SSE event:', e);
      }
    };

    eventSource.onerror = (e) => {
      error = 'Lost connection to progress updates';
      console.error('SSE error:', e);
    };
  });

  onDestroy(() => {
    if (eventSource) {
      eventSource.close();
    }
  });
</script>

<header style="padding-bottom: 1rem">
  <h2>
    Process <span style="font-style: italic;">{data.proc.pid}</span>
    <a href="/processes/{data.proc.pid}/edit"><Icon src={BsPencilSquare} /></a>
  </h2>
</header>

{#if isRunning && progress}
  <Alert color="info" class="mb-4">
    <strong>Step {progress.step}:</strong>
    {progress.paths.done} paths done | {progress.paths.remaining} remaining |
    {progress.rate.toFixed(1)} resources/min
  </Alert>
{:else if isRunning && error}
  <Alert color="warning" class="mb-4">{error}</Alert>
{/if}

<main>
  <Row>
    <Col>
      <h3>Details</h3>
      <Table>
        <tbody>
          <tr
            ><th scope="row">Status</th><td><Badge color="primary">{data.proc.status}</Badge></td
            ></tr
          >
          <tr><th scope="row">Submitted</th><td>{data.proc.createdAt}</td></tr>
          <tr><th scope="row">Last updated</th><td>{data.proc.updatedAt}</td></tr>
          <tr><th scope="row">Time to last resource</th><td>{data.proc.timeToLastResource}</td></tr>
          <tr><th scope="row">Time running</th><td>{data.proc.timeRunning}</td></tr>
          <tr>
            <th scope="row">Triples</th><td>
              <Row>
                <Col md="6">
                  <p>
                    <a href="/api/processes/{data.proc.pid}/triples.json.gz"
                      >JSON <Icon src={BiDownload} /></a
                    >
                  </p>
                  <p>
                    <a href="/api/processes/{data.proc.pid}/triples.nt.gz"
                      >N-Triples <Icon src={BiDownload} /></a
                    >
                  </p>
                  <p>
                    <a href="/processes/{data.proc.pid}/draw">
                      Draw <Icon src={BiNetworkChart} /></a
                    >
                  </p>
                  <p>
                    <a href="/processes/{data.proc.pid}/draw-seeds">
                      Draw seeds<Icon src={BiNetworkChart} /></a
                    >
                  </p>
                </Col>
                <Col md="6">
                  <p>
                    <a href="/processes/{data.proc.pid}/latest-triples?count=100"
                      >Latest triples <Icon src={HiSolidMagnifyingGlass} /></a
                    >
                  </p>
                  <p>
                    <a href="/processes/{data.proc.pid}/resource"
                      >Triples by resource <Icon src={HiSolidMagnifyingGlass} /></a
                    >
                  </p>
                  <p>
                    <a href="/processes/{data.proc.pid}/seed-head"
                      >Longest path by seed/head <Icon src={HiSolidMagnifyingGlass} /></a
                    >
                  </p>
                </Col>
              </Row>
            </td>
          </tr>
          <tr>
            <th scope="row">Info</th>
            <td>
              <p>
                <a href="/api/processes/{data.proc.pid}/stats"
                  >View <Icon src={HiSolidMagnifyingGlass} /></a
                >
              </p>
              <p>
                <a href="/api/processes/{data.proc.pid}-full.zip"
                  >Full download <Icon src={BiDownload} /></a
                >
              </p>
            </td>
          </tr>
        </tbody>
      </Table>

      <h3>Steps</h3>
      {#if data.proc.currentStep}
        <h4>Current step (#{data.proc.steps.length})</h4>
        <Table>
          <tbody>
            <tr
              ><th scope="row">Max path length</th><td>{data.proc.currentStep.maxPathLength}</td
              ></tr
            >
            <tr><th scope="row">Max path props</th><td>{data.proc.currentStep.maxPathProps}</td></tr
            >
            <tr>
              <th scope="row">Seeds</th>
              <td
                >{#each data.proc.currentStep.seeds as r}
                  <p style="margin-bottom: 0">
                    <a href={r}>{r}</a>
                  </p>
                {/each}</td
              >
            </tr>
            <tr>
              <th scope="row">Predicate limitation</th>
              <td>{data.proc.currentStep.predLimit?.limType}</td>
            </tr>
            <tr>
              <th scope="row">Predicate list</th>
              <td>
                {#each data.proc.currentStep.predLimit?.limPredicates || [] as p}
                  <p style="margin-bottom: 0">
                    <a href={p}>{p}</a>
                  </p>
                {/each}
                N/A
              </td>
            </tr>
          </tbody>
        </Table>
      {/if}

      <h4>Previous steps</h4>
      <Table>
        <tbody>
          {#each data.proc.steps.slice(0, -1) as step, i}
            <tr><th scope="row">Max path length</th><td>{step.maxPathLength}</td></tr>
            <tr><th scope="row">Max path props</th><td>{step.maxPathProps}</td></tr>
            <tr>
              <th scope="row">Seeds</th>
              <td
                >{#each step.seeds as r}
                  <p style="margin-bottom: 0">
                    <a href={r}>{r}</a>
                  </p>
                {/each}</td
              >
            </tr>

            <tr>
              <th scope="row">Predicate limitation</th>
              <td>{step.predLimit.limType}</td>
            </tr>
            <tr>
              <th scope="row">Predicate list</th>
              <td>
                {#each step.predLimit.limPredicates as p}
                  <p style="margin-bottom: 0">
                    <a href={p}>{p}</a>
                  </p>
                {/each}
                N/A
              </td>
            </tr>
          {/each}
        </tbody>
      </Table>

      <h3>Notifications</h3>
      <Table>
        <tbody>
          <tr><th scope="row">Email</th><td>{data.proc.notification.email || ''}</td></tr>
          <tr><th scope="row">Webhook</th><td>{data.proc.notification.webhook || ''}</td></tr>
          <tr
            ><th scope="row">Server-sent events URL</th><td
              ><a href={data.proc.notification.ssePath}>{data.proc.notification.ssePath}</a></td
            ></tr
          >
        </tbody>
      </Table>
    </Col>
  </Row>
</main>
