export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { audioBase64, mimeType } = req.body;

  if (!audioBase64) {
    return res.status(400).json({ error: 'Missing audio data' });
  }

  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const blob = new Blob([audioBuffer], { type: mimeType || 'audio/webm' });

    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');
    formData.append('language_code', 'en');

    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
      body: audioBuffer,
    });

    const uploadData = await uploadRes.json();

    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        authorization: process.env.ASSEMBLYAI_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: uploadData.upload_url,
        language_code: 'en',
      }),
    });

    const transcriptData = await transcriptRes.json();
    const transcriptId = transcriptData.id;

    let result;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
      });
      result = await pollRes.json();
      if (result.status === 'completed') break;
      if (result.status === 'error') throw new Error(result.error);
    }

    return res.status(200).json({ transcript: result.text });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
