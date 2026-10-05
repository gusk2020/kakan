# Deployment (MVP)

## 目的
Android から共有した記事・動画を、ラベル選択後に Personal Knowledge DB へ保存する。

## 現状の制約
Google Apps Script の Web アプリ単体では Android の共有先として直接表示される PWA share target を完全には満たさない場合がある。

そのため MVP は二段階:
1. Apps Script Web アプリで保存・ラベル選択・URL解決を動作確認
2. 安定後、HTTPS ホスティングした薄い PWA を前段に追加し Android 共有先へ登録

## Apps Script 導入
1. Personal Knowledge DB の Google Sheets を開く
2. 拡張機能 → Apps Script
3. `Code.gs` と `index.html` を配置
4. デプロイ → 新しいデプロイ → ウェブアプリ
5. 実行するユーザー: 自分
6. アクセスできるユーザー: 自分
7. 発行 URL で動作確認

## URL 解決方針
SmartNews URL は削除せず `smartnews_url` に保持。
SmartNews HTML から外部 URL 候補を抽出し、元記事側タイトルと共有タイトルが十分一致した場合のみ `confirmed` とする。
不一致・取得失敗は `unresolved` のまま保持する。

## セキュリティ
- API キーをリポジトリへ保存しない
- Sheets ID は秘密情報ではないが、共有設定は非公開のままにする
- Web アプリは当面「自分のみ」に限定する
