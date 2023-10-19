<script>
	import NavigationBar from '$lib/navbar.svelte';
	import { Container, Styles } from 'sveltestrap';

	let version = process.env.npm_package_version;
</script>

<Styles />

<NavigationBar {version} />

<Container style="max-width: 800px; padding-top: 1.5rem; padding-bottom: 1.5rem">
	<slot />
</Container>
