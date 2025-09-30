<script lang="ts">
	export let data;
	import { Col, Row, Table, Badge } from '@sveltestrap/sveltestrap';
	import { Icon } from 'svelte-icons-pack';
	import { BsPencilSquare } from 'svelte-icons-pack/bs';
	import { BiDownload, BiNetworkChart } from 'svelte-icons-pack/bi';
	import { HiSolidMagnifyingGlass } from 'svelte-icons-pack/hi';
</script>

<header style="padding-bottom: 1rem">
	<h2>
		Process <span style="font-style: italic;">{data.proc.pid}</span>
		<a href="/processes/{data.proc.pid}/edit"><Icon src={BsPencilSquare} /></a>
	</h2>
</header>

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
								<a href="/processes/{data.proc.pid}/draw"> Draw <Icon src={BiNetworkChart} /></a>
							</p>
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
			<h4>Current step</h4>
			<Table>
				<tbody>
					<tr><th scope="row">Max path length</th><td>{data.proc.currentStep.maxPathLength}</td></tr
					>
					<tr><th scope="row">Max path props</th><td>{data.proc.currentStep.maxPathProps}</td></tr>
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
				</tbody>
			</Table>

			<h4>Previous steps</h4>
			<Table>
				<tbody>
					{#each data.proc.steps as step, i}
						{#if i !== data.proc.steps.length - 1}
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
						{/if}
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
