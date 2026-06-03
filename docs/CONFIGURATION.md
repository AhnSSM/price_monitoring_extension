# 설정값과 서버 연결

확장 popup에서 설정하는 값은 두 가지입니다.

| 항목 | 예시 | 설명 |
|------|------|------|
| 서버 URL | `http://100.118.184.5:5000` | `price_monitoring` 서버 origin입니다. path는 입력하지 않습니다. |
| Bearer token | 서버 `.env`의 `DETAIL_CHECK_IMPORT_TOKEN` 값 | import API 인증용 token입니다. repo에 저장하지 않습니다. |

## 서버 URL

popup은 URL을 origin 단위로 정규화합니다.

예를 들어 아래 입력은 모두 `http://100.118.184.5:5000`으로 저장됩니다.

- `http://100.118.184.5:5000`
- `http://100.118.184.5:5000/`
- `http://100.118.184.5:5000/some/path`

## 허용된 서버 origin

현재 허용된 서버 origin은 다음과 같습니다.

- `http://100.118.184.5:5000`
- `http://127.0.0.1:5000`
- `http://127.0.0.1:5001`
- `http://localhost:5000`
- `http://localhost:5001`

허용 목록은 두 곳에 있습니다.

- `manifest.json`의 `host_permissions`
- `popup.js`의 `ALLOWED_SERVER_ORIGINS`

새 Tailscale IP, hostname, 또는 port를 쓰려면 두 파일을 같이 수정하고 브라우저 확장 목록에서 reload해야 합니다.

## Token

Bearer token은 서버의 `DETAIL_CHECK_IMPORT_TOKEN` 값과 같아야 합니다.

주의 사항:

- token 값을 GitHub repo에 커밋하지 않습니다.
- README, issue, screenshot, 로그에 token을 노출하지 않습니다.
- popup에 저장된 token은 현재 브라우저 profile의 `chrome.storage.local`에 저장됩니다.
- 브라우저 profile을 새로 만들거나 다른 PC에서 설치하면 token을 다시 입력해야 합니다.

## 서버 API 전제

확장은 아래 path로 POST 요청을 보냅니다.

```text
/api/dedicated/coupang_apple_return_sale/detail-check/import
```

요청 header:

```text
Content-Type: application/json
Authorization: Bearer <popup token>
```

요청 body는 현재 Coupang 탭에서 수집한 `url`, `final_url`, `title`, `text`입니다.
