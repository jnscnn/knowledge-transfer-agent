# Digital Coworker — Future Phase

> ⚠️ This document describes the **future vision** for the Knowledge Transfer Agent. Phase 1 focuses on knowledge capture and query. The digital coworker capabilities described here are targeted for Phase 2+.

## Vision

Once institutional knowledge is captured and queryable, the natural evolution is an agent that doesn't just *answer questions* about what the retiree used to do — it can *do the work itself*. The digital coworker is a task-executing agent that inherits the retiree's operational responsibilities.

## Capability Maturity Model

```mermaid
graph LR
    L1["Level 1<br/><b>Informer</b><br/><i>Answers questions<br/>about knowledge</i>"]
    L2["Level 2<br/><b>Advisor</b><br/><i>Proactively suggests<br/>actions to take</i>"]
    L3["Level 3<br/><b>Assistant</b><br/><i>Drafts actions for<br/>human approval</i>"]
    L4["Level 4<br/><b>Executor</b><br/><i>Autonomously executes<br/>routine tasks</i>"]
    L5["Level 5<br/><b>Coworker</b><br/><i>Full autonomous agent<br/>with judgment</i>"]

    L1 -->|"Phase 1"| L2
    L2 -->|"Phase 2"| L3
    L3 -->|"Phase 2"| L4
    L4 -->|"Phase 3"| L5

    style L1 fill:#2ECC71,color:#fff
    style L2 fill:#3498DB,color:#fff
    style L3 fill:#9B59B6,color:#fff
    style L4 fill:#E67E22,color:#fff
    style L5 fill:#E74C3C,color:#fff
```

### Level Descriptions

| Level | Name | Autonomy | Human Involvement | Example |
|-------|------|----------|-------------------|---------|
| 1 | **Informer** | None | Full | "The quarterly review process works like this..." |
| 2 | **Advisor** | Suggestion | Decision-making | "It's time for the quarterly Contoso review. Here's what needs to happen..." |
| 3 | **Assistant** | Draft | Approval | "I've drafted the quarterly review agenda and pre-filled the template. Approve to send." |
| 4 | **Executor** | Routine tasks | Exception handling | Automatically generates reports, sends reminders, updates dashboards |
| 5 | **Coworker** | Full (within scope) | Oversight only | Handles vendor communications, escalates edge cases, adapts processes |

## Architecture for Task Execution

```mermaid
graph TB
    subgraph "Trigger Layer"
        SCHED["Scheduler<br/><i>Time-based triggers</i>"]
        EVENT["Event Listener<br/><i>M365 events</i>"]
        REQ["User Request<br/><i>Direct ask</i>"]
    end

    subgraph "Planning Layer"
        PLAN["Task Planner<br/><i>Decomposes goal<br/>into steps</i>"]
        CTX["Context Loader<br/><i>Retrieves relevant<br/>knowledge</i>"]
        RISK["Risk Assessor<br/><i>Evaluates task<br/>complexity & risk</i>"]
    end

    subgraph "Execution Layer"
        ENG["Execution Engine<br/><i>Azure AI Foundry<br/>with tool use</i>"]
        
        subgraph "Tools"
            PA["Power Automate<br/><i>Workflow execution</i>"]
            GRAPH_T["Graph API<br/><i>M365 actions</i>"]
            EMAIL_T["Email/Teams<br/><i>Communication</i>"]
            DOC_T["SharePoint<br/><i>Document ops</i>"]
        end
    end

    subgraph "Approval Layer"
        AUTO["Auto-Approve<br/><i>Low-risk, routine</i>"]
        HITL["Human-in-the-Loop<br/><i>Teams Adaptive Card</i>"]
        BLOCK["Block & Escalate<br/><i>High-risk actions</i>"]
    end

    SCHED --> PLAN
    EVENT --> PLAN
    REQ --> PLAN
    PLAN --> CTX
    CTX --> RISK
    RISK -->|"Low risk"| ENG
    RISK -->|"Medium risk"| HITL
    RISK -->|"High risk"| BLOCK
    HITL -->|"Approved"| ENG
    ENG --> PA
    ENG --> GRAPH_T
    ENG --> EMAIL_T
    ENG --> DOC_T
    ENG -->|"Result"| AUTO

    style ENG fill:#2ECC71,color:#fff
    style HITL fill:#F39C12,color:#fff
    style BLOCK fill:#E74C3C,color:#fff
```

## Task Categories

