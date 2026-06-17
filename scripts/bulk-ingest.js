name: TÜRMOB Sirküler Otomatik İngestion

on:
  schedule:
    # Her gün 04:00 UTC = 07:00 TR saati
    - cron: '0 4 * * *'
  workflow_dispatch:
    inputs:
      mod:
        description: 'Çalışma modu'
        required: true
        default: 'gunluk'
        type: choice
        options:
          - gunluk
          - toplu

jobs:
  ingest:
    runs-on: ubuntu-latest

    steps:
      - name: Repo'yu çek
        uses: actions/checkout@v4

      - name: Node.js kur
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Bağımlılıkları yükle
        run: |
          cd scripts
          npm install

      - name: Günlük sirküler çek
        if: ${{ github.event.inputs.mod == 'gunluk' || github.event_name == 'schedule' }}
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          PDFCO_API_KEY: ${{ secrets.PDFCO_API_KEY }}
          GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
          GOOGLE_SEARCH_CX: ${{ secrets.GOOGLE_SEARCH_CX }}
        run: |
          cd scripts
          node ingest.js

      - name: Toplu yükleme (2026 tamamı)
        if: ${{ github.event.inputs.mod == 'toplu' }}
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          PDFCO_API_KEY: ${{ secrets.PDFCO_API_KEY }}
          GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
          GOOGLE_SEARCH_CX: ${{ secrets.GOOGLE_SEARCH_CX }}
        run: |
          cd scripts
          node bulk-ingest.js
