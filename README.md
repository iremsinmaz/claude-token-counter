# Claude Token Sayacı

claude.ai'de açık sohbetin kaç token tuttuğunu, sistem promptunun tahmini yükünü ve hesabının kullanım limitlerini sağ alt köşede küçük bir rozet olarak gösteren tarayıcı eklentisi. Chrome ve Safari'de çalışır.

```
Sohbet: ~12.4k token
Oturum limiti      %34
Haftalık limit     %12
Taban tahmin    94.6k token
```

Rozete tıklayınca ayrıntılar açılır.

## Hangi sayı ne kadar güvenilir?

| Satır | Kaynak | Güvenilirlik |
|---|---|---|
| **Sohbet** | Mesajlar, ekler; karakter sayısından hesaplanır | Yaklaşık. Thinking tokenları claude.ai tarafından gösterilmez, dahil değil. |
| **Oturum / Haftalık limit** | claude.ai'nin kendi `/usage` yanıtı | Sunucunun değeri, tahmin değil. |
| **Taban tahmin** | Sistem promptunun açık özelliklere ait bölümleri, `count_tokens` ile önceden sayılmış | Bölümler kesin sayıldı; claude.ai'nin birebir bu promptu kullandığı ve bölüm-özellik eşlemesi varsayımdır. |

Taban tahmin sohbet sayısına eklenmez, ikisi ayrı durur. Bağlayıcı araçları (Gmail, Takvim, Drive, Docs) kimin hesabında neyin bağlı olduğu bilinemediği için tabana eklenmez, ayrıntılarda "bağlıysa" diye ayrıca gösterilir.

## Eklenti neye erişir?

- Yalnızca `https://claude.ai/*` üzerinde çalışır. Başka sitelere, sekmelere, çerezlere ya da tarayıcı geçmişine özel izin istemez.
- Yaptığı tüm istekler claude.ai'ye gider (açık sohbet, hesap ayarları, kullanım limitleri). Hiçbir veriyi başka bir yere göndermez, hiçbir şey saklamaz.
- Kodun tamamı [`extension/content.js`](extension/content.js).

Safari kurulumda "web sayfalarını okuyabilir, tarama geçmişini görebilir" gibi bir uyarı gösterir. Bu, sayfa içeriği okuyan her eklenti için çıkan standart metindir; izin yalnızca claude.ai için verilir.

> claude.ai'nin belgelenmemiş iç isteklerini kullanır. claude.ai değiştiğinde eklenti bozulabilir; sohbet verisi okunamazsa sayfadaki metne geri döner.

## Kurulum

### Chrome (ve Chromium tabanlı tarayıcılar)

1. Repoyu indir ya da klonla.
2. `chrome://extensions` → sağ üstten **Geliştirici modu**'nu aç.
3. **Paketlenmemiş öğe yükle** → `extension` klasörünü seç.

### Safari (macOS, Xcode gerekir)

1. Xcode ile derle:
   ```sh
   cd "safari/Claude Token Sayaci"
   xcodebuild -project "Claude Token Sayaci.xcodeproj" -scheme "Claude Token Sayaci" \
     -configuration Release -derivedDataPath ../../build \
     CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" build
   ```
2. Safari → Ayarlar → Gelişmiş → **Web geliştiricileri için özellikleri göster**.
3. Geliştir → Geliştirici Ayarları… → **İmzasız eklentilere izin ver**. (Safari her yeniden başladığında tekrar açılması gerekir.)
4. Uygulamayı bir kez aç:
   ```sh
   open "build/Build/Products/Release/Claude Token Sayaci.app"
   ```
5. Safari → Ayarlar → Eklentiler → **Claude Token Sayacı**'nı etkinleştir ve claude.ai için izin ver.

## Taban tahmini güncellemek

Anthropic sistem promptunu model ve sürüme göre günceller. Taban değer eklenti çalışırken hesaplanmaz; bir kez sayılıp [`extension/baseline.js`](extension/baseline.js) içine sabit yazılır.

1. Güncel sistem promptunu `reference/<model>.md` olarak kaydet. Dosya adı model kimliğini belirler: `claude-opus-5.5.md` → `claude-opus-5-5`. Mevcut taban [`reference/claude-opus-5.5.md`](reference/claude-opus-5.5.md) ile sayıldı; yeni eklenen prompt dosyaları `.gitignore` ile varsayılan olarak repoya girmez.
2. Gerekirse [`reference/bolumler.json`](reference/bolumler.json) içindeki kuralları güncelle. Hangi başlığın hangi özellik bayrağına ait olduğu burada tanımlı.
3. Sayımı çalıştır (`count_tokens` ücretsizdir, ama prompt metni Anthropic API'sine gönderilir):
   ```sh
   ANTHROPIC_API_KEY=... node scripts/taban-hesapla.mjs
   ```
4. Chrome'da eklentiyi yeniden yükle; Safari'de yeniden derle.

## Teşekkür

Özellik bayraklarının adları ve `/usage` isteği [lugia19/Claude-Usage-Extension](https://github.com/lugia19/Claude-Usage-Extension)'dan öğrenildi. Oradan kod alınmadı; daha kapsamlı bir kullanım takibi arıyorsan o eklentiye göz at.

## Lisans

[MIT](LICENSE)