### Routine Tasks (Level 4 — Auto-executable)

Tasks the retiree performed regularly that follow predictable patterns:

| Task | Trigger | Action | Tools Used |
|------|---------|--------|-----------|
| Send quarterly vendor review reminder | Calendar (quarterly) | Draft & send email to stakeholders | Graph API (email) |
| Generate monthly status report | Calendar (monthly) | Pull data, fill template, share | SharePoint, Power Automate |
| Update shared dashboard | Data change event | Refresh charts and metrics | Power BI, SharePoint |
| Respond to FAQ inquiries | Incoming email/message | Recognize FAQ, send standard response | Graph API (email/Teams) |
| Archive completed project files | Project completion trigger | Move files, update metadata | SharePoint, OneDrive |

### Judgment Tasks (Level 5 — Human oversight)

Tasks requiring contextual judgment that the agent learns from the retiree's patterns:

| Task | Complexity | Agent Role | Human Role |
|------|-----------|------------|-----------|
| Vendor escalation | Medium | Draft escalation email, suggest contacts | Review & send |
| Budget reallocation | High | Analyze options, recommend allocation | Decide & approve |
| Process exception handling | Medium | Identify exception, propose resolution | Validate approach |
| New team member onboarding | Low-Medium | Generate personalized onboarding plan | Review & customize |
| Cross-team coordination | High | Draft proposals, schedule meetings | Strategic decisions |

## Human-in-the-Loop Design

### Approval Flow via Teams Adaptive Cards

```mermaid
sequenceDiagram
    participant A as Digital Coworker
    participant T as Teams (Adaptive Card)
    participant U as Approver
    participant E as Execution Engine

    A->>A: Plan task execution
    A->>A: Assess risk level
    
    alt Low Risk (auto-approve)
        A->>E: Execute directly
        E->>T: Notification: "Completed [task]"
    else Medium Risk (approval needed)
        A->>T: Send Adaptive Card<br/>"Approve: Send quarterly review<br/>reminder to Contoso team?"
        T->>U: Display card with<br/>Preview | Approve | Reject | Edit
        
        alt Approved
            U->>T: Click Approve
            T->>E: Execute task
            E->>T: Confirmation
        else Rejected
            U->>T: Click Reject + reason
            T->>A: Learn from rejection
        else Edited
            U->>T: Modify draft
            T->>E: Execute modified version
        end
    else High Risk (blocked)
        A->>T: Alert: "I identified [task] but<br/>it requires human judgment.<br/>Here's the context..."
    end
```

### Risk Assessment Matrix

| Factor | Low Risk (Auto) | Medium Risk (Approve) | High Risk (Block) |
|--------|----------------|----------------------|-------------------|
| **Financial impact** | < $1,000 | $1,000 - $50,000 | > $50,000 |
| **Audience** | Internal, known recipients | External, known vendors | Unknown or broad external |
| **Reversibility** | Easily undone | Partially reversible | Irreversible |
| **Precedent** | Exact match in history | Similar to past actions | No precedent |
| **Data sensitivity** | Public/Internal | Confidential | Highly Confidential |

## Learning & Improvement

The digital coworker improves over time through:

1. **Approval Feedback** — Approved actions reinforce the model; rejections trigger re-evaluation
2. **Correction Learning** — When a human edits a draft before approving, the agent learns the correction
3. **Outcome Tracking** — Track whether executed actions achieved their intended outcome
4. **Escalation Analysis** — Identify patterns in escalations to reduce future false positives

## Guardrails

### Safety Constraints

- **Scope Lock** — The agent can ONLY perform actions within the retiree's documented domain
- **Blast Radius Limits** — Maximum number of recipients, file modifications, or API calls per action
- **Kill Switch** — Admin can instantly disable all autonomous actions via the web dashboard
- **Audit Everything** — Every planned action, approval decision, and execution result is logged
- **Gradual Rollout** — Start with Level 2 (Advisor) and progressively unlock higher levels per-task based on track record
- **Expiry** — Autonomous capabilities expire after a configurable period (e.g., 12 months) unless explicitly renewed

### Ethical Considerations

- The digital coworker should be **transparently non-human** — it never impersonates the retiree
- Recipients of agent-generated communications should know they're interacting with an AI
- The agent should **defer to humans** on interpersonal or politically sensitive matters
- Regular **bias audits** ensure the agent doesn't perpetuate problematic patterns from the retiree's behavior
