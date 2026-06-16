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
    const { metin, sirkuler_no, tarih } = JSON.parse(event.body);

    const embeddingRes = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: metin,
      dimensions: 3072,
    });

    const embedding = embeddingRes.data[0].embedding;

    const index = pinecone.index('dubfin');
    await index.upsert([
      {
        id: sirkuler_no,
        values: embedding,
        metadata: { metin, sirkuler_no, tarih },
      },
    ]);

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
