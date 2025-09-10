<script>
	import { version } from '$app/environment';
	import NavigationBar from '$lib/navbar.svelte';
	import { Container, Styles } from '@sveltestrap/sveltestrap';
</script>

<Styles />

<div style="--navbar-height: 56px; --container-padding: 3rem;">
	<NavigationBar {version} />

	<Container style="max-width: 800px; padding-top: 1.5rem; padding-bottom: 1.5rem">
		<slot />
	</Container>
</div>
