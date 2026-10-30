# URO PRINT LAB

公式リポジトリ：<https://github.com/shimadauro-cell/URO-PRINT-LAB>

URO PRINT LABは、GPTなどで生成した画像を印刷素材として扱いやすくする、
Windows向けのローカル画像アップスケーラーです。画像は利用者のPC内で処理し、
外部APIへ送信しません。

このリポジトリは、製品の仕組み・安全性・更新内容を確認できるように公開する
**ソース閲覧用リポジトリ**です。URO PRINT LAB独自部分はオープンソースでは
ありません。実行・改変・再配布・商用利用は許可していません。詳しくは
[LICENSE.md](LICENSE.md)をご確認ください。第三者OSSの権利は、それぞれの
ライセンスに従い、独自ライセンスによって制限されません。

## 主な機能

- 元画像基準の×2・×3・×4アップスケール
- 写真／汎用とイラスト向けのReal-ESRGANモデル
- AIを使わないLanczos通常補間
- 元画像と拡大後の100%比較
- A5・B5・A4・A3、縦横、3mm塗り足しの画素数確認
- 300／350／600ppiの解像度情報を埋め込んだsRGB PNG保存
- PNG・JPEG・WebP入力、透過PNG出力

## 動作環境の目安

| 項目 | 通常補間 | AI補完 |
| --- | --- | --- |
| OS | Windows 10／11 x64 | 同左 |
| RAM | 8GBから、16GB以上推奨 | 16GB以上推奨 |
| GPU | 専用GPU不要 | Vulkan対応GPU、VRAM 4GB以上推奨 |
| 画面 | 1280×800以上推奨 | 同左 |

Core i5-9300H／GeForce GTX 1650 4GB／RAM 8GBで旧版が動作したとの
ユーザー報告があります。画像サイズ、ドライバー、所要時間などは未記録で、
動作保証ではありません。

AI補完にはMicrosoft Visual C++ v14 x64ランタイムが必要です。
[Microsoft公式案内](https://learn.microsoft.com/ja-jp/cpp/windows/latest-supported-vc-redist)
から導入してください。

## Windows版の入手

配布版はこのリポジトリの **Releases** に掲載します。ZIPを「すべて展開」し、
フォルダー内の `URO Print Lab.exe` を起動してください。EXE単体では動作しません。

GitHubの緑色の「Code」ボタンから取得するZIPは製品版ではありません。

## ソース構成

```text
app/
  desktop.cjs       Electron起動処理
  server.mjs        ローカルHTTPサーバーと画像処理
  index.html        画面構造
  app.js            画面操作
  style.css         画面デザイン
tests/
  verify.mjs        画像処理の検証
```

公開ソースにはAI実行ファイル、学習済みモデル、Electron本体、Node依存パッケージ、
Windows配布ZIPを含めません。配布版に含まれるOSSの表示と対応ソースは、各Releaseの
添付物として提供します。

## プライバシーと制限

- サーバーは`127.0.0.1`だけで待ち受けます。
- 画像は外部へ送信しません。
- 最新結果はメモリーに保持し、次の処理または終了時に破棄します。
- AIは文字、顔、模様などを変える場合があります。必ず元画像と比較してください。
- CMYK変換と入稿用PDF作成は対象外です。

## ライセンス

- URO PRINT LAB独自部分：閲覧のみ。[LICENSE.md](LICENSE.md)
- Real-ESRGAN等の第三者部品：[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)
- 黒瀬真理およびアイコン：URO PRINT LAB独自素材。転載・抽出・再利用禁止

公開前に[公開チェックリスト](docs/PUBLISHING-CHECKLIST.md)を完了してください。

## 問い合わせ

販売者・著作権者：島騨うろ  
問い合わせ先：[X @shimadauro](https://x.com/shimadauro)

