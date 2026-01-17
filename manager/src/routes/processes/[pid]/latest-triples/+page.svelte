<script lang="ts">
	export let data;
	import { Col, Row, Table } from '@sveltestrap/sveltestrap';
</script>

<header style="padding-bottom: 1rem">
	<h2>
		Latest triples for process <span style="font-style: italic;">{data.proc.pid}</span>
	</h2>
	<p>Showing last {data.triples.length} triples</p>
</header>

<main>
	<Row>
		<Col>
			{#if data.triples.length === 0}
				<p>No triples found.</p>
			{:else}
				<Table striped hover>
					<thead>
						<tr>
							<th scope="col">Subject</th>
							<th scope="col">Predicate</th>
							<th scope="col">Object</th>
						</tr>
					</thead>
					<tbody>
						{#each data.triples as triple}
							<tr>
								<td><a href={triple.subject} target="_blank">{triple.subject}</a></td>
								<td><a href={triple.predicate} target="_blank">{triple.predicate}</a></td>
								<td>
									{#if triple.object.startsWith('http://') || triple.object.startsWith('https://')}
										<a href={triple.object} target="_blank">{triple.object}</a>
									{:else}
										{triple.object}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</Col>
	</Row>
</main>
