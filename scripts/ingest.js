import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import fetch from 'node-fetch';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false },
    realtime: { enabled: false },
  }
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY;
const PDFCO_API_KEY  = process.env.PDFCO_API_KEY;

const AY_IDLERI = {
  '2026-06': '302b3a2e-b95b-49c5-81ab-a5c5ac57a9ed',
};

function bugununkiAyKey() {
  const now = new Date();
  const yil = now.getFullYear();
  const ay  = String(now.getMonth() + 1).padStart(2, '0');
  return `${yil}-${ay}`;
}

async function turMobSirkulerleriniCek(ayId) {
  const turMobUrl = `https://www.turmob.org.tr/turmob/sirkuler?categoryId=${ayId}`;
  const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(turMobUrl)}`;

  console.log(`TÜRMOB'dan çekiliyor: ${turMobUrl}`);
  
  const res  = await fetch(scraperUrl);
  const html = await res.text();

  const pdfLinkRegex = /href="(\/.*?\.pdf)"/g;
  const linkler = [];
  let eslesme;
  
  while ((eslesme = pdfLinkRegex.exec(html)) !== null) {
    const tamUrl = `https://www.turmob.org.tr${eslesme[1]}`;
    if (!linkler.includes(tamUrl)) {
      linkler.push(tamUrl);
    }
  }

  console.log(`${linkler.length} PDF linki bulundu`);
  return linkler;
}

async function zatenVarMi(pdfUrl) {
  const { data } = await supabase
    .from('sirkuler')
    .select('id')
    .eq('sirkuler_no', pdfUrl)
    .single();
  
  return !!data;
}

async function pdfdenMetinCikar(pdfUrl) {
  console.log(`PDF metin çıkarılıyor: ${pdfUrl}`);
  
  const res = await fetch('https://api.pdf.co/v1/pdf/convert/to/text', {
    method: 'POST',
    headers: {
      'x-api-key': PDFCO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: pdfUrl,
      inline: true,
      async: false,
    }),
  });

  const veri = await res.json();
  
  if (veri.error) {
    throw new Error(`PDF.co hatası: ${veri.message}`);
  }

  return veri.body || '';
}

async function embeddingUret(metin) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: metin.substring(0, 8000),
  });
  
  return res.data[0].embedding;
}

async function supabaseKaydet(pdfUrl, metin, embedding) {
  const tarihRegex = /(\d{4})[-_](\d{2})/;
  const eslesti = pdfUrl.match(tarihRegex);
  const tarih = eslesti
    ? `${eslesti[1]}-${eslesti[2]}-01`
    : new Date().toISOString().split('T')[0];

  const { error } = await supabase.from('sirkuler').insert({
    sirkuler_no: pdfUrl,
    tarih:       tarih,
    metin:       metin,
    embedding:   embedding,
  });

  if (error) throw new Error(`Supabase kayıt hatası: ${error.message}`);
  
  console.log(`✅ Kaydedildi: ${pdfUrl}`);
}

async function main() {
  console.log('🚀 DubFin ingestion başladı:', new Date().toISOString());

  const ayKey = bugununkiAyKey();
  const ayId  = AY_IDLERI[ayKey];

  if (!ayId) {
    console.log(`⚠️  ${ayKey} için ay ID'si tanımlanmamış. Çıkılıyor.`);
    return;
  }

  const pdfLinkleri = await turMobSirkulerleriniCek(ayId);

  if (pdfLinkleri.length === 0) {
    console.log('📭 Yeni sirküler bulunamadı.');
    return;
  }

  let yeniSayisi = 0;
  
  for (const pdfUrl of pdfLinkleri) {
    try {
      if (await zatenVarMi(pdfUrl)) {
        console.log(`⏭️  Zaten mevcut: ${pdfUrl}`);
        continue;
      }

      const metin = await pdfdenMetinCikar(pdfUrl);
      if (!metin || metin.length < 50) {
        console.log(`⚠️  Metin çıkarılamadı: ${pdfUrl}`);
        continue;
      }

      const embedding = await embeddingUret(metin);
      await supabaseKaydet(pdfUrl, metin, embedding);
      yeniSayisi++;

      await new Promise(r => setTimeout(r, 2000));

    } catch (hata) {
      console.error(`❌ Hata (${pdfUrl}):`, hata.message);
    }
  }

  console.log(`✅ Tamamlandı. ${yeniSayisi} yeni sirküler eklendi.`);
}

main().catch(console.error);
