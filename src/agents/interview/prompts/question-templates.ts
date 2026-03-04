// ──────────────────────────────────────────────
// Domain-specific question templates
// ──────────────────────────────────────────────

/**
 * Question templates keyed by knowledge domain.
 * Placeholders use `{{placeholder_name}}` syntax and are filled at runtime.
 */
export const questionTemplates: Record<string, string[]> = {
  vendor_management: [
    'Can you walk me through the full lifecycle of your relationship with {{vendor_name}} — from initial engagement to day-to-day operations?',
    'What are the unwritten rules or informal agreements you have with {{vendor_name}} that aren\'t captured in the contract?',
    'When {{vendor_name}} misses a deadline or delivers below expectations, what\'s your escalation process and who do you contact?',
    'Are there specific contacts at {{vendor_name}} who are critical to getting things done? What\'s the best way to work with them?',
    'What renewal or pricing traps should your successor watch out for with {{vendor_name}}?',
    'How do you evaluate whether {{vendor_name}} is still the right fit versus alternatives you\'ve considered?',
  ],

  system_administration: [
    'What does a typical day of monitoring and maintaining {{system_name}} look like for you?',
    'What are the most common failure modes in {{system_name}}, and what are the undocumented steps you take to recover?',
    'Are there any scheduled tasks, cron jobs, or manual interventions on {{system_name}} that only you know about?',
    'How does {{system_name}} interact with other systems, and where are the fragile integration points?',
    'If {{system_name}} went down at 2 AM, what\'s the exact sequence of steps you\'d follow to diagnose and restore it?',
    'What configuration settings in {{system_name}} have been tuned over time, and what happens if they\'re reset to defaults?',
  ],

  process_ownership: [
    'Walk me through {{process_name}} end-to-end — every step, including the ones that aren\'t in the official documentation.',
    'What are the decision points in {{process_name}} where you exercise judgment rather than following a fixed rule?',
    'Who are the key people involved in {{process_name}}, and what does each person\'s informal role look like?',
    'What are the most common exceptions or edge cases in {{process_name}}, and how do you handle them?',
    'How has {{process_name}} evolved over the years, and what earlier approaches were abandoned and why?',
    'If {{process_name}} fails or stalls, what\'s your troubleshooting checklist?',
  ],

  financial_operations: [
    'Can you describe the complete flow of {{process_name}}, including any manual reconciliation steps?',
    'What controls or checks in {{process_name}} exist only because of past incidents? What were those incidents?',
    'Are there any workarounds in {{process_name}} to compensate for system limitations or data quality issues?',
    'Who are the key internal and external contacts for {{process_name}}, and when do you loop them in?',
    'What reporting deadlines drive {{process_name}}, and what\'s the real timeline versus the official one?',
    'What would a new person most likely get wrong in their first month owning {{process_name}}?',
  ],

  incident_response: [
    'What are the top five incidents you\'ve handled in the last two years, and what made each one challenging?',
    'Walk me through your mental model when a new incident comes in — how do you triage and prioritize?',
    'Are there any runbooks or playbooks that are outdated, incomplete, or that you\'ve mentally replaced with your own approach?',
    'Who are the people you call outside your immediate team when an incident escalates, and why them specifically?',
    'What early warning signs have you learned to recognise that something is about to go wrong?',
    'After an incident is resolved, what follow-up steps do you take that aren\'t part of the formal post-mortem process?',
  ],
};

/**
 * Template for the session opening message.
 * Placeholders: {{retiree_name}}, {{session_number}}, {{focus_domains}}, {{previous_summary}}
 */
export const sessionOpeningTemplate = `Hello {{retiree_name}}, welcome to session {{session_number}} of our knowledge transfer conversations.

Before we begin, I want to remind you that everything we discuss is captured with your consent, and you can review, edit, or retract any of it at any time.

{{previous_summary}}

Today I'd like to focus on: **{{focus_domains}}**.

Let's start — could you give me a high-level overview of your involvement in this area?`;

/**
 * Prompt template sent to the LLM to generate adaptive follow-up questions.
 * Placeholders: {{response}}, {{entities}}, {{domain}}, {{topics_covered}}
 */
export const adaptiveFollowUpPrompt = `Based on the retiree's response below, generate 2-3 targeted follow-up questions that dig deeper into the knowledge they shared.

## Retiree's Response
{{response}}

## Entities Detected
{{entities}}

## Current Domain
{{domain}}

## Topics Already Covered
{{topics_covered}}

## Instructions
- Focus on tacit knowledge, decision rationale, and hidden dependencies.
- Avoid repeating topics already covered.
- Each question should target a specific entity or concept from the response.
- Prioritise questions that uncover knowledge at risk of being lost.

Return your questions as a JSON array:
[
  {
    "text": "question text",
    "domain": "domain name",
    "generationLayer": "adaptive",
    "completeness": "needs_follow_up",
    "entitiesMentioned": [{ "text": "entity", "type": "EntityType", "confidence": 0.9 }]
  }
]`;
