const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { sirkuler_no, tarih, metin } = JSON.parse(event.body);

    const embeddingRes = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: metin.slice(0, 8000),
    });

    const embedding = embeddingRes.data[0].embedding;

    const { error } = await supabase
      .from('sirkuler')
      .upsert({
        id: sirkuler_no,
        sirkuler_no,
        tarih,
        metin: metin.slice(0, 2000),
        embedding,
      });

    if (error) throw new Error(error.message);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ basarili: true, id: sirkuler_no }),
    };
  } catch (hata) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ hata: hata.message }),
    };
  }
};
