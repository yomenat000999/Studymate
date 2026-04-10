import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Plan limits (in seconds)
const PLAN_LIMITS = {
  free: 60 * 60,        // 1 hour
  pro: 30 * 60 * 60,    // 30 hours
  max: 60 * 60 * 60,    // 60 hours
};

async function getUserAndUsage(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  // Get or create usage record
  let { data: usage } = await supabase
    .from('user_usage')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!usage) {
    const { data: newUsage } = await supabase
      .from('user_usage')
      .insert({ user_id: user.id, plan: 'free', transcribe_seconds_limit: PLAN_LIMITS.free })
      .select()
      .single();
    usage = newUsage;
  }

  // Reset usage if new billing period
  const now = new Date();
  const periodStart = new Date(usage.billing_period_start);
  if (now.getMonth() !== periodStart.getMonth() || now.getFullYear() !== periodStart.getFullYear()) {
    const { data: resetUsage } = await supabase
      .from('user_usage')
      .update({ transcribe_seconds_used: 0, billing_period_start: now.toISOString() })
      .eq('user_id', user.id)
      .select()
      .single();
    usage = resetUsage;
  }

  return { user, usage };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Auth check
  const session = await getUserAndUsage(req.headers.authorization);
  if (!session) return res.status(401).json({ error: '请先登录' });

  const { user, usage } = session;
  const { audioBase64, mimeType, transcriptId, audioDurationSeconds } = req.body;
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API Key 未配置' });

  try {
    // Polling for result
    if (transcriptId) {
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { authorization: apiKey },
      });
      const result = await pollRes.json();

      if (result.status === 'completed' && result.text) {
        // Deduct usage based on actual audio duration
        const durationSeconds = Math.ceil((result.audio_duration || audioDurationSeconds || 0));
        const newUsed = usage.transcribe_seconds_used + durationSeconds;
        await supabase
          .from('user_usage')
          .update({ transcribe_seconds_used: newUsed, updated_at: new Date().toISOString() })
          .eq('user_id', user.id);

        // Translate with Claude Haiku
        const claudeKey = process.env.ANTHROPIC_API_KEY;
        let translation = '';
        let bilingual = '';
        if (claudeKey) {
          try {
            const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'x-api-key': claudeKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model: 'claude-haiku-4-5',
                max_tokens: 4096,
                system: '你是专业翻译助手，专门翻译学术英文内容。将英文转录文字翻译成流畅的中文，保留专业术语（括号内附英文原文），例如：机会成本（opportunity cost）。只输出翻译结果，不要解释。',
                messages: [{ role: 'user', content: result.text }],
              }),
            });
            const claudeData = await claudeRes.json();
            if (claudeData.content?.[0]?.text) {
              translation = claudeData.content[0].text;
              bilingual = `【英文原文】\n${result.text}\n\n【中文翻译】\n${translation}`;
            }
          } catch (translateErr) {
            console.error('Translation error:', translateErr.message);
          }
        }
        return res.status(200).json({
          status: 'completed',
          transcript: result.text,
          translation,
          bilingual: bilingual || result.text,
        });
      }

      return res.status(200).json({ status: result.status, transcript: result.text, error: result.error });
    }

    // New transcription request
    if (!audioBase64) return res.status(400).json({ error: 'Missing audio data' });

    // Check usage limit before starting
    const limit = PLAN_LIMITS[usage.plan] || PLAN_LIMITS.free;
    if (usage.transcribe_seconds_used >= limit) {
      const limitHours = Math.floor(limit / 3600);
      return res.status(403).json({
        error: `本月转写额度已用完（${limitHours}小时）。升级到更高套餐可获得更多额度。`,
        limitReached: true,
        plan: usage.plan,
      });
    }

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { authorization: apiKey },
      body: audioBuffer,
    });
    const uploadData = await uploadRes.json();
    if (!uploadData.upload_url) return res.status(500).json({ error: '上传失败: ' + JSON.stringify(uploadData) });

    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ audio_url: uploadData.upload_url, speech_models: ['universal-2'] }),
    });
    const transcriptData = await transcriptRes.json();
    if (!transcriptData.id) return res.status(500).json({ error: '转录创建失败: ' + JSON.stringify(transcriptData) });

    // Return remaining quota info
    const remainingSeconds = Math.max(0, limit - usage.transcribe_seconds_used);
    return res.status(200).json({
      status: 'processing',
      transcriptId: transcriptData.id,
      usage: {
        used: usage.transcribe_seconds_used,
        limit,
        remainingSeconds,
        plan: usage.plan,
      },
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
