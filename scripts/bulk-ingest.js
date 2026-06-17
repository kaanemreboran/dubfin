import OpenAI from 'openai';
import fetch from 'node-fetch';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PDFCO_API_KEY    = process.env.PDFCO_API_KEY;
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_API_KEY   = process.env.GOOGLE_API_KEY;
const GOOGLE_SEARCH_CX = process.env.GOOGLE_SEARCH_CX;

async function tumSirkulerleriCek() {
  const sorgu = 'site:turmob.org.tr/sirkuler/detailPdf 2026';
  const linkler = [];

  for (let baslangic = 1; baslangic <= 91; baslangic += 10) {
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_SEARCH_CX}&q=${encodeURIComponent(sorgu)}&num=10&start=${baslangic}`;

    console.log(`Google sayfa çekiliyor: start=${baslangic}`);
    const res  = await fetch(url);
    const veri = await res.json();
    console.log('API yanıtı:', JSON.stringify(veri).substring(0, 500));

    if (!veri.items || veri.items.length === 0) {
      console.log('Daha fazla sonuç yok.');
      break;
    }

    for (const item of veri.items) {
      if (item.link.includes('/sirkuler/detailPdf/') && !linkler.includes(item.link)) {
        linkler.push(item.link);
      }
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`Toplam ${linkler.length} sirküler bulundu`);
  return linkler;
}

async function zatenVarMi(url) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sirkuler?sirkuler_no=eq.${encodeURIComponent(url)}&select=id`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  return Array.isArray(data) && data.length > 0;
}

async function pdfdenMetinCikar(sirkulerUrl) {
  const uuidRegex = /detailPdf\/([a-f0-9-]{36})/;
  const eslesme = sirkulerUrl.match(uuidRegex);
  if (!eslesme) throw new Error(`UUID çıkarılamadı: ${sirkulerUrl}`);

  const uuid   = eslesme[1];
  const pdfUrl = `https://www.turmob.org.tr/ekutuphane/Read/${uuid}`;
  console.log(`PDF okunuyor: ${pdfUrl}`);

  const res = await fetch('https://api.pdf.co/v1/pdf/convert/to/text', {
    method: 'POST',
    headers: { 'x-api-key': PDFCO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: pdfUrl, inline: true, async: false }),
  });

  const veri = await res.json();
  if (veri.error) throw new Error(`PDF.co hatası: ${veri.message}`);
  return veri.body || '';
}

async function embeddingUret(metin) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: metin.substring(0, 8000),
  });
  return res.data[0].embedding;
}

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
  console.log('🚀 Toplu yükleme başladı:', new Date().toISOString());

  const sirkulerler = await tumSirkulerleriCek();

  let yeniSayisi   = 0;
  let mevcutSayisi = 0;
  let hataSayisi   = 0;

  for (const url of sirkulerler) {
    try {
      if (await zatenVarMi(url)) {
        console.log(`⏭️  Zaten mevcut: ${url}`);
        mevcutSayisi++;
        continue;
      }

      const metin = await pdfdenMetinCikar(url);
      if (!metin || metin.length < 50) {
        console.log(`⚠️  Metin çıkarılamadı: ${url}`);
        hataSayisi++;
        continue;
      }

      const embedding = await embeddingUret(metin);
      await supabaseKaydet(url, metin, embedding);
      yeniSayisi++;

      await new Promise(r => setTimeout(r, 3000));

    } catch (hata) {
      console.error(`❌ Hata (${url}):`, hata.message);
      hataSayisi++;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n📊 Sonuç:`);
  console.log(`   ✅ Yeni eklenen: ${yeniSayisi}`);
  console.log(`   ⏭️  Zaten mevcut: ${mevcutSayisi}`);
  console.log(`   ❌ Hata: ${hataSayisi}`);
}

main().catch(console.error);
