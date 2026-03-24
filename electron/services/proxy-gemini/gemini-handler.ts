/**
 * OpenAI-compatible /v1/chat/completions to Gemini (Google) API Bridge
 * Translates OpenAI payload objects (messages, stream, temp) into Gemini REST payload structures.
 */

import { Request, Response } from 'express';
import { createLogger } from '../../utils/Logger';

const log = createLogger('GeminiHandler');

// Replace this with standard Gemini endpoints if proxy pool or specific GCP endpoints are used.
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Transforms OpenAI messages to Gemini Content Objects
 */
function translateMessages(messages: any[]): { contents: any[], systemInstruction?: any } {
  const contents: any[] = [];
  let systemText = '';

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemText += msg.content + '\n';
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';
    contents.push({
      role: role,
      parts: [{ text: msg.content || '' }]
    });
  }

  // Gemini insists that 'contents' array doesn't start with 'model'
  // or have adjacent identical roles. A simplified mapping is done here.
  // We leave complex merge resolution out unless strictly needed for basic proxy.

  const result: any = { contents };
  if (systemText) {
    result.systemInstruction = {
      role: 'user',
      parts: [{ text: systemText.trim() }]
    };
  }

  return result;
}

export async function handleGeminiChatCompletions(req: Request, res: Response) {
  try {
    const geminiKey = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!geminiKey) {
      res.status(401).json({ error: { message: 'Missing Gemini API Key in Authorization header' } });
      return;
    }

    const { model, messages, stream, temperature, top_p, max_tokens } = req.body;
    const isStream = stream === true;

    // Use a default Gemini model if unspecified or incorrectly formatted
    const targetModel = (model || 'gemini-1.5-pro').replace('-proxy', '');

    const { contents, systemInstruction } = translateMessages(messages || []);

    const geminiPayload: any = {
      contents,
      generationConfig: {
        temperature: temperature !== undefined ? temperature : 0.7,
        topP: top_p !== undefined ? top_p : 0.9,
        maxOutputTokens: max_tokens || undefined
      }
    };
    if (systemInstruction) {
      geminiPayload.system_instruction = systemInstruction;
    }

    // Determine endpoint
    const streamSuffix = isStream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const endpoint = `${GEMINI_BASE_URL}/models/${targetModel}:${streamSuffix}&key=${geminiKey}`;

    const fetchRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload),
    });

    if (!fetchRes.ok) {
      const errText = await fetchRes.text();
      log.error(`Gemini Upstream Error [${fetchRes.status}]:`, errText);
      res.status(fetchRes.status).json({ error: { message: `Upstream Gemini Error: ${errText}` } });
      return;
    }

    if (isStream) {
      // Set headers for SSE streaming
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // The Gemini alt=sse streams chunks prefixed with "data: "
      // We must map these back to OpenAI stream formatted chunks!
      const reader = fetchRes.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      if (!reader) throw new Error('Failed to get reader from Gemini fetch');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkText = decoder.decode(value, { stream: true });
        const lines = chunkText.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
            try {
              const geminiData = JSON.parse(line.slice(6));
              const textChunk = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              
              const openAIData = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: targetModel,
                choices: [{
                  index: 0,
                  delta: { content: textChunk },
                  finish_reason: null
                }]
              };
              
              res.write(`data: ${JSON.stringify(openAIData)}\n\n`);
            } catch (pErr) {
               // Malformed JSON chunk, ignore temporarily
            }
          }
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // Non-streaming response payload mapping
      const geminiData = await fetchRes.json() as any;
      const textResponse = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      const openAIResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: targetModel,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: textResponse },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };
      res.json(openAIResponse);
    }
  } catch (err: any) {
    log.error('Gemini Handler Exception:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: { message: err.message } });
    }
  }
}
