import type { AgentResponse } from '../../shared/types.js';

function confidenceEmoji(confidence: number): string {
  if (confidence >= 0.7) return '🟢 High';
  if (confidence >= 0.4) return '🟡 Medium';
  return '🔴 Low';
}

function coverageLabel(coverage: AgentResponse['coverage']): string {
  switch (coverage) {
    case 'complete':
      return '✅ Complete';
    case 'partial':
      return '⚠️ Partial';
    case 'insufficient':
      return '❌ Insufficient';
  }
}

export function buildAnswerCard(response: AgentResponse): object {
  const sourceFacts = response.sources.map((s) => ({
    type: 'FactSet' as const,
    facts: [
      { title: 'Source', value: s.title },
      { title: 'Type', value: s.type },
      { title: 'Retiree', value: s.retiree },
      { title: 'Relevance', value: `${Math.round(s.relevance * 100)}%` },
    ],
    separator: true,
  }));

  const followUpActions = response.followUps.map((q) => ({
    type: 'Action.Submit' as const,
    title: q,
    data: { type: 'follow_up_query', query: q },
  }));

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: response.answer,
        wrap: true,
        size: 'Medium',
      },
      {
        type: 'ColumnSet',
        columns: [
          {
            type: 'Column',
            width: 'auto',
            items: [
              {
                type: 'TextBlock',
                text: `**Confidence:** ${confidenceEmoji(response.confidence)} (${Math.round(response.confidence * 100)}%)`,
                wrap: true,
                size: 'Small',
              },
            ],
          },
          {
            type: 'Column',
            width: 'auto',
            items: [
              {
                type: 'TextBlock',
                text: `**Coverage:** ${coverageLabel(response.coverage)}`,
                wrap: true,
                size: 'Small',
              },
            ],
          },
        ],
      },
      ...(response.sources.length > 0
        ? [
            {
              type: 'ActionSet',
              actions: [
                {
                  type: 'Action.ShowCard',
                  title: `📚 Sources (${response.sources.length})`,
                  card: {
                    type: 'AdaptiveCard',
                    body: sourceFacts,
                  },
                },
              ],
            },
          ]
        : []),
    ],
    actions: [
      ...followUpActions,
      {
        type: 'Action.Submit',
        title: '👍',
        data: {
          type: 'feedback',
          queryId: response.queryId,
          value: 'positive',
        },
      },
      {
        type: 'Action.Submit',
        title: '👎',
        data: {
          type: 'feedback',
          queryId: response.queryId,
          value: 'negative',
        },
      },
    ],
  };
}
