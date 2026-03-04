export function buildConsentCard(retiree: {
  name: string;
  email: string;
}): object {
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: '📋 Knowledge Transfer Consent',
        weight: 'Bolder',
        size: 'Large',
      },
      {
        type: 'TextBlock',
        text: `**${retiree.name}** (${retiree.email})`,
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: 'The Knowledge Transfer Agent collects and processes institutional knowledge to help your team retain critical information. Please review and consent to the data collection scopes below.',
        wrap: true,
        spacing: 'Medium',
      },
      {
        type: 'TextBlock',
        text: '**Data Collection Scopes:**',
        wrap: true,
        spacing: 'Medium',
        weight: 'Bolder',
      },
      {
        type: 'Input.Toggle',
        id: 'emailObservation',
        title: '📧 Email Observation — Analyze email patterns to identify knowledge domains and key contacts',
        value: 'false',
      },
      {
        type: 'Input.Toggle',
        id: 'calendarObservation',
        title: '📅 Calendar Observation — Review meeting patterns to understand recurring processes',
        value: 'false',
      },
      {
        type: 'Input.Toggle',
        id: 'documentObservation',
        title: '📄 Document Observation — Analyze authored and frequently accessed documents',
        value: 'false',
      },
      {
        type: 'Input.Toggle',
        id: 'interviewCapture',
        title: '🎙️ Interview Capture — Record and process knowledge from structured interview sessions',
        value: 'false',
      },
      {
        type: 'Input.Toggle',
        id: 'knowledgeSharing',
        title: '🔗 Knowledge Sharing — Make captured knowledge available to designated successors and team members',
        value: 'false',
      },
      {
        type: 'TextBlock',
        text: '*You can revoke consent at any time by contacting your administrator.*',
        wrap: true,
        isSubtle: true,
        size: 'Small',
        spacing: 'Medium',
      },
    ],
    actions: [
      {
        type: 'Action.Submit',
        title: '✅ Accept',
        data: {
          type: 'consent_response',
          action: 'accept',
          retireeEmail: retiree.email,
        },
        style: 'positive',
      },
      {
        type: 'Action.Submit',
        title: '❌ Decline',
        data: {
          type: 'consent_response',
          action: 'decline',
          retireeEmail: retiree.email,
        },
        style: 'destructive',
      },
    ],
  };
}
