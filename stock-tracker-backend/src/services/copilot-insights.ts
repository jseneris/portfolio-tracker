import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';
import { homedir } from 'node:os';
import { join } from 'node:path';

const INSIGHTS_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    explanations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          factId: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['factId', 'explanation'],
      },
    },
  },
  required: ['explanations'],
} satisfies Record<string, unknown>;

let clientPromise: Promise<CopilotClient> | null = null;

async function getCopilotClient(): Promise<CopilotClient> {
  if (!clientPromise) {
    const copilotCliPath = process.env.COPILOT_CLI_PATH?.trim()
      || join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@github', 'copilot', 'npm-loader.js');
    const client = new CopilotClient({
      connection: RuntimeConnection.forStdio({ path: copilotCliPath }),
      mode: 'copilot-cli',
      baseDirectory: join(homedir(), '.copilot'),
      useLoggedInUser: true,
      logLevel: 'error',
    });

    clientPromise = client.start()
      .then(() => client)
      .catch((error: unknown) => {
        clientPromise = null;
        throw error;
      });
  }

  return clientPromise;
}

export async function generateCopilotInsights(prompt: string): Promise<string> {
  return sendCopilotPrompt(
    `${prompt}\n\nRespond with only a JSON object (no markdown, no code fences) matching this JSON Schema:\n${JSON.stringify(INSIGHTS_RESPONSE_SCHEMA)}`
  );
}

export async function askCopilotAboutInsights(prompt: string): Promise<string> {
  return sendCopilotPrompt(prompt);
}

async function sendCopilotPrompt(prompt: string): Promise<string> {
  const client = await getCopilotClient();
  const session = await client.createSession({
    model: process.env.COPILOT_MODEL?.trim() || 'gpt-5.6-luna',
    availableTools: [],
    skipCustomInstructions: true,
    infiniteSessions: { enabled: false },
    memory: { enabled: false },
    enableSessionStore: false,
  });

  try {
    const response = await session.sendAndWait(prompt, 30_000);
    const content = response?.data.content?.trim();
    if (!content) {
      throw new Error('Copilot returned an empty portfolio insights response.');
    }
    return content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  } finally {
    await session.disconnect().catch(() => undefined);
    await client.deleteSession(session.sessionId).catch(() => undefined);
  }
}

export async function stopCopilotClient(): Promise<void> {
  const pendingClient = clientPromise;
  clientPromise = null;
  const client = await pendingClient?.catch(() => null);
  if (client) {
    await client.stop().catch(() => undefined);
  }
}