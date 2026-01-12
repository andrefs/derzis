# Crawling RDF hierarchies: when metrics disagree

**Session ID:** ses_4559711e6ffeAJI3AvnLLxPmVm
**Created:** 1/11/2026, 12:16:02 AM
**Updated:** 1/11/2026, 12:16:43 AM

---

## User

The goal of this crawler is to discover RDF predicates that naturally form hierarchies. We are interested in crawling resources trying to climb these hierarchies. To avoid endless crawling, the follow direction parameter allows the user to say "from now on, only follow paths which seem to go up the chain. Two metrics can be used to infer this: branchingFactor (which tells us in which direction the predicate is more likely climbing the hierarchy) and seedPosRatio, which tells us in which side of a triple are the seed resources more likely to appear (seeds are arguably located in the lower parts of an hierarchy). Whenever the two metrics agree in the direction, the directionOk method returns true. But what should I do whenever the metrics are in disagreement?

---

## Assistant (Plan · grok-code · 35.7s)

_Thinking:_

The user is describing a crawler that discovers RDF predicates forming hierarchies. They want to crawl resources climbing these hierarchies, using a "follow direction" parameter to avoid endless crawling. Two metrics: branchingFactor and seedPosRatio, determine if a path is going up the hierarchy. directionOk returns true when both metrics agree.

```
Tool: task

**Input:**
```json
{
  "description": "Explore hierarchy direction logic",
  "prompt": "Explore the codebase thoroughly to understand how the crawler determines hierarchy direction using branchingFactor and seedPosRatio metrics. Focus on the directionOk method and what happens when these metrics disagree. Look for any existing handling of metric disagreements and related code in the manager and worker packages.",
  "subagent_type": "explore"
}
```
**Output:**
```
## Summary of Findings

I have thoroughly explored the Derzis Manager codebase to understand how the crawler determines hierarchy direction using `branchingFactor` and `seedPosRatio` metrics. Here are the key insights:

### Core Logic in `directionOk` Method

The hierarchy direction determination is implemented in the `TripleClass.directionOk()` method in `/home/andrefs/Academia/PhD/MAPi/projects/derzis-dev/models/src/Triple.ts` (lines 114-187).

**How it works:**
1. **Metrics Calculation:**
   - `branchingFactor` ratio: `bf.subj / bf.obj` 
   - `seedPosRatio` ratio: `sp.subj / sp.obj`
   - Direction is `'subj->obj'` if ratio ≥ 1, `'obj->subj'` if ratio < 1

2. **Direction Agreement Check:**
   - If both metrics agree on direction (`bfDir === sprDir`), the method checks if the current path head matches the expected position for that direction
   - If headUrl matches subject and direction is `subj->obj`, OR headUrl matches object and direction is `obj->subj`, the triple direction is considered OK

3. **When Metrics Disagree:**
   - The method logs a warning and **returns false** (direction not OK)
   - The triple is rejected for path extension

### Usage in Path Extension

The `directionOk` method is called in two places in `Path.ts`:
- `extendWithExistingTriples()` (line 179)
- `extend()` (line 255)

In both cases, triples that fail `directionOk` are filtered out and not used for extending paths.

### Metric Disagreement Handling

**Current Implementation:**
- **No special handling exists** for metric disagreements
- When `branchingFactor` and `seedPosRatio` disagree, the triple is simply rejected
- There's a FIXME comment in the code: `// FIXME what to do when bf and spr disagree on direction? // for now, we consider direction not ok`

### Data Flow

1. **Metrics Storage:** `predsDirMetrics` is stored as part of each crawling step in the `Process` model
2. **Input:** Metrics are provided via the `/api/processes/[pid]/add-step` endpoint in the manager
3. **Computation:** Metrics are computed externally (likely in the worker or analysis tools) and passed to the manager
4. **Application:** During crawling, the `curPredsDirMetrics()` method converts the stored metrics into a Map for efficient lookup

### Key Classes Involved

- `BranchFactorClass`: Stores subject and object counts for branching factor
- `SeedPosRatioClass`: Stores subject and object counts for seed position ratio  
- `PredDirMetrics`: Combines both metrics for a specific predicate URL
- `Process.currentStep.predsDirMetrics`: Array of metrics for the current crawling step

### No Existing Advanced Handling

The codebase currently has **no sophisticated logic** for resolving metric disagreements. The implementation takes a conservative approach: when the two metrics conflict, the triple is not allowed for path extension, effectively halting crawling along that direction for that predicate.

This appears to be an area marked for future improvement, as indicated by the FIXME comment.

<task_metadata>
session_id: ses_455970181ffepu4JPGZSYnia3C
</task_metadata>
```
```

---

## Assistant (Plan · grok-code · 5.9s)

_Thinking:_

The explore agent found that when metrics disagree, the code returns false and rejects the triple. There's a FIXME comment asking what to do when bf and spr disagree.


## Examining Code Behavior
- Found that when metrics disagree, the code returns false and rejects the triple.

When the `branchingFactor` and `seedPosRatio` metrics disagree on the hierarchy direction, the current code conservatively rejects the triple by returning `false` from `directionOk`, preventing path extension along that predicate. This avoids potentially bad crawling but may halt valid paths.

Here are several approaches to handle disagreements, with tradeoffs:

1. **Conservative (current)**: Reject triples on disagreement. Pros: Prevents endless crawling. Cons: May miss valid hierarchy paths.

2. **Permissive**: Accept triples regardless of disagreement. Pros: Allows more crawling. Cons: Risks infinite loops or off-hierarchy exploration.

3. **Weighted preference**: Favor one metric (e.g., `branchingFactor` over `seedPosRatio` based on reliability). Pros: Balanced decision-making. Cons: Subjective weighting.

4. **Confidence-based**: Accept if disagreement is minor (e.g., ratios close to 1.0), reject if extreme. Pros: Adaptive to metric strength. Cons: Requires threshold tuning.

5. **User-configurable**: Add a parameter (e.g., in process settings) to choose behavior per crawl. Pros: Flexible. Cons: Adds complexity.

Which approach aligns with your goals? Do you want to implement one, or need more analysis of disagreement patterns in your data?

---

