export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { audioBase64, mimeType } = req.body;
  if (!audioBase64) return res.status(400).json({ error: 'Missing audio data' });

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API Key 未配置' });

  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { authorization: apiKey },
      body: audioBuffer,
    });
    const uploadData = await uploadRes.json();
    if (!uploadData.upload_url) {
      return res.status(500).json({ error: '上传失败: ' + JSON.stringify(uploadData) });
    }

    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ audio_url: uploadData.upload_url }),
    });
    const transcriptData = await transcriptRes.json();
    if (!transcriptData.id) {
      return res.status(500).json({ error: '转录创建失败: ' + JSON.stringify(transcriptData) });
    }

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptData.id}`, {
        headers: { authorization: apiKey },
      });
      const result = await pollRes.json();
      if (result.status === 'completed') return res.status(200).json({ transcript: result.text });
      if (result.status === 'error') throw new Error(result.error);
    }
    throw new Error('转录超时，请重试');

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
