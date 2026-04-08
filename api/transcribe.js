export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { audioBase64, mimeType, transcriptId } = req.body;
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API Key 未配置' });

  try {
    // If transcriptId provided, poll for result
    if (transcriptId) {
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { authorization: apiKey },
      });
      const result = await pollRes.json();

      if (result.status === 'completed' && result.text) {
        // Auto-translate the transcript to Chinese using Claude Haiku
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
            if (claudeData.content && claudeData.content[0] && claudeData.content[0].text) {
              translation = claudeData.content[0].text;
              bilingual = `【英文原文】\n${result.text}\n\n【中文翻译】\n${translation}`;
            }
          } catch (translateErr) {
            // Translation failed, return transcript only
            console.error('Translation error:', translateErr.message);
          }
        }
        return res.status(200).json({
          status: 'completed',
          transcript: result.text,
          translation: translation,
          bilingual: bilingual || result.text,
        });
      }

      return res.status(200).json({ status: result.status, transcript: result.text, error: result.error });
    }

    // Otherwise, upload and create transcript job
    if (!audioBase64) return res.status(400).json({ error: 'Missing audio data' });
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

    return res.status(200).json({ status: 'processing', transcriptId: transcriptData.id });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
