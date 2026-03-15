import pdf from 'pdf-parse/lib/pdf-parse.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { fileBase64, mimeType } = req.body;
  if (!fileBase64) return res.status(400).json({ error: 'Missing file' });

  try {
    const buffer = Buffer.from(fileBase64, 'base64');

    if (mimeType === 'application/pdf') {
      const data = await pdf(buffer);
      return res.status(200).json({ text: data.text });
    }

    return res.status(400).json({ error: '暂不支持此文件格式，请粘贴文字内容' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
