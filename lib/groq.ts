/**
 * Cliente para a API Groq (OpenAI-compatible).
 * Documentação: https://console.groq.com/docs
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export type GroqMessageRole = 'system' | 'user' | 'assistant';

export interface GroqMessage {
  role: GroqMessageRole;
  content: string;
}

export interface GroqChatOptions {
  /** Chave da API Groq (ou process.env.GROQ_API_KEY) */
  apiKey?: string;
  /** Modelo (ex: llama-3.1-70b-versatile, llama-3.1-8b-instant) */
  model?: string;
  /** Temperatura 0-2 */
  temperature?: number;
  /** Máximo de tokens na resposta */
  max_tokens?: number;
}

export interface GroqChatResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
    index: number;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * Envia uma conversa para a API Groq e retorna a resposta do modelo.
 */
export async function groqChat(
  messages: GroqMessage[],
  options: GroqChatOptions = {}
): Promise<GroqChatResponse> {
  const apiKey = options.apiKey ?? process.env.GROQ_API_KEY;
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('GROQ_API_KEY não definida. Defina a variável de ambiente ou passe apiKey nas opções.');
  }

  const model = options.model ?? 'llama-3.2-90b-vision-preview';
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 1024,
  };

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    let errMessage = `Groq API error ${response.status}: ${text}`;
    try {
      const json = JSON.parse(text);
      if (json.error?.message) errMessage = json.error.message;
    } catch {
      // use text as-is
    }
    throw new Error(errMessage);
  }

  return response.json() as Promise<GroqChatResponse>;
}

/**
 * Retorna o texto da primeira escolha da resposta.
 */
export function getGroqReply(response: GroqChatResponse): string {
  const choice = response.choices?.[0];
  if (!choice?.message?.content) {
    throw new Error('Resposta da Groq sem conteúdo.');
  }
  return choice.message.content;
}
