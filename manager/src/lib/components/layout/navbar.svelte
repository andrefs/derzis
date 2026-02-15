<script lang="ts">
  export let version: string;
  export let modeTag;

  import {
    Navbar,
    Nav,
    NavbarBrand,
    NavbarToggler,
    Collapse,
    NavItem,
    NavLink,
    Badge
  } from '@sveltestrap/sveltestrap';
  import { Icon } from 'svelte-icons-pack';
  import { BsCardList, BsPlusSquare, BsBookHalf, BsGlobe } from 'svelte-icons-pack/bs';
  import { FiCloudLightning } from 'svelte-icons-pack/fi';

  let isOpen = false;
  const toggle = () => (isOpen = !isOpen);
</script>

<Navbar color="light" light expand="md">
  <NavbarBrand href="/processes">
    <Icon src={FiCloudLightning} size="1.5em" /> <span style="font-weight: bold">Derzis</span>
    <small class="text-muted"> v{version}</small>
    <Badge
      color={/local/.test(modeTag) ? 'info' : /dc|docker/.test(modeTag) ? 'warning' : 'primary'}
      class="ms-2"
    >
      {modeTag || 'production'}
    </Badge>
  </NavbarBrand>
  <NavbarToggler on:click={toggle} />
  <Collapse {isOpen} navbar expand="md">
    <Nav navbar>
      <NavItem>
        <NavLink href="/processes"><Icon src={BsCardList} /> Processes</NavLink>
      </NavItem>
      <NavItem>
        <NavLink href="/domains"><Icon src={BsGlobe} /> Domains</NavLink>
      </NavItem>
      <NavItem>
        <NavLink href="/processes/new"><Icon src={BsPlusSquare} /> Add new</NavLink>
      </NavItem>
      <NavItem>
        <NavLink href="/docs/api"><Icon src={BsBookHalf} /> API docs</NavLink>
      </NavItem>
    </Nav>
  </Collapse>
</Navbar>
