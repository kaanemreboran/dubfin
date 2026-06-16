const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' },
      body: '',
    };
  }

  try {
    const body = JSON.parse(event.body);
    const sirkuler_no = body.sirkuler_no || 'bilinmiyor';
    const tarih = body.tarih || '';
    const metin = body.metin || '';

    const embeddingRes = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: metin.slice(0, 8000),
      dimensions: 3072,
    });

    const embedding = embeddingRes.data[0].embedding;
    const index = pinecone.index('dubfin');

    await index.upsert([{
      id: sirkuler_no.replace(/[^a-zA-Z0-9-_]/g, '_'),
      values: embedding,
      metadata: {
        metin: metin.slice(0, 1000),
        sirkuler_no,
        tarih,
      },
    }]);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ basarili: true, id: sirkuler_no }),
    };
  } catch (hata) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ hata: hata.message }),
    };
  }
};
