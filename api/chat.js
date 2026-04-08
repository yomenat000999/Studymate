export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { messages, system, max_tokens, stream } = req.body;
  if (!messages) return res.status(400).json({ error: 'Missing messages' });

  try {
    if (stream) {
      // SSE streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: max_tokens || 4000,
          system: system || '',
          messages,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        res.write(`data: ${JSON.stringify({ error: errData.error?.message || '请求失败' })}\n\n`);
        return res.end();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            res.write(line + '\n\n');
          }
        }
      }

      res.write('data: [DONE]\n\n');
      return res.end();

    } else {
      // Standard non-streaming response
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: max_tokens || 4000,
          system: system || '',
          messages,
        }),
      });

      const data = await response.json();
      if (!response.ok) return res.status(response.status).json({ error: data.error?.message || '请求失败' });
      return res.status(200).json(data);
    }

  } catch (err) {
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
    try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); } catch(e) {}
  }
}
