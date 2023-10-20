<script>
	export let data;
	import { Col, Row, Table } from 'sveltestrap';
	import Icon from 'svelte-icons-pack/Icon.svelte';
	import BsPencilSquare from 'svelte-icons-pack/bs/BsPencilSquare';
</script>

<header style="padding-bottom: 1rem">
	<h2>
		SM <span style="font-style: italic;">{data.proc.pid}</span>
		<a href="/processes/{data.proc.pid}/edit"><Icon src={BsPencilSquare} /></a>
	</h2>
</header>

<main>
	<Row>
		<Col>
			<h3>Details</h3>
			<Table>
				<tbody>
					<tr><th>Status</th><td /></tr>
					<tr><th>Submitted</th><td>{data.proc.createdAt}</td></tr>
					<tr><th>Last updated</th><td>{data.proc.updatedAt}</td></tr>
					<tr><th>Time running</th><td>{data.proc.timeRunning}</td></tr>
					<tr>
						<th>Resources</th>
						<td
							>{#each data.proc.seeds as r, index}
								{#if index === 0}<a href={r}>{r}</a>{:else}, <a href={r}>{r}</a>{/if}
							{/each}</td
						>
					</tr>
				</tbody>
			</Table>
		</Col>
	</Row>
</main>
