const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  try {
    const { soru } = JSON.parse(event.body);

    const embedding = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: soru,
    });

    const index = pinecone.index('dubfin');
    const sonuclar = await index.query({
      vector: embedding.data[0].embedding,
      topK: 5,
      includeMetadata: true,
    });

    const baglamlar = sonuclar.matches
      .map(m => m.metadata?.metin || '')
      .join('\n\n---\n\n');

    const cevap = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Sen DubFin'sin — Türkiye mali mevzuatı konusunda uzman bir AI asistanısın.

GÖREV: Kullanıcının muhasebe ve vergi sorularını yanıtla.

KURALLAR:
- Her cevapta tarihi mutlaka belirt
- Kaynak sirküler numarasını söyle
- Bilgi yoksa "Bu konuda güncel bilgim yok" de, uydurma
- Sade Türkçe kullan

BAĞLAM:
${baglamlar}

2026 TEMEL RAKAMLAR:
- Asgari ücret brüt: 33.030 TL, net: 28.075,50 TL
- SGK tavan: 297.270 TL, taban: 33.030 TL
- Binek araç kira sınırı: 46.000 TL/ay
- Amortisman tavanı: 1.380.000 TL (ÖTV+KDV hariç)`,
        },
        { role: 'user', content: soru },
      ],
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ cevap: cevap.choices[0].message.content }),
    };
  } catch (hata) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ hata: hata.message }),
    };
  }
};
