import OpenAI from 'openai';
import fetch from 'node-fetch';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PDFCO_API_KEY = process.env.PDFCO_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_API_KEY   = process.env.GOOGLE_API_KEY;
const GOOGLE_SEARCH_CX = process.env.GOOGLE_SEARCH_CX;

// Google Custom Search ile bugün yayınlanan sirkülerleri bul
async function turMobSirkulerleriniCek() {
  // Bugünün tarihini GG/AA/YYYY formatında al
  const bugun = new Date();
  const gun   = String(bugun.getDate()).padStart(2, '0');
  const ay    = String(bugun.getMonth() + 1).padStart(2, '0');
  const yil   = bugun.getFullYear();
  const tarihStr = `${gun}.${ay}.${yil}`;

  const sorgu = `site:turmob.org.tr/sirkuler/detailPdf ${tarihStr}`;
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_SEARCH_CX}&q=${encodeURIComponent(sorgu)}&num=10`;

  console.log(`Google araması: ${sorgu}`);
  const res  = await fetch(url);
  const veri = await res.json();

  if (!veri.items || veri.items.length === 0) {
    console.log('Google sonucu bulunamadı.');
    return [];
  }

  const linkler = veri.items
    .map(item => item.link)
    .filter(link => link.includes('/sirkuler/detailPdf/'));

  console.log(`${linkler.length} yeni sirküler bulundu`);
  return linkler;
}

// Supabase'de var mı?
async function zatenVarMi(url) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sirkuler?sirkuler_no=eq.${encodeURIComponent(url)}&select=id`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  return Array.isArray(data) && data.length > 0;
}

// PDF.co ile metin çıkar
async function pdfdenMetinCikar(sirkulerUrl) {
  console.log(`Metin çıkarılıyor: ${sirkulerUrl}`);
  const res = await fetch('https://api.pdf.co/v1/pdf/convert/to/text', {
    method: 'POST',
    headers: { 'x-api-key': PDFCO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: sirkulerUrl, inline: true, async: false }),
  });
  const veri = await res.json();
  if (veri.error) throw new Error(`PDF.co hatası: ${veri.message}`);
  return veri.body || '';
}

// OpenAI embedding
async function embeddingUret(metin) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: metin.substring(0, 8000),
  });
  return res.data[0].embedding;
}

// Supabase'e kaydet
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
    body: JSON.stringify({ sirkuler_no: url, tarih: bugun, metin, embedding }),
  });
  if (!res.ok) {
    const hata = await res.text();
    throw new Error(`Supabase hatası: ${hata}`);
  }
  console.log(`✅ Kaydedildi: ${url}`);
}

async function main() {
  console.log('🚀 DubFin ingestion başladı:', new Date().toISOString());

  const sirkulerler = await turMobSirkulerleriniCek();
  if (sirkulerler.length === 0) {
    console.log('📭 Bugün yeni sirküler yok.');
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
