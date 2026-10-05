# Personal Knowledge DB Bridge

SmartNews / YouTube から共有した情報を、既存ラベルを使って Google Sheets の **Personal Knowledge DB** に保存するためのスマホ向けブリッジです。

## 目的
- SmartNews と YouTube を同じラベル体系で保存
- SmartNews は元記事 URL を優先し、SmartNews URL は証跡として保持
- ラベルは手動選択を正本にする
- Google Sheets を正本 DB にする
- 後から NotebookLM / ChatGPT の分析へ接続する

## 現在の段階
MVP 設計とコード雛形。まだ本番デプロイ前です。

## データ方針
- `url`: 元記事・元動画 URL
- `smartnews_url`: SmartNews 側 URL
- `url_resolution`: `confirmed | probable | unresolved | direct`
- 不確実な元記事 URL は勝手に採用しない
- 手動ラベルを AI が上書きしない
