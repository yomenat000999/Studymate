import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { fileBase64, mimeType, fileName } = req.body;
  if (!fileBase64) return res.status(400).json({ error: 'Missing file' });

  const sizeBytes = Buffer.byteLength(fileBase64, 'base64');
  const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);

  // Size limit: 20MB (much more generous now)
  if (sizeBytes > 20 * 1024 * 1024) {
    return res.status(400).json({ error: `文件太大（${sizeMB}MB），请上传 20MB 以内的 PDF` });
  }

  try {
    const buffer = Buffer.from(fileBase64, 'base64');

    // Try local PDF text extraction first (fast, free, accurate)
    let text = '';
    try {
      const data = await pdfParse(buffer, { max: 0 });
      text = data.text || '';
      // Clean up: remove excessive whitespace/newlines
      text = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
    } catch (parseErr) {
      console.error('pdf-parse error:', parseErr.message);
    }

    // If extracted text is meaningful (> 100 chars), return it directly
    if (text && text.length > 100) {
      return res.status(200).json({ text, method: 'local' });
    }

    // Fallback: scanned PDF or image-based PDF — use AI (limit to 5MB for cost)
    if (sizeBytes > 5 * 1024 * 1024) {
      return res.status(400).json({
        error: `该 PDF 似乎是扫描件（图片格式），文件大小 ${sizeMB}MB 超过 AI 解析限制（5MB）。建议将 PDF 转为文字版本后再上传，或直接粘贴文字内容。`
      });
    }

    // AI fallback for scanned PDFs under 5MB
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
        system: '你是文字提取工具。只输出文件中的原始文字内容，保持原有段落结构，不要添加解释。',
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } },
            { type: 'text', text: '提取全部文字内容，保持段落结构。' }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(500).json({ error: '扫描件解析失败：' + (err.error?.message || '未知错误') });
    }

    const aiData = await response.json();
    const aiText = aiData.content?.[0]?.text || '';
    if (!aiText) return res.status(500).json({ error: '未能提取到文字，请尝试手动粘贴内容' });

    return res.status(200).json({ text: aiText, method: 'ai' });

  } catch (err) {
    return res.status(500).json({ error: '解析出错：' + err.message });
  }
}
