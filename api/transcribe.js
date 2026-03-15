export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { audioBase64, mimeType } = req.body;
  if (!audioBase64) return res.status(400).json({ error: 'Missing audio data' });

  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
      body: audioBuffer,
    });
    const uploadData = await uploadRes.json();
    if (!uploadData.upload_url) throw new Error('上传失败');

    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        authorization: process.env.ASSEMBLYAI_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ audio_url: uploadData.upload_url }),
    });
    const transcriptData = await transcriptRes.json();
    const transcriptId = transcriptData.id;
    if (!transcriptId) throw new Error('转录任务创建失败');

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
      });
      const result = await pollRes.json();
      if (result.status === 'completed') {
        return res.status(200).json({ transcript: result.text });
      }
      if (result.status === 'error') throw new Error(result.error);
    }
    throw new Error('转录超时，请重试');

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
