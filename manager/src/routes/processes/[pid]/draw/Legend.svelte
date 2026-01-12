<script lang="ts">
	export let minDateLabel: any;
	export let maxDateLabel: any;
	export let state: any;
</script>

{#if state.locked && state.addedLevels}
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
{/if}

<style>
	.node-color-legend {
		margin-bottom: 10px;
		padding: 10px;
		background: white;
		border: 1px solid #ddd;
		border-radius: 4px;
	}

	.node-color-legend h6 {
		margin: 0 0 10px 0;
		font-size: 14px;
		font-weight: bold;
	}

	.legend-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.min-label,
	.max-label {
		font-size: 12px;
		flex: 0 0 auto;
	}

	.min-label {
		text-align: left;
	}

	.max-label {
		text-align: right;
	}

	.color-bar {
		flex: 1;
		height: 10px;
		background: linear-gradient(to right, #0000ff, #00ffff, #ffff00, #00ff00);
		margin: 0 10px;
		border-radius: 2px;
	}
</style>
