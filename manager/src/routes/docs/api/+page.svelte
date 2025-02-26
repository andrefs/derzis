<script lang="ts">
	import { onMount } from 'svelte';
	import * as openApiJson from './openapi.json';
	import SwaggerUI from 'swagger-ui';
	import 'swagger-ui/dist/swagger-ui.css';

	onMount(async () => {
		SwaggerUI({
			spec: openApiJson,
			dom_id: '#swagger-ui-container'
		});
	});
</script>

<svelte:head>
	<title>Derzis API documentation</title>
</svelte:head>

<div id="swagger-ui-container" />
