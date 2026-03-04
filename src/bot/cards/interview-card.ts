import type { InterviewSession } from '../../shared/types.js';

export function buildInterviewWelcomeCard(retiree: {
  name: string;
  sessionNumber: number;
}): object {
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: `🎙️ Interview Session #${retiree.sessionNumber}`,
        weight: 'Bolder',
        size: 'Large',
      },
      {
        type: 'TextBlock',
        text: `Welcome, **${retiree.name}**! This interview session will help capture your institutional knowledge. Answer questions naturally — I'll guide the conversation and save key insights.`,
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: '💡 *Type your responses normally. Say "done" or use `/interview end` to finish.*',
        wrap: true,
        isSubtle: true,
        size: 'Small',
      },
    ],
    actions: [
      {
        type: 'Action.Submit',
        title: '❌ End Interview',
        data: { type: 'end_interview' },
        style: 'destructive',
      },
    ],
  };
}

export function buildInterviewProgressCard(
  session: InterviewSession,
): object {
  const elapsed = session.endedAt
    ? session.endedAt.getTime() - session.startedAt.getTime()
    : Date.now() - session.startedAt.getTime();
  const minutes = Math.round(elapsed / 60_000);

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: `📊 Session #${session.sessionNumber} Progress`,
        weight: 'Bolder',
        size: 'Medium',
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Status', value: session.status },
          { title: 'Duration', value: `${minutes} min` },
          {
            title: 'Focus Domains',
            value: session.focusDomains.join(', '),
          },
          {
            title: 'Questions Asked',
            value: String(session.questionsAsked.length),
          },
          {
            title: 'Chunks Captured',
            value: String(session.knowledgeChunksProduced.length),
          },
          {
            title: 'Coverage Before',
            value: `${session.coverageBefore}%`,
          },
        ],
      },
    ],
  };
}

export function buildSessionSummaryCard(summary: {
  chunksProduced: number;
  coverageDelta: number;
  nextSuggestion: string;
}): object {
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: '✅ Interview Session Complete',
        weight: 'Bolder',
        size: 'Large',
      },
      {
        type: 'FactSet',
        facts: [
          {
            title: 'Knowledge Chunks Captured',
            value: String(summary.chunksProduced),
          },
          {
            title: 'Coverage Change',
            value: `+${summary.coverageDelta}%`,
          },
        ],
      },
      {
        type: 'TextBlock',
        text: `**Next:** ${summary.nextSuggestion}`,
        wrap: true,
        spacing: 'Medium',
      },
    ],
    actions: [
      {
        type: 'Action.Submit',
        title: '🎙️ Start Another Session',
        data: { type: 'start_interview' },
      },
    ],
  };
}
