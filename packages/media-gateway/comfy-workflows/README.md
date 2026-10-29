# Yerel ComfyUI workflow'ları

Router, yerel GPU'yu bedava sağlayıcı olarak görür ve kalite eşiğini geçiyorsa önce onu seçer (`docs/PROJE_PLANI.md` §18).

## Workflow ekleme

1. ComfyUI'da workflow'u kur ve çalıştığını doğrula.
2. Değişecek alanlara yer tutucuları yaz:

   | Yer tutucu | Tip | Anlamı |
   |---|---|---|
   | `{{prompt}}` | metin | Pozitif prompt |
   | `{{negative}}` | metin | Negatif prompt |
   | `{{seed}}` | sayı | Tohum (verilmezse rastgele) |
   | `{{width}}`, `{{height}}` | sayı | En-boy oranından türetilir (16:9 → 1280×720) |
   | `{{frames}}` | sayı | Video kare sayısı (8k+1 biçiminde) |
   | `{{fps}}` | sayı | manifest'teki `fps` |
   | `{{image_1}}`, `{{image_2}}`… | metin | Referans görseller; otomatik yüklenip `LoadImage` adıyla verilir |

   Alanın değeri sadece yer tutucuysa (örn. `"seed": "{{seed}}"`) sayıya çevrilir.
3. **Workflow → Export (API)** ile bu klasöre kaydet. Dosya adı `manifest.json`'daki `file` ile aynı olmalı.
4. `pnpm ys providers` ile adapter'ın göründüğünü kontrol et.

Workflow dosyası olmayan girdiler atlanır ve `providers` çıktısında nedeniyle listelenir.

## RTX 5080 (16 GB) için notlar

- FLUX.2 dev ve Qwen-Image: FP8 veya GGUF Q5/Q6 sürümleri.
- LTX-2.3: FP8 sürümü ve 128 GB RAM ile offload.
- Wan 2.2 14B: GGUF Q4–Q5 ve block swap. 5B TI2V doğrudan sığar.
- Çıktı düğümü olarak `SaveImage` veya `VHS_VideoCombine` (`save_output: true`) kullan.
