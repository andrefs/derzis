<script>
	import { version } from '$app/environment';
	import NavigationBar from '$lib/navbar.svelte';
	import { Container, Styles } from '@sveltestrap/sveltestrap';
</script>

<Styles />

<NavigationBar {version} />

<Container style="max-width: 800px; padding-top: 1.5rem; padding-bottom: 1.5rem">
	<slot />
</Container>
