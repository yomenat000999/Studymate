import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getUser(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Auth check
  const user = await getUser(req.headers.authorization);
  if (!user) return res.status(401).json({ error: '请先登录' });

  // Check chat usage limits
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  let { data: usage } = await supabase
    .from('user_usage')
    .select('plan, chat_monthly_used, chat_monthly_limit, billing_period_start')
    .eq('user_id', user.id)
    .single();

  if (!usage) {
    // Create usage record if missing
    const { data: newUsage } = await supabase
      .from('user_usage')
      .insert({ user_id: user.id, plan: 'free', transcribe_seconds_limit: 3600, chat_monthly_limit: 150, chat_monthly_used: 0 })
      .select().single();
    usage = newUsage;
  }

  // Reset monthly usage if new billing period
  const periodStart = new Date(usage.billing_period_start);
  if (now.getMonth() !== periodStart.getMonth() || now.getFullYear() !== periodStart.getFullYear()) {
    await supabase.from('user_usage').update({
      chat_monthly_used: 0,
      billing_period_start: now.toISOString(),
    }).eq('user_id', user.id);
    usage.chat_monthly_used = 0;
  }

  // Plan limits
  const CHAT_LIMITS = { free: 90, pro: 200, max: 400 }; // free=3/day*30days
  const chatLimit = CHAT_LIMITS[usage.plan] || 90;

  if ((usage.chat_monthly_used || 0) >= chatLimit) {
    return res.status(403).json({
      error: `本月 AI 问答额度已用完（${chatLimit}次）。升级套餐可获得更多额度。`,
      limitReached: true,
      plan: usage.plan,
    });
  }

  // Increment usage
  await supabase.from('user_usage')
    .update({ chat_monthly_used: (usage.chat_monthly_used || 0) + 1, updated_at: now.toISOString() })
    .eq('user_id', user.id);

  const { messages, system, max_tokens, stream } = req.body;
  if (!messages) return res.status(400).json({ error: 'Missing messages' });

  // Streaming mode
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
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
        const err = await response.json();
        res.write(`data: ${JSON.stringify({ error: err.error?.message || '请求失败' })}\n\n`);
        res.end();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
            }
          } catch (e) {}
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
    return;
  }

  // Non-streaming mode
  try {
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
  } catch (err) {
    return res.status(500).json({ error: '网络出错，请检查网络连接后重试' });
  }
}
