 <script lang="ts">
	export let locked: boolean | undefined;
	export let addedLevels: Set<string>[] | undefined;
	export let minDateLabel: { date: string; time: string } | '' = '';
	export let maxDateLabel: { date: string; time: string } | '' = '';
	export let maxHop: number | undefined = undefined;

	const hopColors = [
		'#ff0000', // Hop 0: Red (seeds)
		'#0000ff', // Hop 1: Blue
		'#00c800', // Hop 2: Green
		'#ffff00', // Hop 3: Yellow
		'#800080', // Hop 4: Purple
		'#ffa500', // Hop 5: Orange
		'#00ffff', // Hop 6: Cyan
		'#ff00ff', // Hop 7: Magenta
		'#808080'  // Hop 8+: Gray
	];

	function getHopColor(hop: number): string {
		if (hop < hopColors.length) {
			return hopColors[hop];
		}
		return hopColors[hopColors.length - 1]; // Gray for higher hops
	}
</script>

{#if locked && addedLevels}
	<div class="node-color-legend">
		<h6>Node Distance</h6>
		<div class="legend-row">
			<span class="min-label">closest</span>
			<div class="color-bar"></div>
			<span class="max-label">farthest</span>
		</div>
	</div>
{:else if minDateLabel && maxDateLabel}
	<div class="node-color-legend">
		<h6>Node Age</h6>
		<div class="legend-row">
			<span class="min-label">
				<span class="date">{minDateLabel.date}</span>
				<span class="time">{minDateLabel.time}</span>
			</span>
			<div class="color-bar"></div>
			<span class="max-label">
				<span class="date">{maxDateLabel.date}</span>
				<span class="time">{maxDateLabel.time}</span>
			</span>
		</div>
	</div>
{:else if maxHop !== undefined}
	<div class="node-color-legend">
		<h6>Hop<br>Number</h6>
		<div class="discrete-legend">
			{#each Array(Math.min(maxHop + 1, 9)) as _, i}
				<div class="hop-item">
					<div class="hop-color" style="background-color: {getHopColor(i)}"></div>
					<span class="hop-label">{i === 0 ? 'Seeds' : i}</span>
				</div>
			{/each}
			{#if maxHop >= 8}
				<div class="hop-item">
					<div class="hop-color" style="background-color: #808080"></div>
					<span class="hop-label">8+</span>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.node-color-legend {
		position: fixed;
		bottom: 20px;
		right: 20px;
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid #ddd;
		border-radius: 8px;
		padding: 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		font-size: 12px;
		width: 140px;
		z-index: 1000;
	}

	.node-color-legend h6 {
		margin: 0 0 4px 0;
		font-size: 13px;
		font-weight: 600;
		color: #333;
		text-align: center;
	}

	.legend-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.color-bar {
		flex: 1;
		height: 15px;
		background: linear-gradient(to right, #0000ff, #c8c800, #00c800);
		border-radius: 3px;
	}

	.min-label,
	.max-label {
		display: flex;
		flex-direction: column;
		align-items: center;
		font-size: 10px;
		color: #555;
		white-space: nowrap;
		line-height: 1.2;
	}

	.date {
		font-weight: 500;
	}

	.time {
		font-size: 9px;
		color: #777;
	}

	.discrete-legend {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.hop-item {
		display: flex;
		align-items: center;
		gap: 3px;
		font-size: 9px;
		color: #555;
		line-height: 1;
	}

	.hop-color {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		border: 1px solid rgba(0, 0, 0, 0.2);
		flex-shrink: 0;
	}

	.hop-label {
		min-width: 18px;
		text-align: left;
		font-size: 9px;
	}
</style>
