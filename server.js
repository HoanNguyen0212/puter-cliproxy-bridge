import './polyfills.js';
import { config } from 'dotenv';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { init } from '@heyputer/puter.js/src/init.cjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '.env') });

const PORT = Number(process.env.PORT || 3333);
const puter = init(process.env.PUTER_AUTH_TOKEN);
const app = express();
app.use(express.json({ limit: '20mb' }));

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      if (part?.text) return part.text;
      if (part?.type === 'input_text') return part.text || '';
      return '';
    }).join('');
  }
  if (content == null) return '';
  return String(content);
}

function toPuterMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [{ role: 'user', content: '' }];
  }
  return messages.map(m => ({
    role: m?.role || 'user',
    content: normalizeContent(m?.content)
  }));
}

function extractAssistantText(resp) {
  const c = resp?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map(part => {
      if (typeof part === 'string') return part;
      if (part?.text) return part.text;
      return '';
    }).join('');
  }
  return '';
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, auth: !!process.env.PUTER_AUTH_TOKEN });
});

const modelIds = [
  'gpt-4o-puter',
  'gpt-5.2-puter',
  'gpt-5.4-puter',
  'gpt-5.4-mini-puter',
  'gpt-5.4-nano-puter',
  'claude-opus-4-7-puter',
  'claude-sonnet-4-6-puter',
  'deepseek-chat-puter',
  'gemini-2.5-flash-puter',
  'gemini-3-flash-preview-puter',
  'gemini-3.1-pro-preview-puter'
];

app.get('/v1/models', (_req, res) => {
  res.json({
    object: 'list',
    data: modelIds.map(id => ({ id, object: 'model', owned_by: 'puter-bridge' }))
  });
});

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const body = req.body || {};
    const requestedModel = String(body.model || 'gpt-4o-puter');
    const upstreamModel = requestedModel
      .replace(/-puter$/, '')
      .replace(/-jsputer$/, '');

    const messages = toPuterMessages(body.messages);
    const opts = {
      model: upstreamModel,
      stream: false
    };

    if (typeof body.max_tokens === 'number') opts.max_tokens = Math.max(body.max_tokens, 16);
    if (typeof body.temperature === 'number') opts.temperature = body.temperature;

    const resp = await puter.ai.chat(messages, opts);
    const text = extractAssistantText(resp);
    const usage = resp?.usage || {};
    const completion = {
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
        completion_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
        total_tokens: usage.total_tokens ?? ((usage.prompt_tokens ?? usage.input_tokens ?? 0) + (usage.completion_tokens ?? usage.output_tokens ?? 0))
      }
    };

    if (body.stream) {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const firstChunk = {
        id: completion.id,
        object: 'chat.completion.chunk',
        created: completion.created,
        model: requestedModel,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: text },
            finish_reason: null,
            native_finish_reason: null
          }
        ]
      };
      const finalChunk = {
        id: completion.id,
        object: 'chat.completion.chunk',
        created: completion.created,
        model: requestedModel,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
            native_finish_reason: 'stop'
          }
        ],
        usage: completion.usage
      };

      res.write(`data: ${JSON.stringify(firstChunk)}\n\n`);
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    res.json(completion);
  } catch (error) {
    console.error('bridge error:', error?.stack || error?.message || error);
    res.status(500).json({
      error: {
        message: error?.message || 'bridge_error',
        type: 'server_error',
        code: 'internal_server_error'
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`puter-cliproxy-bridge listening on http://127.0.0.1:${PORT}`);
  console.log(`auth=${!!process.env.PUTER_AUTH_TOKEN}`);
});
