export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { fileBase64, mimeType } = req.body;
  if (!fileBase64) return res.status(400).json({ error: 'Missing file' });

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
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: mimeType || 'application/pdf', data: fileBase64 } },
            { type: 'text', text: '请提取这个文件中的所有文字内容，保持原有结构，不要添加任何解释。' }
          ]
        }]
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || '解析失败');
    return res.status(200).json({ text: data.content[0].text });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
