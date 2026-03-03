# ADR-003: Hybrid Knowledge Extraction (Passive + Active)

## Status

**Accepted**

## Context

We need to decide how the Knowledge Transfer Agent extracts knowledge from retiring employees. The two main approaches are:

1. **Passive observation only** — Monitor the retiree's digital work via Graph API, extract knowledge from existing artifacts
2. **Active interviews only** — Conduct structured interview sessions where the agent asks targeted questions
3. **Hybrid** — Combine both passive observation and active interviews

## Decision

We will use a **hybrid approach**: passive observation to build a baseline understanding and identify gaps, combined with structured interviews to capture tacit knowledge and fill those gaps.

## Rationale

### Why passive observation alone isn't enough

Passive observation captures **what** the retiree does but not **why**:

- Emails show communication patterns but not the rationale behind decisions
- Calendar shows meetings but not what knowledge gets exchanged
- Documents show authored content but not the tribal knowledge needed to maintain it
- Teams messages capture informal knowledge but it's often fragmentary and context-dependent

**Key insight:** The most critical knowledge to transfer is tacit — the "why" behind decisions, the unwritten rules, the "gotchas" that only experience teaches. This knowledge rarely appears in digital artifacts.

### Why interviews alone aren't enough

Pure interview-based extraction has well-documented limitations:

- **Recall bias** — People forget what they know, especially routine knowledge
- **Curse of knowledge** — Experts can't articulate what beginners need to know
- **Time pressure** — Limited interview sessions can't cover everything
- **Unstructured** — Without data-driven focus, interviews meander into already-documented topics

### Why hybrid is optimal

The hybrid approach creates a powerful feedback loop:

```
Passive Observation → Identifies knowledge domains and gaps
                    ↓
Interview Agent ← Uses gaps to prioritize questions
                    ↓
Captured Knowledge → Fills gaps, improves domain map
                    ↓
Passive Observation → Validates and identifies remaining gaps
```

Specifically:

1. **Observation surfaces the "what"** — What topics, systems, people, and processes the retiree is involved with
2. **Observation identifies gaps** — What domains have no documentation, who are the unique contacts
3. **Interviews capture the "why"** — Decision rationale, tribal knowledge, workarounds
4. **Observation validates interviews** — Cross-reference interview claims against actual work patterns
5. **Interviews explain observations** — "I noticed you emailed Charlie 15 times last week about SLAs — what's the context?"

## Implementation Notes

### Sequencing

1. **Week 1-2:** Passive observation begins immediately after consent, building the initial knowledge domain map
2. **Week 2+:** Interview sessions start, guided by observations
3. **Ongoing:** Observation continues during interview phase, refining gap analysis
4. **Final weeks:** Focused interviews on remaining gaps identified by observation

### Privacy Balance

The hybrid approach raises legitimate privacy concerns that we address through:

- **Explicit, granular consent** (see [Security & Governance](../security-governance.md))
- **Observation only within consented scope** — no "surveillance" of all activity
- **Observation focuses on patterns, not content** — we analyze what domains are active, not read every email
- **Content is only deeply analyzed for consented sources** (e.g., work SharePoint, not personal OneDrive)

## Consequences

### Positive
- Most comprehensive knowledge capture (both explicit and tacit)
- Data-driven interview prioritization reduces wasted session time
- Cross-validation between sources improves knowledge quality
- Retiree spends less time in interviews because observation handles the "easy" knowledge

### Negative
- **More complex system** — Two extraction channels means more components to build and maintain
- **Higher Graph API usage** — Passive observation requires significant API calls (and Graph API throttling limits)
- **Privacy sensitivity** — Observation (even with consent) may create employee discomfort
- **Longer setup time** — Need 1-2 weeks of observation before interviews become optimally targeted

### Mitigations
- Observation component can be deployed independently; interviews work without it (degraded mode)
- Graph API throttling handled with retry logic and delta queries (incremental rather than full sync)
- Transparent observation dashboard shows the retiree exactly what's being captured
- Organizations uncomfortable with observation can start interviews-only and add observation later
