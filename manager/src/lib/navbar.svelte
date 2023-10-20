<script lang="ts">
	export let version: string;

	import { Navbar, Nav, NavbarBrand, NavbarToggler, Collapse, NavItem, NavLink } from 'sveltestrap';
	import Icon from 'svelte-icons-pack/Icon.svelte';
	import BsCardList from 'svelte-icons-pack/bs/BsCardList';
	import BsPlusSquare from 'svelte-icons-pack/bs/BsPlusSquare';
	import BsBookHalf from 'svelte-icons-pack/bs/BsBookHalf';
	import FiCloudLightning from 'svelte-icons-pack/fi/FiCloudLightning';

	let isOpen = false;
	const toggle = () => (isOpen = !isOpen);
</script>

<Navbar color="light" light expand="md">
	<NavbarBrand href="/processes">
		<Icon src={FiCloudLightning} size="1.5em" /> <span style="font-weight: bold">Derzis</span>
		<small class="text-muted"> v{version}</small>
	</NavbarBrand>
	<NavbarToggler on:click={toggle} />
	<Collapse {isOpen} navbar expand="md">
		<Nav navbar>
			<NavItem>
				<NavLink href="/processes"><Icon src={BsCardList} /> Processes</NavLink>
			</NavItem>
			<NavItem>
				<NavLink href="/processes/new"><Icon src={BsPlusSquare} /> Add new</NavLink>
			</NavItem>
			<NavItem>
				<NavLink href="/api-docs"><Icon src={BsBookHalf} /> Documentation</NavLink>
			</NavItem>
		</Nav>
	</Collapse>
</Navbar>
