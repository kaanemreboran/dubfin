import OpenAI from 'openai';
import fetch from 'node-fetch';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY;
const PDFCO_API_KEY  = process.env.PDFCO_API_KEY;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;

// Bugünün tarihini YYYY-MM formatında döndürür
function bugununkiAyKey() {
  const now = new Date();
  const yil = now.getFullYear();
  const ay  = String(now.getMonth() + 1).padStart(2, '0');
  return `${yil}-${ay}`;
}

// TÜRMOB sirküler listesini çek, bu ay yayınlananları filtrele
async function turMobSirkulerleriniCek() {
  const turMobUrl = `https://www.turmob.org.tr/Sirkuler`;
  const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(turMobUrl)}&render=true`;

  console.log(`TÜRMOB'dan çekiliyor: ${turMobUrl}`);
  const res  = await fetch(scraperUrl);
  const html = await res.text();

  // detailPdf linklerini çek
  const linkRegex = /href="(\/sirkuler\/detailPdf\/[^"]+)"/g;
  const linkler = [];
  let eslesme;

  while ((eslesme = linkRegex.exec(html)) !== null) {
    const tamUrl = `https://www.turmob.org.tr${eslesme[1]}`;
    if (!linkler.includes(tamUrl)) linkler.push(tamUrl);
  }

  console.log(`${linkler.length} sirküler linki bulundu`);
  return linkler;
}

// Supabase'de zaten var mı?
async function zatenVarMi(url) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sirkuler?sirkuler_no=eq.${encodeURIComponent(url)}&select=id`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  const data = await res.json();
  return Array.isArray(data) && data.length > 0;
}

// PDF.co ile sirküler sayfasından metin çıkar
async function pdfdenMetinCikar(sirkulerUrl) {
  console.log(`Metin çıkarılıyor: ${sirkulerUrl}`);

  // detailPdf URL'sini direkt PDF olarak gönder
  const pdfUrl = sirkulerUrl.replace('/sirkuler/detailPdf/', '/sirkuler/pdf/');

  const res = await fetch('https://api.pdf.co/v1/pdf/convert/to/text', {
    method: 'POST',
    headers: {
      'x-api-key': PDFCO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: sirkulerUrl, inline: true, async: false }),
  });

  const veri = await res.json();
  if (veri.error) throw new Error(`PDF.co hatası: ${veri.message}`);
  return veri.body || '';
}

// OpenAI embedding üret
async function embeddingUret(metin) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: metin.substring(0, 8000),
  });
  return res.data[0].embedding;
}

// Supabase REST API ile kaydet
async function supabaseKaydet(url, metin, embedding) {
  const bugun = new Date().toISOString().split('T')[0];

  const res = await fetch(`${SUPABASE_URL}/rest/v1/sirkuler`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      sirkuler_no: url,
      tarih:       bugun,
      metin:       metin,
      embedding:   embedding,
    }),
  });

  if (!res.ok) {
    const hata = await res.text();
    throw new Error(`Supabase kayıt hatası: ${hata}`);
  }

  console.log(`✅ Kaydedildi: ${url}`);
}

// Ana fonksiyon
async function main() {
  console.log('🚀 DubFin ingestion başladı:', new Date().toISOString());

  const sirkulerler = await turMobSirkulerleriniCek();

  if (sirkulerler.length === 0) {
    console.log('📭 Sirküler linki bulunamadı.');
    return;
  }

  let yeniSayisi = 0;

  for (const url of sirkulerler) {
    try {
      if (await zatenVarMi(url)) {
        console.log(`⏭️  Zaten mevcut: ${url}`);
        continue;
      }

      const metin = await pdfdenMetinCikar(url);
      if (!metin || metin.length < 50) {
        console.log(`⚠️  Metin çıkarılamadı: ${url}`);
        continue;
      }

      const embedding = await embeddingUret(metin);
      await supabaseKaydet(url, metin, embedding);
      yeniSayisi++;

      await new Promise(r => setTimeout(r, 2000));

    } catch (hata) {
      console.error(`❌ Hata (${url}):`, hata.message);
    }
  }

  console.log(`✅ Tamamlandı. ${yeniSayisi} yeni sirküler eklendi.`);
}

main().catch(console.error);
