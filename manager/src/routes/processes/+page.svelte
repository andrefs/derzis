<script lang="ts">
	export let data;
	import { Row, Col, Table, Badge } from '@sveltestrap/sveltestrap';
</script>

<header style="padding-bottom: 1rem">
	<h2>Processes</h2>
</header>

<main>
	<Row>
		<Col>
			<Table striped hover>
				<thead>
					<tr>
						<th scope="col">PID</th>
						<th scope="col">Max path length</th>
						<th scope="col">Max path props</th>
						<th scope="col">Status</th>
						<th scope="col">Submitted</th>
					</tr>
				</thead>
				<tbody>
					{#if !data || !data.processes || data.processes.length === 0}
						<tr>
							<td class="text-center" colSpan={5}
								>Oops, there are no processes yet! <a href="/processes/new">Add a new one</a></td
							>
						</tr>
					{/if}
					{#each data.processes as proc}
						<tr>
							<th><a href="/processes/{proc.pid}">{proc.pid}</a></th>
							<td class="text-center">{proc.currentStep.maxPathLength}</td>
							<td class="text-center">{proc.currentStep.maxPathProps}</td>
							<td><Badge color="primary">{proc.status}</Badge></td>
							<td>{proc.createdAt}</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		</Col>
	</Row>
</main>
