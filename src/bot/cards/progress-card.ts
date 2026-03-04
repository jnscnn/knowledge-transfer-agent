function coverageBar(pct: number): string {
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${pct}%`;
}

export function buildProgressCard(data: {
  retiree: { name: string; overallCoverage: number };
  domains: Array<{ name: string; coverage: number; chunks: number }>;
  recentSessions: number;
  totalChunks: number;
}): object {
  const domainRows = data.domains.map((d) => ({
    type: 'ColumnSet' as const,
    columns: [
      {
        type: 'Column' as const,
        width: 'stretch',
        items: [
          {
            type: 'TextBlock' as const,
            text: d.name,
            wrap: true,
            weight: 'Bolder' as const,
          },
        ],
      },
      {
        type: 'Column' as const,
        width: 'auto',
        items: [
          {
            type: 'TextBlock' as const,
            text: coverageBar(d.coverage),
            fontType: 'Monospace' as const,
          },
        ],
      },
      {
        type: 'Column' as const,
        width: 'auto',
        items: [
          {
            type: 'TextBlock' as const,
            text: `${d.chunks} chunks`,
            isSubtle: true,
          },
        ],
      },
    ],
  }));

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: `📈 Knowledge Capture Progress — ${data.retiree.name}`,
        weight: 'Bolder',
        size: 'Large',
      },
      {
        type: 'ColumnSet',
        columns: [
          {
            type: 'Column',
            width: 'stretch',
            items: [
              {
                type: 'TextBlock',
                text: `**Overall Coverage**\n${coverageBar(data.retiree.overallCoverage)}`,
                wrap: true,
                fontType: 'Monospace',
              },
            ],
          },
          {
            type: 'Column',
            width: 'auto',
            items: [
              {
                type: 'FactSet',
                facts: [
                  {
                    title: 'Total Chunks',
                    value: String(data.totalChunks),
                  },
                  {
                    title: 'Sessions',
                    value: String(data.recentSessions),
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'TextBlock',
        text: '**Domain Breakdown**',
        weight: 'Bolder',
        spacing: 'Medium',
      },
      ...domainRows,
    ],
    actions: [
      {
        type: 'Action.Submit',
        title: '🎙️ Start Interview',
        data: { type: 'start_interview' },
      },
    ],
  };
}
