const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*' };

  try {
    const res = await fetch(
      'https://api.dify.ai/v1/datasets/850638b7-f5e0-426e-b7bd-37051d891146/documents?limit=100',
      {
        headers: {
          'Authorization': `Bearer ${process.env.DIFY_API_KEY}`,
        },
      }
    );

    const data = await res.json();
    const docs = data.data || [];
    const sonuclar = [];

    for (const doc of docs) {
      try {
        const metin = doc.name + ' ' + (doc.description || '');

        const embeddingRes = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: metin.slice(0, 8000),
        });

        const embedding = embeddingRes.data[0].embedding;

        const { error } = await supabase.from('sirkuler').upsert({
          id: doc.id,
          sirkuler_no: doc.name,
          tarih: doc.created_at || '',
          metin: metin.slice(0, 2000),
          embedding,
        });

        sonuclar.push({ id: doc.id, basarili: !error, hata: error?.message });
      } catch (e) {
        sonuclar.push({ id: doc.id, basarili: false, hata: e.message });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ toplam: docs.length, sonuclar }),
    };
  } catch (hata) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ hata: hata.message }),
    };
  }
};
