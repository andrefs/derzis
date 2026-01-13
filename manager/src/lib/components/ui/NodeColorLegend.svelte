<script lang="ts">
	export let locked: boolean | undefined;
	export let addedLevels: Set<string>[] | undefined;
	export let minDateLabel: { date: string; time: string } | '' = '';
	export let maxDateLabel: { date: string; time: string } | '' = '';
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
		width: 220px;
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
</style>
