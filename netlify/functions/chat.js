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
    const { soru } = JSON.parse(event.body);

    const embeddingRes = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: soru,
    });

    const embedding = embeddingRes.data[0].embedding;

    const { data: sirkulerler, error } = await supabase.rpc('sirkuler_ara', {
      sorgu_embedding: embedding,
      eslesme_sayisi: 5,
    });

    if (error) throw new Error(error.message);

    const baglam = sirkulerler
      .map(s => `Sirküler ${s.sirkuler_no} (${s.tarih}):\n${s.metin}`)
      .join('\n\n---\n\n');

    const cevap = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Sen DubFin'sin — Türkiye mali mevzuatı konusunda uzman AI asistanısın.

KURALLAR:
- Her cevapta sirküler numarasını ve tarihini belirt
- Bilgi yoksa "Bu konuda güncel bilgim yok" de, uydurma
- Sade Türkçe kullan
- Cevap sonunda kaynak belirt: (Kaynak: Sirküler No X, Tarih Y)

2026 TEMEL RAKAMLAR:
- Asgari ücret brüt: 33.030 TL, net: 28.075,50 TL
- SGK tavan: 297.270 TL, taban: 33.030 TL
- Binek araç kira sınırı: 46.000 TL/ay

BAĞLAM:
${baglam}`,
        },
        { role: 'user', content: soru },
      ],
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ cevap: cevap.choices[0].message.content }),
    };
  } catch (hata) = {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ hata: hata.message }),
    };
  }
};
