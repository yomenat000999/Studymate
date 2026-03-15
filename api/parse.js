export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { fileBase64, mimeType, fileName } = req.body;
  if (!fileBase64) return res.status(400).json({ error: 'Missing file' });

  const sizeBytes = Buffer.byteLength(fileBase64, 'base64');
  if (sizeBytes > 2 * 1024 * 1024) {
    return res.status(400).json({ error: `文件太大（${Math.round(sizeBytes/1024/1024)}MB），请手动复制文字内容粘贴` });
  }

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
        max_tokens: 3000,
        system: '你是一个文字提取工具。只输出文件中的原始文字内容，不要添加任何解释或额外内容。',
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } },
            { type: 'text', text: '提取全部文字内容。' }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(500).json({ error: err.error?.message || '解析失败' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    if (!text) return res.status(500).json({ error: '未能提取到文字' });
    return res.status(200).json({ text });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
